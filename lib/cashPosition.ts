import { desc, eq, and } from "drizzle-orm";
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
import { Money, variancePercent } from "./money";
import { oldestDateOnly } from "./dates";
import { resolveThreshold, isVarianceException, type ResolvedThreshold } from "./thresholds";
import { canAccessEntity, type EntityAccess } from "./entityAccess";

/**
 * CASH-001..006, computed outside the route layer.
 *
 * Per mapped bank account: the latest bank-source balance, the latest Xero
 * balance if the account is mapped, the variance between them, whether that
 * variance breaches its configured threshold (CASH-005), and the source
 * records both figures came from (CASH-006).
 *
 * This is a variance and control view, not bank reconciliation (CASH-004).
 *
 * It lives here rather than in app/api/cash-position/route.ts for two reasons.
 * REM-001 keeps accounting policy out of presentation code. And several later
 * modules need this exact computation and its evidence shape, which they
 * cannot get by importing a route handler.
 */

export interface CashEvidence {
  bank: {
    importId: string;
    sourceFileChecksum: string;
    importedByEmail: string;
    fileReceivedAt: string;
    parserVersion: string;
    sourceRowRef: string | null;
  } | null;
  xero: {
    syncRunId: string;
    tenantId: string | null;
    xeroAccountId: string | null;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    recordsRead: number;
  } | null;
}

export interface CashAccountRow {
  entityId: string;
  entityShortCode: string;
  entityStatus: string;
  bankAccountId: string;
  bankName: string;
  accountName: string;
  currency: string;
  isLoanFacility: boolean;
  bankBalance: string | null;
  bankBalanceDate: string | null;
  xeroBalance: string | null;
  xeroBalanceDate: string | null;
  variance: { amount: string; percent: string | null; currency: string } | null;
  currencyMismatch: boolean;
  threshold: ResolvedThreshold | null;
  isException: boolean;
  evidence: CashEvidence;
  oldestSourceDate: string | null;
  stale: boolean;
}

export interface CashPosition {
  accounts: CashAccountRow[];
  availableCashByCurrency: { currency: string; amount: string }[];
  totalAvailableCash: string;
  reportingCurrency: string;
  hasForeignCurrency: boolean;
  oldestSourceDate: string | null;
  exceptionCount: number;
}

const REPORTING_CURRENCY = "NZD";

export function computeCashPosition(access: EntityAccess): CashPosition {
  const allEntities = db.select().from(entities).all();
  const allBankAccounts = db.select().from(entityBankAccounts).all();
  const thresholdRows = db.select().from(varianceThresholds).all();

  const rows: CashAccountRow[] = [];

  for (const account of allBankAccounts) {
    const entity = allEntities.find((e) => e.id === account.entityId);
    if (!entity) continue;
    // Filtered before the row is built, so an out-of-scope entity contributes
    // nothing to the totals or the exception count either.
    if (!canAccessEntity(access, entity.id)) continue;

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

    // A snapshot imported in one currency cannot be compared with a Xero
    // balance in another. Rather than silently subtracting them, the row
    // reports why no variance is shown.
    const currencyMismatch = Boolean(latestSnapshot && latestSnapshot.currency !== account.currency);

    let variance: CashAccountRow["variance"] = null;
    if (latestSnapshot && xeroAccount?.currentBalance && !currencyMismatch) {
      const bankBalance = Money.of(latestSnapshot.closingBalance, latestSnapshot.currency);
      const xeroBalance = Money.of(xeroAccount.currentBalance, latestSnapshot.currency);
      const diff = bankBalance.subtract(xeroBalance);
      const pct = variancePercent(bankBalance, xeroBalance);
      variance = {
        amount: diff.toFixedString(2),
        percent: pct ? pct.toFixed(2) : null,
        currency: latestSnapshot.currency,
      };
    }

    const threshold = resolveThreshold(thresholdRows, entity.id, "cash");
    const isException = variance
      ? isVarianceException(variance.amount, variance.percent, threshold, variance.currency)
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
      currency: account.currency,
      isLoanFacility: account.isLoanFacility,
      bankBalance: latestSnapshot?.closingBalance ?? null,
      bankBalanceDate: latestSnapshot?.balanceDate ?? null,
      xeroBalance: xeroAccount?.currentBalance ?? null,
      xeroBalanceDate: xeroAccount?.balanceAsAt ?? null,
      variance,
      currencyMismatch,
      threshold,
      isException,
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

  // Totalled per currency, never summed across them. Adding USD to NZD needs a
  // dated, approved FX rate, and there is no rate source in this build, so a
  // single figure would be a made-up number presented as cash on hand.
  const totalsByCurrency = new Map<string, Money>();
  for (const row of availableCashRows) {
    const running = totalsByCurrency.get(row.currency) ?? Money.zero(row.currency);
    totalsByCurrency.set(row.currency, running.add(Money.of(row.bankBalance!, row.currency)));
  }

  const availableCashByCurrency = [...totalsByCurrency.entries()]
    .map(([currency, total]) => ({ currency, amount: total.toFixedString(2) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    accounts: rows,
    availableCashByCurrency,
    // The headline figure is the reporting currency alone, not a converted
    // group total.
    totalAvailableCash: totalsByCurrency.get(REPORTING_CURRENCY)?.toFixedString(2) ?? "0.00",
    reportingCurrency: REPORTING_CURRENCY,
    hasForeignCurrency: availableCashByCurrency.some((t) => t.currency !== REPORTING_CURRENCY),
    oldestSourceDate: oldestDateOnly(
      rows.map((r) => r.oldestSourceDate).filter((d): d is string => Boolean(d))
    ),
    exceptionCount: rows.filter((r) => r.isException).length,
  };
}
