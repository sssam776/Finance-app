import { RowType, type ReportWithRows } from "xero-node";

/**
 * Xero's tabular reports (Bank Summary, Balance Sheet, P&L, etc.) share one
 * shape: a top-level list of sections, each optionally containing nested
 * rows of cells. This extracts { accountName -> closing balance } from the
 * Bank Summary report.
 *
 * ASSUMPTION — unverified, decision required: this reads the *last* cell in
 * each account row as the closing balance, matching the standard Bank
 * Summary column order (Account, Opening Balance, Cash Received, Cash
 * Spent, Closing Balance). Confirm the actual column order against a live
 * Demo Company response before relying on this for a real comparison.
 */

export interface BankSummaryBalance {
  accountName: string;
  closingBalance: string;
}

export function parseBankSummaryClosingBalances(report: ReportWithRows): BankSummaryBalance[] {
  const results: BankSummaryBalance[] = [];
  const topLevelRows = report.reports?.[0]?.rows ?? [];

  for (const section of topLevelRows) {
    if (section.rowType !== RowType.Section || !section.rows) continue;
    for (const row of section.rows) {
      if (row.rowType !== RowType.Row || !row.cells || row.cells.length < 2) continue;
      const accountName = row.cells[0]?.value;
      const closingBalance = row.cells[row.cells.length - 1]?.value;
      if (accountName && closingBalance !== undefined) {
        results.push({ accountName, closingBalance });
      }
    }
  }

  return results;
}
