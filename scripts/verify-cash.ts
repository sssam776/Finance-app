/**
 * Exercises the Cash Position slice end to end against a running dev server:
 * create a mapped bank account, import a CSV, simulate a synced Xero balance,
 * then assert the variance, the CASH-005 exception flag and the CASH-006
 * evidence chain all come back correctly.
 *
 * The Xero side is inserted directly rather than synced, so this runs without
 * real Xero credentials. Everything else goes through the real HTTP routes.
 *
 * Run with: npx tsx scripts/verify-cash.ts <admin-password> [--keep]
 *
 * Cleans up everything it creates unless --keep is passed, which leaves a
 * populated dashboard behind so the flagged row and its evidence panel can
 * actually be looked at.
 */
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  entities,
  entityBankAccounts,
  bankImports,
  bankBalanceSnapshots,
  xeroAccounts,
  syncRuns,
  varianceThresholds,
} from "../db/schema";
import { nowUtcIso } from "../lib/dates";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ramwall.local";
const ADMIN_PASSWORD = process.argv[2];
const KEEP = process.argv.includes("--keep");

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.startsWith("--")) {
  console.error("Usage: npx tsx scripts/verify-cash.ts <admin-password> [--keep]");
  process.exit(1);
}

const XERO_CODE = "090";
const CSV = [
  "Date,Description,Amount,Balance",
  "01/08/2026,Opening,0.00,10000.00",
  "15/08/2026,Supplier payment,-2500.00,7500.00",
  "22/08/2026,Customer receipt,1250.50,8750.50",
].join("\n");

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${actual}${ok ? "" : `  (expected ${expected})`}`);
  ok ? pass++ : fail++;
}

let cookie = "";
async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return fetch(BASE + path, { ...init, headers, redirect: "manual" });
}

interface CashRow {
  bankAccountId: string;
  bankBalance: string | null;
  bankBalanceDate: string | null;
  xeroBalance: string | null;
  variance: { amount: string; percent: string | null } | null;
  threshold: { scope: string; absoluteAmount: string } | null;
  isException: boolean;
  evidence: {
    bank: { importId: string; sourceFileChecksum: string; importedByEmail: string; parserVersion: string } | null;
    xero: { syncRunId: string; status: string; recordsRead: number } | null;
  };
}

async function cashRow(bankAccountId: string): Promise<CashRow | undefined> {
  const res = await call("/api/cash-position");
  const body = (await res.json()) as { accounts: CashRow[]; exceptionCount: number };
  return body.accounts.find((a) => a.bankAccountId === bankAccountId);
}

/**
 * Removes anything a previous --keep run left behind. Without this the second
 * run sees a variance where it expects none, and re-inserting the simulated
 * Xero account trips the unique index on (entity_id, xero_account_id).
 */
function clearPreviousRun(entityId: string) {
  const stale = db
    .select()
    .from(xeroAccounts)
    .where(and(eq(xeroAccounts.entityId, entityId), eq(xeroAccounts.xeroAppId, "verify-app")))
    .all();

  for (const row of stale) {
    db.delete(xeroAccounts).where(eq(xeroAccounts.id, row.id)).run();
    if (row.syncRunId) db.delete(syncRuns).where(eq(syncRuns.id, row.syncRunId)).run();
  }

  const accounts = db
    .select()
    .from(entityBankAccounts)
    .where(eq(entityBankAccounts.entityId, entityId))
    .all()
    .filter((a) => a.accountNumber.startsWith("verify-"));

  for (const account of accounts) {
    const snapshots = db
      .select()
      .from(bankBalanceSnapshots)
      .where(eq(bankBalanceSnapshots.entityBankAccountId, account.id))
      .all();
    for (const snapshot of snapshots) {
      db.delete(bankBalanceSnapshots).where(eq(bankBalanceSnapshots.id, snapshot.id)).run();
      db.delete(bankImports).where(eq(bankImports.id, snapshot.bankImportId)).run();
    }
    db.delete(entityBankAccounts).where(eq(entityBankAccounts.id, account.id)).run();
  }

  db.delete(varianceThresholds).where(eq(varianceThresholds.entityId, entityId)).run();

  if (stale.length || accounts.length) {
    console.log(`      cleared ${stale.length + accounts.length} rows from a previous run`);
  }
}

async function main() {
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  check("admin login", login.status, 200);

  const entity = db.select().from(entities).limit(1).get();
  if (!entity) throw new Error("No entities seeded — run db/seed.ts first");
  console.log(`      using entity ${entity.shortCode}`);

  clearPreviousRun(entity.id);

  console.log("\n--- create a mapped bank account ---");
  const created = await call("/api/bank-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityId: entity.id,
      bankName: "ASB",
      accountNumber: `verify-${nanoid(6)}`,
      accountName: "Verification Cheque",
      xeroAccountCode: XERO_CODE,
      isLoanFacility: false,
    }),
  });
  const bankAccountId = ((await created.json()) as { id: string }).id;
  check("POST /api/bank-accounts", created.status, 201);

  console.log("\n--- import a CSV through the real route ---");
  const form = new FormData();
  form.set("file", new Blob([CSV], { type: "text/csv" }), "asb-export.csv");
  form.set("entityBankAccountId", bankAccountId);
  const upload = await call("/api/imports", { method: "POST", body: form });
  const uploadBody = (await upload.json()) as {
    importId: string;
    snapshotId: string;
    rowsParsed: number;
    closingBalance: string;
    balanceDate: string;
  };
  check("POST /api/imports", upload.status, 200);
  check("  rows parsed", uploadBody.rowsParsed, 3);
  check("  closing balance from last row", uploadBody.closingBalance, "8750.50");
  check("  balance date from last row", uploadBody.balanceDate, "2026-08-22");

  console.log("\n--- cash position with bank data only ---");
  let row = await cashRow(bankAccountId);
  check("row appears", Boolean(row), true);
  check("  bank balance", row?.bankBalance, "8750.50");
  check("  variance null without a Xero balance", row?.variance, "null");
  check("  CASH-006 bank evidence present", Boolean(row?.evidence.bank), true);
  check("  evidence records the importer", row?.evidence.bank?.importedByEmail, ADMIN_EMAIL);
  check("  evidence records parser version", row?.evidence.bank?.parserVersion, "bank-csv-v1");
  check("  evidence has a file checksum", (row?.evidence.bank?.sourceFileChecksum ?? "").length > 0, true);
  check("  no Xero evidence yet", row?.evidence.xero, "null");

  console.log("\n--- simulate a synced Xero balance (variance 250.50) ---");
  const now = nowUtcIso();
  const syncRunId = nanoid();
  db.insert(syncRuns)
    .values({
      id: syncRunId,
      entityId: entity.id,
      resource: "accounts+bank_summary",
      status: "complete",
      recordsRead: 1,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const xeroAccountRowId = nanoid();
  db.insert(xeroAccounts)
    .values({
      id: xeroAccountRowId,
      entityId: entity.id,
      xeroAppId: "verify-app",
      connectionId: "verify-conn",
      tenantId: "verify-tenant",
      xeroAccountId: "verify-xero-account",
      code: XERO_CODE,
      name: "Verification Cheque",
      currentBalance: "8500.00",
      balanceAsAt: "2026-08-22",
      syncRunId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  row = await cashRow(bankAccountId);
  check("  variance amount", row?.variance?.amount, "250.50");
  check("  CASH-006 Xero evidence present", Boolean(row?.evidence.xero), true);
  check("  evidence links the sync run", row?.evidence.xero?.syncRunId, syncRunId);

  console.log("\n--- CASH-005 threshold behaviour ---");
  // Group default is 1000.00 / 1.00% from the seed. 250.50 is under the dollar
  // trigger but 2.95% is over the percent trigger, so it must still flag.
  check("  flagged via the percent trigger", row?.isException, true);
  check("  threshold applied is the group default", row?.threshold?.scope, "group");

  await call("/api/thresholds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId: "*", absoluteAmount: "1000.00", percent: "50.00" }),
  });
  row = await cashRow(bankAccountId);
  check("  not flagged once percent trigger raised to 50%", row?.isException, false);

  await call("/api/thresholds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId: entity.id, absoluteAmount: "100.00", percent: null }),
  });
  row = await cashRow(bankAccountId);
  check("  entity override beats the group default", row?.threshold?.scope, "entity");
  check("  flagged again under the tighter override", row?.isException, true);

  if (KEEP) {
    // Drop the tight entity override so the row is flagged by the group
    // default instead, which is the configuration a reviewer should see.
    db.delete(varianceThresholds).where(eq(varianceThresholds.entityId, entity.id)).run();
    db.update(varianceThresholds)
      .set({ absoluteAmount: "1000.00", percent: "1.00", updatedAt: nowUtcIso() })
      .where(eq(varianceThresholds.entityId, "*"))
      .run();

    console.log("\n--- left in place for review (--keep) ---");
    console.log(`      entity          ${entity.shortCode}`);
    console.log(`      bank balance    8750.50 as at 2026-08-22`);
    console.log(`      xero balance    8500.00`);
    console.log(`      variance        250.50 (2.95%), flagged by the 1.00% group trigger`);
    console.log(`\n      Open ${BASE}, sign in, and expand the row's "Evidence" link.`);
    console.log(`      Re-run without --keep to remove this data.`);
  } else {
    console.log("\n--- cleanup ---");
    // By id, not by entity: deleting this entity's imports wholesale would
    // take real ones with it.
    db.delete(bankBalanceSnapshots).where(eq(bankBalanceSnapshots.id, uploadBody.snapshotId)).run();
    db.delete(bankImports).where(eq(bankImports.id, uploadBody.importId)).run();
    db.delete(xeroAccounts).where(eq(xeroAccounts.id, xeroAccountRowId)).run();
    db.delete(syncRuns).where(eq(syncRuns.id, syncRunId)).run();
    db.delete(entityBankAccounts).where(eq(entityBankAccounts.id, bankAccountId)).run();
    db.delete(varianceThresholds).where(eq(varianceThresholds.entityId, entity.id)).run();
    db.update(varianceThresholds)
      .set({ absoluteAmount: "1000.00", percent: "1.00", updatedAt: nowUtcIso() })
      .where(eq(varianceThresholds.entityId, "*"))
      .run();
    console.log("      test data removed, group threshold restored to 1000.00 / 1.00%");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
