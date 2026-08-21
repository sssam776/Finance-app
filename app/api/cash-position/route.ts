import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { entities, entityBankAccounts, bankBalanceSnapshots, xeroAccounts } from "@/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { Money, variancePercent } from "@/lib/money";
import { oldestDateOnly } from "@/lib/dates";

/**
 * CASH-001..006: per mapped bank account, the latest bank-source balance,
 * the latest Xero account balance (if mapped), and the variance between
 * them. This is a variance/control view, not bank reconciliation (CASH-004).
 */

export async function GET() {
  const allEntities = db.select().from(entities).all();
  const allBankAccounts = db.select().from(entityBankAccounts).all();

  const rows = [];

  for (const account of allBankAccounts) {
    const entity = allEntities.find((e) => e.id === account.entityId);
    if (!entity) continue;

    const latestSnapshot = db
      .select()
      .from(bankBalanceSnapshots)
      .where(eq(bankBalanceSnapshots.entityBankAccountId, account.id))
      .orderBy(desc(bankBalanceSnapshots.balanceDate))
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
  });
}
