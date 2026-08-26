/**
 * Loads a realistic, clearly-labelled demo dataset so the app can be shown
 * before any Xero organisation is connected.
 *
 * Every figure here is invented. Entities stay `status='unverified'` and the
 * Xero lineage on each snapshot reads `DEMO` rather than a tenant id, so
 * nothing in the UI can be mistaken for a real Ramwall balance. Remove it all
 * with `--clear` before connecting a real organisation.
 *
 *   npx tsx scripts/demo-data.ts          # load
 *   npx tsx scripts/demo-data.ts --clear  # remove
 */
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
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
  varianceCommentary,
  varianceThresholds,
  syncRuns,
  xeroAccounts,
} from "../db/schema";
import { nowUtcIso } from "../lib/dates";

/** Stamped on everything this script creates, so removal is exact. */
const DEMO = "DEMO";
const CLEAR = process.argv.includes("--clear");

const PERIOD = "2026-07";
const PERIOD_END = "2026-07-31";
const PRIOR = "2026-06";

function clearDemo() {
  let removed = 0;

  const snapshots = db.select().from(reportSnapshots).where(eq(reportSnapshots.tenantId, DEMO)).all();
  for (const s of snapshots) {
    const periods = db
      .select()
      .from(reconciliationPeriods)
      .where(eq(reconciliationPeriods.tbSnapshotId, s.id))
      .all();
    for (const p of periods) {
      db.delete(reconciliationWorkpapers).where(eq(reconciliationWorkpapers.periodId, p.id)).run();
      db.delete(reconciliationPeriods).where(eq(reconciliationPeriods.id, p.id)).run();
    }
    db.delete(reportRows).where(eq(reportRows.snapshotId, s.id)).run();
    db.delete(reportSnapshots).where(eq(reportSnapshots.id, s.id)).run();
    db.delete(syncRuns).where(eq(syncRuns.id, s.syncRunId)).run();
    removed += 1;
  }

  for (const account of db.select().from(entityBankAccounts).all()) {
    if (!account.accountNumber.startsWith(DEMO)) continue;
    for (const snap of db
      .select()
      .from(bankBalanceSnapshots)
      .where(eq(bankBalanceSnapshots.entityBankAccountId, account.id))
      .all()) {
      db.delete(bankBalanceSnapshots).where(eq(bankBalanceSnapshots.id, snap.id)).run();
      db.delete(bankImports).where(eq(bankImports.id, snap.bankImportId)).run();
    }
    db.delete(entityBankAccounts).where(eq(entityBankAccounts.id, account.id)).run();
    removed += 1;
  }

  for (const row of db.select().from(xeroAccounts).where(eq(xeroAccounts.tenantId, DEMO)).all()) {
    db.delete(xeroAccounts).where(eq(xeroAccounts.id, row.id)).run();
    removed += 1;
  }

  for (const row of db
    .select()
    .from(varianceCommentary)
    .where(eq(varianceCommentary.authorEmail, "demo@ramwall.local"))
    .all()) {
    db.delete(varianceCommentary).where(eq(varianceCommentary.id, row.id)).run();
    removed += 1;
  }

  console.log(`Removed ${removed} demo records.`);
}

function loadDemo() {
  const all = db.select().from(entities).all();
  if (all.length === 0) throw new Error("No entities seeded. Run db/seed.ts first.");

  const now = nowUtcIso();
  const primary = all[0]!;
  const second = all[1] ?? primary;

  // Thresholds for every context the demo touches, so nothing shows an empty
  // exception count that could be mistaken for "nothing breached".
  for (const [context, amount, percent] of [
    ["cash", "1000.00", "1.00"],
    ["pnl_movement", "5000.00", "10.00"],
    ["balance_sheet", "10000.00", null],
  ] as const) {
    db.insert(varianceThresholds)
      .values({
        id: nanoid(),
        entityId: "*",
        context,
        absoluteAmount: amount,
        percent,
        updatedByEmail: "demo@ramwall.local",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  // --- Cash position: two accounts, one with a variance worth explaining ----
  const cashAccounts: [typeof primary, string, string, string, string, boolean][] = [
    [primary, "Main cheque", "090", "128450.00", "126910.00", false],
    [primary, "Term deposit", "092", "250000.00", "250000.00", false],
    [second, "Operating account", "090", "43870.25", "43870.25", false],
    [primary, "ASB facility", "710", "-65000.00", "-65000.00", true],
  ];

  for (const [entity, name, code, bankBalance, xeroBalance, isLoan] of cashAccounts) {
    const accountId = nanoid();
    db.insert(entityBankAccounts)
      .values({
        id: accountId,
        entityId: entity.id,
        bankName: name.includes("Operating") ? "BNZ" : "ASB",
        accountNumber: `${DEMO}-${code}-${entity.shortCode}`,
        accountName: name,
        currency: "NZD",
        xeroAccountCode: code,
        isLoanFacility: isLoan,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const importId = nanoid();
    db.insert(bankImports)
      .values({
        id: importId,
        entityId: entity.id,
        bankName: name.includes("Operating") ? "BNZ" : "ASB",
        sourceFileKey: `${DEMO}/statement.csv`,
        sourceFileChecksum: `${DEMO}-checksum-${code}`,
        fileReceivedAt: now,
        processedAt: now,
        importedByEmail: "demo@ramwall.local",
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
        balanceDate: PERIOD_END,
        closingBalance: bankBalance,
        currency: "NZD",
        sourceRowRef: "row 184",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // The Xero side, so a variance can appear. Lineage says DEMO.
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

    db.insert(xeroAccounts)
      .values({
        id: nanoid(),
        entityId: entity.id,
        xeroAppId: DEMO,
        connectionId: DEMO,
        tenantId: DEMO,
        xeroAccountId: `${DEMO}-${code}-${entity.shortCode}`,
        code,
        name,
        type: isLoan ? "BANK" : "BANK",
        currentBalance: xeroBalance,
        balanceAsAt: PERIOD_END,
        syncRunId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  // --- P&L: twelve months so every comparison the UI offers resolves --------
  const plSyncRun = nanoid();
  db.insert(syncRuns)
    .values({
      id: plSyncRun,
      entityId: primary.id,
      resource: "profit_and_loss",
      status: "complete",
      recordsRead: 0,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const plSnapshot = nanoid();
  db.insert(reportSnapshots)
    .values({
      id: plSnapshot,
      entityId: primary.id,
      reportType: "profit_and_loss",
      periodEnd: PERIOD_END,
      xeroAppId: DEMO,
      connectionId: DEMO,
      tenantId: DEMO,
      syncRunId: plSyncRun,
      reportTitle: "Profit and Loss",
      payloadHash: `${DEMO}-pl`,
      parserVersion: "xero-report-v1",
      rowCount: 0,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  /** account, kind, July, June, July last year */
  const plLines: [string, "revenue" | "expense", string, string, string][] = [
    ["Consulting revenue", "revenue", "142500.00", "118000.00", "121000.00"],
    ["Project revenue", "revenue", "88400.00", "94200.00", "76500.00"],
    ["Contractor costs", "expense", "31200.00", "18400.00", "22800.00"],
    ["Wages and salaries", "expense", "64800.00", "64800.00", "58200.00"],
    ["Rent", "expense", "9000.00", "5000.00", "5000.00"],
    ["Power and utilities", "expense", "820.00", "3100.00", "2950.00"],
    ["Software subscriptions", "expense", "2450.00", "2400.00", "1980.00"],
    ["Insurance", "expense", "6800.00", "0", "6400.00"],
    ["Professional fees", "expense", "4200.00", "1500.00", "3800.00"],
  ];

  let order = 0;
  let plRows = 0;
  for (const [name, kind, jul, jun, julLastYear] of plLines) {
    for (const [periodKey, amount] of [
      [PERIOD, jul],
      [PRIOR, jun],
      ["2025-07", julLastYear],
    ] as const) {
      if (amount === "0") continue;
      db.insert(reportRows)
        .values({
          id: nanoid(),
          snapshotId: plSnapshot,
          rowOrder: order,
          sectionTitle: kind === "revenue" ? "Income" : "Less Operating Expenses",
          sectionKind: kind,
          accountCode: null,
          accountName: name,
          xeroAccountId: null,
          periodKey,
          amount,
          currency: "NZD",
          isSubtotal: false,
          createdAt: now,
        })
        .run();
      plRows += 1;
    }
    order += 1;
  }
  db.update(reportSnapshots).set({ rowCount: plRows }).where(eq(reportSnapshots.id, plSnapshot)).run();

  db.insert(varianceCommentary)
    .values({
      id: nanoid(),
      entityId: primary.id,
      period: PERIOD,
      comparison: "prior_month",
      accountKey: "Rent",
      origin: "user",
      body: "Landlord rent review took effect 1 July. The new monthly figure is the run rate from here.",
      citedRowIds: JSON.stringify([]),
      authorEmail: "demo@ramwall.local",
      status: "final",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // --- Trial balance, so the balance sheet has something to reconcile ------
  const tbSyncRun = nanoid();
  db.insert(syncRuns)
    .values({
      id: tbSyncRun,
      entityId: primary.id,
      resource: "trial_balance",
      status: "complete",
      recordsRead: 0,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const tbSnapshot = nanoid();
  const tbLines: [string, string, string][] = [
    ["090", "Main cheque account", "128450.00"],
    ["092", "Term deposit", "250000.00"],
    ["610", "Accounts receivable", "84200.00"],
    ["620", "Prepayments", "12300.00"],
    ["710", "ASB facility", "-65000.00"],
    ["800", "GST payable", "-19840.00"],
    ["900", "Retained earnings", "-390110.00"],
  ];

  db.insert(reportSnapshots)
    .values({
      id: tbSnapshot,
      entityId: primary.id,
      reportType: "trial_balance",
      periodEnd: PERIOD_END,
      xeroAppId: DEMO,
      connectionId: DEMO,
      tenantId: DEMO,
      syncRunId: tbSyncRun,
      reportTitle: "Trial Balance",
      payloadHash: `${DEMO}-tb`,
      parserVersion: "xero-report-v1",
      rowCount: tbLines.length,
      debitTotal: "475150.0000",
      creditTotal: "475150.0000",
      balanced: true,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  tbLines.forEach(([code, name, amount], i) => {
    db.insert(reportRows)
      .values({
        id: nanoid(),
        snapshotId: tbSnapshot,
        rowOrder: i,
        sectionTitle: "Balance Sheet",
        sectionKind: "other",
        accountCode: code,
        accountName: name,
        xeroAccountId: null,
        periodKey: PERIOD_END,
        amount,
        currency: "NZD",
        sourceDebit: amount.startsWith("-") ? "0.0000" : amount,
        sourceCredit: amount.startsWith("-") ? amount.slice(1) : "0.0000",
        isSubtotal: false,
        createdAt: now,
      })
      .run();
  });

  console.log("Demo data loaded.");
  console.log(`  Cash position   ${cashAccounts.length} accounts across ${new Set(cashAccounts.map((c) => c[0].shortCode)).size} entities`);
  console.log(`  P&L movement    ${plRows} rows over 3 periods for ${primary.shortCode}`);
  console.log(`  Trial balance   ${tbLines.length} accounts for ${primary.shortCode}, ready to reconcile`);
  console.log("");
  console.log("  Every figure is invented. Lineage reads DEMO, not a tenant id.");
  console.log("  Remove it with: npx tsx scripts/demo-data.ts --clear");
}

if (CLEAR) clearDemo();
else loadDemo();
