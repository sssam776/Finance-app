import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { entities, xeroApps, users, varianceThresholds, GLOBAL_THRESHOLD_SCOPE } from "./schema";
import { nowUtcIso } from "../lib/dates";
import { hashPassword } from "../lib/auth";

/**
 * Seeds the entity registry from spec section 7.1 candidates and one
 * development Xero app registration. Every entity is seeded as
 * status='unverified' — Phase 0 requires confirming which legal entities
 * have a separate Xero organisation before anything is marked active
 * (spec 7.1). This is not production seed data (REM-003): no balances,
 * no live totals, development environment only.
 */

const CANDIDATE_ENTITIES = [
  { legalName: "Ramwall (2010) Limited", shortCode: "RAMWALL_2010" },
  { legalName: "Ramwall Developments Limited", shortCode: "RAMWALL_DEV" },
  { legalName: "Vikat Holdings Limited", shortCode: "VIKAT" },
  { legalName: "Kayo Investments Limited", shortCode: "KAYO" },
  { legalName: "Kerrs Village Limited", shortCode: "KERRS_VILLAGE" },
  { legalName: "Hebcohg Limited", shortCode: "HEBCOHG" },
  { legalName: "CHH Trust", shortCode: "CHH_TRUST" },
  { legalName: "Wallson Holdings Limited", shortCode: "WALLSON" },
];

async function seed() {
  const now = nowUtcIso();

  for (const candidate of CANDIDATE_ENTITIES) {
    db.insert(entities)
      .values({
        id: nanoid(),
        legalName: candidate.legalName,
        shortCode: candidate.shortCode,
        displayName: candidate.legalName,
        entityType: "unverified — decision required",
        status: "unverified",
        reportingCurrency: "NZD",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  db.insert(xeroApps)
    .values({
      id: nanoid(),
      appKey: "ramwall_read_core_dev",
      displayName: "Ramwall Read Core (Development)",
      environment: "development",
      purpose: "read_core",
      tier: "Starter",
      connectionLimit: 5,
      scopeProfile: "read_core_v1",
      redirectUri: process.env.XERO_REDIRECT_URI ?? "http://localhost:3000/api/xero/oauth/callback",
      clientIdSecretRef: "XERO_RAMWALL_READ_CORE_DEV_CLIENT_ID",
      clientSecretSecretRef: "XERO_RAMWALL_READ_CORE_DEV_CLIENT_SECRET",
      operationalOwner: "unverified — decision required",
      complianceStatus: "draft",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  seedAdminUser(now);
  seedDefaultThreshold(now);

  console.log(`Seeded ${CANDIDATE_ENTITIES.length} candidate entities and 1 Xero app (development).`);
}

/**
 * Creates the first admin account. Re-running the seed never resets an
 * existing password — otherwise a routine `db:seed` would silently hand the
 * account back to whoever last read the console.
 *
 * With no ADMIN_INITIAL_PASSWORD set, a random one is generated and printed
 * exactly once. There is deliberately no default password: a known credential
 * shipped in source is worse than a manual copy-paste step.
 */
function seedAdminUser(now: string) {
  const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@ramwall.local").trim().toLowerCase();
  const existing = db.select().from(users).where(eq(users.email, adminEmail)).get();

  if (existing) {
    console.log(`Admin user ${adminEmail} already exists — password left unchanged.`);
    return;
  }

  const fromEnv = process.env.ADMIN_INITIAL_PASSWORD;
  const password = fromEnv ?? randomBytes(12).toString("base64url");

  db.insert(users)
    .values({
      id: nanoid(),
      email: adminEmail,
      displayName: "Ramwall Administrator",
      passwordHash: hashPassword(password),
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  console.log(`\nCreated admin user: ${adminEmail}`);
  if (!fromEnv) {
    console.log(`Generated password:  ${password}`);
    console.log("Store it now — only its scrypt hash is kept, so it cannot be shown again.\n");
  }
}

/**
 * CASH-005 needs a threshold to compare against before anyone configures one.
 * $1,000 / 1% is a starting point for the Financial Controller to change, not
 * an accounting policy decision — it is stored as data, never hard-coded into
 * the dashboard (REM-001).
 */
function seedDefaultThreshold(now: string) {
  db.insert(varianceThresholds)
    .values({
      id: nanoid(),
      entityId: GLOBAL_THRESHOLD_SCOPE,
      absoluteAmount: "1000.00",
      percent: "1.00",
      updatedByEmail: "seed@local",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
}

seed();
