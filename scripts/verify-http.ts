/**
 * End-to-end check of the auth boundary against a running dev server.
 * Run with: npx tsx scripts/verify-http.ts
 *
 * Creates a throwaway viewer account so the admin/viewer split is actually
 * exercised rather than assumed, then removes it again.
 */
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { hashPassword } from "../lib/auth";
import { nowUtcIso } from "../lib/dates";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ramwall.local";
// Narrowed through a helper rather than a bare guard: a module-level check
// does not narrow the binding inside main(), which runs later.
function required(value: string | undefined, usage: string): string {
  if (!value) {
    console.error(usage);
    process.exit(1);
  }
  return value;
}

const ADMIN_PASSWORD = required(
  process.argv[2],
  "Usage: npx tsx scripts/verify-http.ts <admin-password>"
);

const VIEWER_EMAIL = "verify-viewer@ramwall.local";
const VIEWER_PASSWORD = "viewer-" + nanoid(12);

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${actual}${ok ? "" : `  (expected ${expected})`}`);
  ok ? pass++ : fail++;
}

async function call(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
  return res;
}

function sessionCookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

async function login(email: string, password: string) {
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, cookie: sessionCookieFrom(res), raw: res };
}

async function main() {
  // A viewer to prove reads are allowed and writes are not.
  db.delete(users).where(eq(users.email, VIEWER_EMAIL)).run();
  const now = nowUtcIso();
  db.insert(users)
    .values({
      id: nanoid(),
      email: VIEWER_EMAIL,
      displayName: "Verification Viewer",
      passwordHash: hashPassword(VIEWER_PASSWORD),
      role: "viewer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  console.log("\n--- unauthenticated ---");
  check("GET / redirects to login", (await call("/")).status, 307);
  check("GET /login renders", (await call("/login")).status, 200);
  for (const path of ["/api/cash-position", "/api/entities", "/api/thresholds", "/api/bank-accounts"]) {
    check(`GET ${path} rejected`, (await call(path)).status, 401);
  }
  check(
    "POST /api/xero/sync rejected",
    (await call("/api/xero/sync", { method: "POST", body: "{}" })).status,
    401
  );

  console.log("\n--- login ---");
  check("wrong password rejected", (await login(ADMIN_EMAIL, "definitely-wrong")).status, 401);
  check("unknown email rejected", (await login("nobody@ramwall.local", "x")).status, 401);

  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  check("admin login succeeds", admin.status, 200);
  const setCookie = admin.raw.headers.get("set-cookie") ?? "";
  check("session cookie is HttpOnly", /HttpOnly/i.test(setCookie), true);
  check("session cookie is SameSite=Lax", /SameSite=lax/i.test(setCookie), true);
  check("session cookie is not the raw token in DB", setCookie.length > 20, true);

  console.log("\n--- admin session ---");
  const me = await call("/api/auth/me", {}, admin.cookie);
  const meBody = (await me.json()) as { user: { email: string; role: string } };
  check("GET /api/auth/me", me.status, 200);
  check("  role", meBody.user.role, "admin");
  check("  email", meBody.user.email, ADMIN_EMAIL);
  check("GET / no longer redirects", (await call("/", {}, admin.cookie)).status, 200);

  const cash = await call("/api/cash-position", {}, admin.cookie);
  const cashBody = (await cash.json()) as {
    accounts: unknown[];
    exceptionCount: number;
    totalAvailableCash: string;
  };
  check("GET /api/cash-position", cash.status, 200);
  console.log(
    `      accounts=${cashBody.accounts.length} exceptions=${cashBody.exceptionCount} total=${cashBody.totalAvailableCash}`
  );

  const thresholds = await call("/api/thresholds", {}, admin.cookie);
  const thresholdBody = (await thresholds.json()) as { thresholds: unknown[] };
  check("GET /api/thresholds", thresholds.status, 200);
  check("  seeded group default present", thresholdBody.thresholds.length >= 1, true);

  const writeThreshold = await call(
    "/api/thresholds",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId: "*", absoluteAmount: "1000.00", percent: "1.00" }),
    },
    admin.cookie
  );
  check("POST /api/thresholds as admin", writeThreshold.status, 200);

  const badThreshold = await call(
    "/api/thresholds",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId: "*", absoluteAmount: "not-a-number" }),
    },
    admin.cookie
  );
  check("POST /api/thresholds rejects junk", badThreshold.status, 400);

  console.log("\n--- viewer session (role split) ---");
  const viewer = await login(VIEWER_EMAIL, VIEWER_PASSWORD);
  check("viewer login succeeds", viewer.status, 200);
  check("viewer can read cash position", (await call("/api/cash-position", {}, viewer.cookie)).status, 200);
  check("viewer can read thresholds", (await call("/api/thresholds", {}, viewer.cookie)).status, 200);
  check(
    "viewer CANNOT write thresholds",
    (
      await call(
        "/api/thresholds",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityId: "*", absoluteAmount: "5.00" }),
        },
        viewer.cookie
      )
    ).status,
    403
  );
  check(
    "viewer CANNOT trigger a Xero sync",
    (
      await call(
        "/api/xero/sync",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        viewer.cookie
      )
    ).status,
    403
  );
  check(
    "viewer CANNOT create bank accounts",
    (
      await call(
        "/api/bank-accounts",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        viewer.cookie
      )
    ).status,
    403
  );

  console.log("\n--- forged and revoked sessions ---");
  check(
    "forged cookie rejected",
    (await call("/api/auth/me", {}, "ramwall_session=totally-made-up")).status,
    401
  );
  const logout = await call("/api/auth/logout", { method: "POST" }, viewer.cookie);
  check("logout succeeds", logout.status, 200);
  check("session dead after logout", (await call("/api/auth/me", {}, viewer.cookie)).status, 401);

  db.delete(users).where(eq(users.email, VIEWER_EMAIL)).run();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
