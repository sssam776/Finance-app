import { nanoid } from "nanoid";
import { db } from "./client";
import { entities, xeroApps } from "./schema";
import { nowUtcIso } from "../lib/dates";

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

  console.log(`Seeded ${CANDIDATE_ENTITIES.length} candidate entities and 1 Xero app (development).`);
}

seed();
