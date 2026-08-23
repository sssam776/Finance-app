import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  entities,
  entityBankAccounts,
  bankBalanceSnapshots,
  bankImports,
  xeroAccounts,
  syncRuns,
  varianceThresholds,
} from "@/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { Money, variancePercent } from "@/lib/money";
import { oldestDateOnly } from "@/lib/dates";
import { resolveThreshold, isVarianceException } from "@/lib/thresholds";
import { requireSession } from "@/lib/session";

/**
 * CASH-001..006: per mapped bank account, the latest bank-source balance,
 * the latest Xero account balance (if mapped), the variance between them,
 * whether that variance breaches its configured threshold (CASH-005), and
 * the source records both figures came from (CASH-006).
 *
 * This is a variance/control view, not bank reconciliation (CASH-004).
 */

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const allEntities = db.select().from(entities).all();
  const allBankAccounts = db.select().from(entityBankAccounts).all();
  const thresholdRows = db.select().from(varianceThresholds).all();

  const rows = [];

  for (const account of allBankAccounts) {
    const entity = allEntities.find((e) => e.id === account.entityId);
    if (!entity) continue;

    // Secondary sort by createdAt: two imports can share a balance date, and
    // "latest" must then mean the one most recently ingested, not whichever
    // SQLite happens to return first.
    const latestSnapshot = db
      .select()
      .from(bankBalanceSnapshots)
      .where(eq(bankBalanceSnapshots.entityBankAccountId, account.id))
      .orderBy(desc(bankBalanceSnapshots.balanceDate), desc(bankBalanceSnapshots.createdAt))
      .limit(1)
      .get();

    let xeroAccount = null;
    if (account.xeroAccountCode) {
      xeroAccount = db
        .select()
        .from(xeroAccounts)
        .where(and(eq(xeroAccounts.entityId, entity.id), eq(xeroAccounts.code, account.xeroAccountCode)))
        .get();
    }

    let variance: { amount: string; percent: string | null } | null = null;
    if (latestSnapshot && xeroAccount?.currentBalance) {
      const bankBalance = Money.of(latestSnapshot.closingBalance, latestSnapshot.currency);
      const xeroBalance = Money.of(xeroAccount.currentBalance, latestSnapshot.currency);
      const diff = bankBalance.subtract(xeroBalance);
      const pct = variancePercent(bankBalance, xeroBalance);
      variance = { amount: diff.toFixedString(2), percent: pct ? pct.toFixed(2) : null };
    }

    const threshold = resolveThreshold(thresholdRows, entity.id);
    const exception = variance
      ? isVarianceException(variance.amount, variance.percent, threshold, account.currency)
      : false;

    // CASH-006: the records behind each figure, so a variance can be traced to
    // the CSV that produced it and the sync run that read Xero.
    const sourceImport = latestSnapshot
      ? db.select().from(bankImports).where(eq(bankImports.id, latestSnapshot.bankImportId)).get()
      : undefined;

    const sourceSyncRun = xeroAccount?.syncRunId
      ? db.select().from(syncRuns).where(eq(syncRuns.id, xeroAccount.syncRunId)).get()
      : undefined;

    const sourceDates = [latestSnapshot?.balanceDate, xeroAccount?.balanceAsAt].filter(
      (d): d is string => Boolean(d)
    );

    rows.push({
      entityId: entity.id,
      entityShortCode: entity.shortCode,
      entityStatus: entity.status,
      bankAccountId: account.id,
      bankName: account.bankName,
      accountName: account.accountName,
      isLoanFacility: account.isLoanFacility,
      bankBalance: latestSnapshot?.closingBalance ?? null,
      bankBalanceDate: latestSnapshot?.balanceDate ?? null,
      xeroBalance: xeroAccount?.currentBalance ?? null,
      xeroBalanceDate: xeroAccount?.balanceAsAt ?? null,
      variance,
      threshold,
      isException: exception,
      evidence: {
        bank: sourceImport
          ? {
              importId: sourceImport.id,
              sourceFileChecksum: sourceImport.sourceFileChecksum,
              importedByEmail: sourceImport.importedByEmail,
              fileReceivedAt: sourceImport.fileReceivedAt,
              parserVersion: sourceImport.parserVersion,
              sourceRowRef: latestSnapshot?.sourceRowRef ?? null,
            }
          : null,
        xero: sourceSyncRun
          ? {
              syncRunId: sourceSyncRun.id,
              tenantId: xeroAccount?.tenantId ?? null,
              xeroAccountId: xeroAccount?.xeroAccountId ?? null,
              status: sourceSyncRun.status,
              startedAt: sourceSyncRun.startedAt,
              finishedAt: sourceSyncRun.finishedAt,
              recordsRead: sourceSyncRun.recordsRead,
            }
          : null,
      },
      oldestSourceDate: oldestDateOnly(sourceDates),
      stale: latestSnapshot === undefined && xeroAccount === null,
    });
  }

  const availableCashRows = rows.filter((r) => !r.isLoanFacility && r.bankBalance !== null);
  const totalAvailableCash = availableCashRows.reduce(
    (acc, r) => acc.add(Money.of(r.bankBalance!, "NZD")),
    Money.zero("NZD")
  );
  const oldestAcrossAll = oldestDateOnly(rows.map((r) => r.oldestSourceDate).filter((d): d is string => Boolean(d)));

  return NextResponse.json({
    accounts: rows,
    totalAvailableCash: totalAvailableCash.toFixedString(2),
    oldestSourceDate: oldestAcrossAll,
    exceptionCount: rows.filter((r) => r.isException).length,
  });
}
