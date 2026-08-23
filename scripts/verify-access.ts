/**
 * End-to-end check of per-entity scoping, password rotation and the capacity
 * gate against a running dev server.
 *
 * Unit tests cover the pure rules; this proves the routes actually apply them.
 * Creates its own throwaway users and grants, and removes them again.
 *
 * Run with: npx tsx scripts/verify-access.ts <admin-password>
 */
import { nanoid } from "nanoid";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { users, entities, entityPermissions, sessions, auditEvents } from "../db/schema";
import { hashPassword } from "../lib/auth";
import { nowUtcIso } from "../lib/dates";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ramwall.local";

function required(value: string | undefined, usage: string): string {
  if (!value) {
    console.error(usage);
    process.exit(1);
  }
  return value;
}

const ADMIN_PASSWORD = required(
  process.argv[2],
  "Usage: npx tsx scripts/verify-access.ts <admin-password>"
);

const SCOPED_EMAIL = "verify-scoped@ramwall.local";
const ROTATE_EMAIL = "verify-rotate@ramwall.local";
const START_PASSWORD = "start-passphrase-" + nanoid(8);
const NEXT_PASSWORD = "next-passphrase-" + nanoid(8);

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(54)} ${actual}${ok ? "" : `  (expected ${expected})`}`);
  ok ? pass++ : fail++;
}

async function call(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return fetch(BASE + path, { ...init, headers, redirect: "manual" });
}

async function login(email: string, password: string) {
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "" };
}

function makeUser(email: string, password: string, role: "admin" | "viewer") {
  db.delete(entityPermissions)
    .where(
      inArray(
        entityPermissions.userId,
        db.select({ id: users.id }).from(users).where(eq(users.email, email)).all().map((u) => u.id)
      )
    )
    .run();
  db.delete(users).where(eq(users.email, email)).run();

  const id = nanoid();
  const now = nowUtcIso();
  db.insert(users)
    .values({
      id,
      email,
      displayName: `Verification ${role}`,
      passwordHash: hashPassword(password),
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

async function main() {
  const allEntities = db.select().from(entities).all();
  if (allEntities.length < 2) throw new Error("Need at least two seeded entities");
  const granted = allEntities[0]!;
  const withheld = allEntities[1]!;

  const scopedUserId = makeUser(SCOPED_EMAIL, START_PASSWORD, "viewer");
  const rotateUserId = makeUser(ROTATE_EMAIL, START_PASSWORD, "viewer");

  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  check("admin login", admin.status, 200);

  console.log("\n--- viewer with no grants sees nothing ---");
  const ungranted = await login(SCOPED_EMAIL, START_PASSWORD);
  check("scoped viewer can log in", ungranted.status, 200);

  const emptyEntities = await call("/api/entities", {}, ungranted.cookie);
  const emptyBody = (await emptyEntities.json()) as { entities: unknown[] };
  check("  sees zero entities", emptyBody.entities.length, 0);

  const emptyCash = await call("/api/cash-position", {}, ungranted.cookie);
  const emptyCashBody = (await emptyCash.json()) as { accounts: unknown[] };
  check("  sees zero cash rows", emptyCashBody.accounts.length, 0);

  console.log("\n--- admin grants one entity ---");
  const grant = await call(
    "/api/entity-permissions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: scopedUserId, entityId: granted.id }),
    },
    admin.cookie
  );
  check("POST /api/entity-permissions", grant.status, 201);

  const scoped = await login(SCOPED_EMAIL, START_PASSWORD);
  const scopedEntities = await call("/api/entities", {}, scoped.cookie);
  const scopedBody = (await scopedEntities.json()) as { entities: { id: string; shortCode: string }[] };
  check("  now sees exactly one entity", scopedBody.entities.length, 1);
  check("  and it is the granted one", scopedBody.entities[0]?.shortCode, granted.shortCode);

  console.log("\n--- scoped user cannot reach the withheld entity ---");
  const syncWithheld = await call(
    "/api/xero/sync",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId: withheld.id }) },
    scoped.cookie
  );
  // A viewer is stopped by role before scope is even consulted.
  check("viewer blocked from sync", syncWithheld.status, 403);

  const permissionsList = await call("/api/entity-permissions", {}, scoped.cookie);
  check("viewer cannot list permissions", permissionsList.status, 403);

  console.log("\n--- a scoped ADMIN is restricted too ---");
  const scopedAdminId = makeUser("verify-scoped-admin@ramwall.local", START_PASSWORD, "admin");
  db.insert(entityPermissions)
    .values({
      id: nanoid(),
      userId: scopedAdminId,
      entityId: granted.id,
      grantedByEmail: "verify@local",
      createdAt: nowUtcIso(),
      updatedAt: nowUtcIso(),
    })
    .run();

  const scopedAdmin = await login("verify-scoped-admin@ramwall.local", START_PASSWORD);
  const adminEntities = await call("/api/entities", {}, scopedAdmin.cookie);
  const adminBody = (await adminEntities.json()) as { entities: unknown[] };
  check("granted admin sees only that entity", adminBody.entities.length, 1);

  const adminSyncWithheld = await call(
    "/api/xero/sync",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId: withheld.id }) },
    scopedAdmin.cookie
  );
  check("granted admin blocked from withheld entity", adminSyncWithheld.status, 403);

  console.log("\n--- password rotation ---");
  const rotator = await login(ROTATE_EMAIL, START_PASSWORD);
  const otherDevice = await login(ROTATE_EMAIL, START_PASSWORD);
  check("two sessions established", otherDevice.status, 200);

  const wrongCurrent = await call(
    "/api/auth/password",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "not-the-password", newPassword: NEXT_PASSWORD }),
    },
    rotator.cookie
  );
  check("wrong current password rejected", wrongCurrent.status, 403);

  const tooShort = await call(
    "/api/auth/password",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: START_PASSWORD, newPassword: "short" }),
    },
    rotator.cookie
  );
  check("short password rejected", tooShort.status, 400);

  const changed = await call(
    "/api/auth/password",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: START_PASSWORD, newPassword: NEXT_PASSWORD }),
    },
    rotator.cookie
  );
  check("password changed", changed.status, 200);

  check("changing session still works", (await call("/api/auth/me", {}, rotator.cookie)).status, 200);
  check("other session revoked", (await call("/api/auth/me", {}, otherDevice.cookie)).status, 401);
  check("old password no longer works", (await login(ROTATE_EMAIL, START_PASSWORD)).status, 401);
  check("new password works", (await login(ROTATE_EMAIL, NEXT_PASSWORD)).status, 200);

  console.log("\n--- login throttling ---");
  const throttleEmail = "verify-throttle@ramwall.local";
  makeUser(throttleEmail, START_PASSWORD, "viewer");
  let sawThrottle = 0;
  for (let i = 0; i < 7; i++) {
    const res = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: throttleEmail, password: "wrong-every-time" }),
    });
    if (res.status === 429) sawThrottle++;
  }
  check("repeated failures eventually return 429", sawThrottle > 0, true);
  check(
    "correct password is refused while throttled",
    (await login(throttleEmail, START_PASSWORD)).status,
    429
  );

  console.log("\n--- cleanup ---");
  const testEmails = [SCOPED_EMAIL, ROTATE_EMAIL, "verify-scoped-admin@ramwall.local", throttleEmail];
  const testUsers = db.select().from(users).where(inArray(users.email, testEmails)).all();
  const ids = testUsers.map((u) => u.id);
  if (ids.length) {
    db.delete(entityPermissions).where(inArray(entityPermissions.userId, ids)).run();
    db.delete(sessions).where(inArray(sessions.userId, ids)).run();
    db.delete(users).where(inArray(users.id, ids)).run();
  }
  db.delete(auditEvents).where(inArray(auditEvents.actorEmail, testEmails)).run();
  console.log("      test users, grants, sessions and audit rows removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
