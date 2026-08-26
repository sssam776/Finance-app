/**
 * End-to-end check of Module D against a running dev server.
 *
 * Seeds a trial balance snapshot directly (the sync needs a real Xero
 * connection) and drives the workpaper and lock routes over HTTP.
 *
 * The behaviour that matters most is a refusal: an account with no supporting
 * source must never come back reconciled, and a period with unsupported
 * material accounts must not lock quietly.
 *
 * Run with: ADMIN_PASSWORD=... npx tsx scripts/verify-reconciliation.ts
 */
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  entities,
  entityBankAccounts,
  bankImports,
  bankBalanceSnapshots,
  reportSnapshots,
  reportRows,
  reconciliationPeriods,
  reconciliationWorkpapers,
  varianceThresholds,
  syncRuns,
} from "../db/schema";
import { nowUtcIso } from "../lib/dates";
import { assertLocalDevDatabase, adminPassword } from "./guardTestDb";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ramwall.local";

assertLocalDevDatabase();
const ADMIN_PASSWORD = adminPassword();

const PERIOD_END = "2026-07-31";
const MARKER = "verify-recon";
/** Bank accounts this suite creates. Prefixed so cleanup can find them. */
const BANK_CODE = "090";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${actual}${ok ? "" : `  (expected ${expected})`}`);
  ok ? pass++ : fail++;
}

let cookie = "";
async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return fetch(BASE + path, { ...init, headers, redirect: "manual" });
}
const post = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

interface Workpaper {
  accountCode: string;
  status: string;
  substantiationType: string;
  difference: string | null;
  isMaterial: boolean;
}

function cleanup(entityId: string) {
  const periods = db
    .select()
    .from(reconciliationPeriods)
    .where(eq(reconciliationPeriods.entityId, entityId))
    .all();
  for (const p of periods) {
    db.delete(reconciliationWorkpapers).where(eq(reconciliationWorkpapers.periodId, p.id)).run();
    db.delete(reconciliationPeriods).where(eq(reconciliationPeriods.id, p.id)).run();
  }

  const snaps = db
    .select()
    .from(reportSnapshots)
    .where(and(eq(reportSnapshots.entityId, entityId), eq(reportSnapshots.tenantId, MARKER)))
    .all();
  for (const s of snaps) {
    db.delete(reportRows).where(eq(reportRows.snapshotId, s.id)).run();
    db.delete(reportSnapshots).where(eq(reportSnapshots.id, s.id)).run();
    db.delete(syncRuns).where(eq(syncRuns.id, s.syncRunId)).run();
  }

  // Any account this suite or a sibling verify script left behind. They share
  // the "verify-" prefix and can share a Xero code, which is exactly the
  // ambiguity the route now refuses to guess through.
  const accounts = db
    .select()
    .from(entityBankAccounts)
    .where(eq(entityBankAccounts.entityId, entityId))
    .all()
    .filter((a) => a.accountNumber.startsWith("verify-"));
  for (const a of accounts) {
    const snapshots = db
      .select()
      .from(bankBalanceSnapshots)
      .where(eq(bankBalanceSnapshots.entityBankAccountId, a.id))
      .all();
    for (const s of snapshots) {
      db.delete(bankBalanceSnapshots).where(eq(bankBalanceSnapshots.id, s.id)).run();
      db.delete(bankImports).where(eq(bankImports.id, s.bankImportId)).run();
    }
    db.delete(entityBankAccounts).where(eq(entityBankAccounts.id, a.id)).run();
  }

  db.delete(varianceThresholds)
    .where(and(eq(varianceThresholds.entityId, "*"), eq(varianceThresholds.context, "balance_sheet")))
    .run();
}

function seed(entityId: string) {
  const now = nowUtcIso();

  // Balance-sheet materiality, so "material" means something in this run.
  db.insert(varianceThresholds)
    .values({
      id: nanoid(),
      entityId: "*",
      context: "balance_sheet",
      absoluteAmount: "1000.00",
      percent: null,
      updatedByEmail: "verify@local",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  // A bank account whose balance will substantiate one trial balance line.
  const accountId = nanoid();
  db.insert(entityBankAccounts)
    .values({
      id: accountId,
      entityId,
      bankName: "ASB",
      accountNumber: `verify-${MARKER}-1`,
      accountName: "Verification Cheque",
      currency: "NZD",
      xeroAccountCode: BANK_CODE,
      isLoanFacility: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const importId = nanoid();
  db.insert(bankImports)
    .values({
      id: importId,
      entityId,
      bankName: "ASB",
      sourceFileKey: MARKER,
      sourceFileChecksum: MARKER,
      fileReceivedAt: now,
      processedAt: now,
      importedByEmail: "verify@local",
      parserVersion: "bank-csv-v1",
      status: "parsed",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.insert(bankBalanceSnapshots)
    .values({
      id: nanoid(),
      bankImportId: importId,
      entityBankAccountId: accountId,
      balanceDate: "2026-07-31",
      closingBalance: "25000.00",
      currency: "NZD",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return seedTrialBalance(entityId, PERIOD_END);
}

/**
 * A completed trial balance for one period: one bank line the import supports,
 * and three that nothing does.
 */
function seedTrialBalance(entityId: string, periodEnd: string) {
  const now = nowUtcIso();

  const syncRunId = nanoid();
  db.insert(syncRuns)
    .values({
      id: syncRunId,
      entityId,
      resource: "trial_balance",
      status: "complete",
      recordsRead: 0,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const snapshotId = nanoid();
  db.insert(reportSnapshots)
    .values({
      id: snapshotId,
      entityId,
      reportType: "trial_balance",
      periodEnd,
      xeroAppId: MARKER,
      connectionId: MARKER,
      tenantId: MARKER,
      syncRunId,
      payloadHash: MARKER,
      parserVersion: "xero-report-v1",
      rowCount: 4,
      debitTotal: "100000.0000",
      creditTotal: "100000.0000",
      balanced: true,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const lines: [string, string, string][] = [
    [BANK_CODE, "Bank account", "25000.0000"], // supported, and agrees
    ["610", "Accounts receivable", "48000.0000"], // material, nothing supports it
    ["800", "GST payable", "12000.0000"], // material, nothing supports it
    ["999", "Rounding", "5.0000"], // immaterial, nothing supports it
  ];

  lines.forEach(([code, name, amount], i) => {
    db.insert(reportRows)
      .values({
        id: nanoid(),
        snapshotId,
        rowOrder: i,
        sectionTitle: "Assets",
        sectionKind: "other",
        accountCode: code,
        accountName: name,
        xeroAccountId: null,
        periodKey: periodEnd,
        amount,
        currency: "NZD",
        sourceDebit: amount,
        sourceCredit: "0.0000",
        isSubtotal: false,
        createdAt: now,
      })
      .run();
  });

  return { snapshotId, syncRunId };
}

async function main() {
  const entity = db.select().from(entities).limit(1).get();
  if (!entity) throw new Error("No entities seeded");

  cleanup(entity.id);
  seed(entity.id);

  const login = await post("/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  check("admin login", login.status, 200);
  console.log(`      entity ${entity.shortCode}, period ${PERIOD_END}`);

  console.log("\n--- before workpapers exist ---");
  const before = await call(`/api/reconciliation?entityId=${entity.id}&periodEnd=${PERIOD_END}`);
  const beforeBody = (await before.json()) as { available: boolean; reason: string };
  check("reports nothing prepared", beforeBody.available, false);
  check("explains why", beforeBody.reason.length > 20, true);

  console.log("\n--- prepare workpapers ---");
  const seeded = await post("/api/reconciliation", { entityId: entity.id, periodEnd: PERIOD_END });
  const seededBody = (await seeded.json()) as { periodId: string; workpapers: number };
  check("POST /api/reconciliation", seeded.status, 201);
  check("  one workpaper per trial balance line", seededBody.workpapers, 4);

  const listed = await call(`/api/reconciliation?entityId=${entity.id}&periodEnd=${PERIOD_END}`);
  const body = (await listed.json()) as {
    workpapers: Workpaper[];
    readiness: { ready: boolean; blocking: string[]; settled: number };
    period: { id: string; status: string };
  };
  const byCode = new Map(body.workpapers.map((w) => [w.accountCode, w]));

  console.log("\n--- BS-005: unsupported balances are never reconciled ---");
  check("  bank line is reconciled", byCode.get(BANK_CODE)?.status, "reconciled");
  check("  bank line names its source", byCode.get(BANK_CODE)?.substantiationType, "bank_balance");
  check("  bank difference is nil", byCode.get(BANK_CODE)?.difference, "0.00");

  check("  receivables unsubstantiated", byCode.get("610")?.status, "unsubstantiated");
  check("  GST unsubstantiated", byCode.get("800")?.status, "unsubstantiated");
  check("  no source attached", byCode.get("610")?.substantiationType, "none");
  // Null, not zero. A missing source is not a source saying nothing.
  check("  no difference invented", byCode.get("610")?.difference, "null");

  const anyFalselyReconciled = body.workpapers.some(
    (w) => w.substantiationType === "none" && w.status.startsWith("reconciled")
  );
  check("  nothing unsupported claims to be reconciled", anyFalselyReconciled, false);

  console.log("\n--- materiality decides what blocks a close ---");
  check("  material accounts block", body.readiness.blocking.sort().join(","), "610,800");
  check("  immaterial account does not block", body.readiness.blocking.includes("999"), false);
  check("  period is not ready", body.readiness.ready, false);

  console.log("\n--- BS-001: locking over gaps is possible but never silent ---");
  const refused = await post("/api/reconciliation/lock", {
    periodId: body.period.id,
    action: "lock",
  });
  const refusedBody = (await refused.json()) as { blocking: string[] };
  check("  refuses to lock without acknowledgement", refused.status, 409);
  check("  names what is blocking", refusedBody.blocking.length, 2);

  const locked = await post("/api/reconciliation/lock", {
    periodId: body.period.id,
    action: "lock",
    acknowledgeUnresolved: true,
  });
  const lockedBody = (await locked.json()) as { acknowledgedUnresolved: boolean };
  check("  locks when acknowledged", locked.status, 200);
  check("  records that gaps remained", lockedBody.acknowledgedUnresolved, true);

  const afterLock = await call(`/api/reconciliation?entityId=${entity.id}&periodEnd=${PERIOD_END}`);
  const afterBody = (await afterLock.json()) as {
    period: { status: string; lockAcknowledgedUnresolved: boolean };
    workpapers: Workpaper[];
  };
  check("  period reads as locked", afterBody.period.status, "locked");
  check("  the acknowledgement is visible afterwards", afterBody.period.lockAcknowledgedUnresolved, true);
  // The unsupported ones keep their own status, so the record still says which
  // accounts were outstanding at close.
  const stillUnsupported = afterBody.workpapers.filter((w) => w.status === "unsubstantiated").length;
  check("  unsupported accounts are not swept into locked", stillUnsupported, 3);

  console.log("\n--- a review survives a re-seed ---");
  await post("/api/reconciliation/lock", {
    periodId: body.period.id,
    action: "reopen",
    reason: "Checking that a sign-off is not overwritten.",
  });
  await post("/api/reconciliation", { entityId: entity.id, periodEnd: PERIOD_END });
  const afterReseed = await call(`/api/reconciliation?entityId=${entity.id}&periodEnd=${PERIOD_END}`);
  const reseedBody = (await afterReseed.json()) as { workpapers: Workpaper[] };
  // Reopening returns locked workpapers to reviewed, and a re-seed must not
  // silently discard that: somebody signed it off.
  check(
    "  a reviewed workpaper is not overwritten",
    reseedBody.workpapers.find((w) => w.accountCode === BANK_CODE)?.status,
    "reviewed"
  );

  console.log("\n--- two bank accounts on one Xero code is refused, not guessed ---");
  // A second account on the same code. Picking either would substantiate the
  // balance from an account nobody chose. Checked on a fresh period so no
  // earlier sign-off is in the way.
  const OTHER_PERIOD = "2026-06-30";
  const duplicateId = nanoid();
  db.insert(entityBankAccounts)
    .values({
      id: duplicateId,
      entityId: entity.id,
      bankName: "BNZ",
      accountNumber: `verify-${MARKER}-2`,
      accountName: "Second account, same code",
      currency: "NZD",
      xeroAccountCode: BANK_CODE,
      isLoanFacility: false,
      createdAt: nowUtcIso(),
      updatedAt: nowUtcIso(),
    })
    .run();
  seedTrialBalance(entity.id, OTHER_PERIOD);

  await post("/api/reconciliation", { entityId: entity.id, periodEnd: OTHER_PERIOD });
  const ambiguous = await call(`/api/reconciliation?entityId=${entity.id}&periodEnd=${OTHER_PERIOD}`);
  const ambiguousBody = (await ambiguous.json()) as { workpapers: Workpaper[] };
  check(
    "  refuses to substantiate from an ambiguous mapping",
    ambiguousBody.workpapers.find((w) => w.accountCode === BANK_CODE)?.status,
    "unsubstantiated"
  );

  db.delete(entityBankAccounts).where(eq(entityBankAccounts.id, duplicateId)).run();

  console.log("\n--- re-seeding a locked period is refused ---");
  await post("/api/reconciliation/lock", {
    periodId: body.period.id,
    action: "lock",
    acknowledgeUnresolved: true,
  });
  const reseed = await post("/api/reconciliation", { entityId: entity.id, periodEnd: PERIOD_END });
  check("  refused", reseed.status, 409);

  console.log("\n--- reopening requires a reason ---");
  const noReason = await post("/api/reconciliation/lock", {
    periodId: body.period.id,
    action: "reopen",
  });
  check("  refused without one", noReason.status, 400);

  const reopened = await post("/api/reconciliation/lock", {
    periodId: body.period.id,
    action: "reopen",
    reason: "Bank statement for July arrived late.",
  });
  check("  reopens with one", reopened.status, 200);

  console.log("\n--- cleanup ---");
  cleanup(entity.id);
  console.log("      fixture removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
