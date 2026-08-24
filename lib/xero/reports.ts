import { RowType, type ReportWithRows } from "xero-node";
import { createHash } from "node:crypto";
import Decimal from "decimal.js";

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
  /** Xero's account GUID when the row carries it. Matching on this beats matching on a user-editable name. */
  xeroAccountId: string | null;
}

export const REPORT_PARSER_VERSION = "xero-report-v1";

/** A cell's value plus whatever attributes Xero attached (account id lives here). */
export interface ReportCell {
  value: string;
  attributes: Record<string, string>;
}

export interface WalkedRow {
  rowOrder: number;
  sectionTitle: string | null;
  cells: ReportCell[];
  isSubtotal: boolean;
}

/**
 * The one walker.
 *
 * Every tabular Xero report shares the same shape: sections containing rows
 * containing cells. Six separate module plans each specified their own
 * function to walk it. This is that walk, once; per-report shaping is a small
 * function on top of these rows.
 *
 * Row order is preserved because Xero's own ordering carries meaning that the
 * account codes do not.
 */
export function rowsOf(report: ReportWithRows): WalkedRow[] {
  const walked: WalkedRow[] = [];
  const topLevel = report.reports?.[0]?.rows ?? [];
  let order = 0;

  for (const section of topLevel) {
    if (section.rowType !== RowType.Section || !section.rows) continue;
    const sectionTitle = section.title ?? null;

    for (const row of section.rows) {
      if (row.rowType !== RowType.Row && row.rowType !== RowType.SummaryRow) continue;
      if (!row.cells) continue;

      walked.push({
        rowOrder: order++,
        sectionTitle,
        isSubtotal: row.rowType === RowType.SummaryRow,
        cells: row.cells.map((cell) => ({
          value: cell.value === undefined || cell.value === null ? "" : String(cell.value),
          attributes: Object.fromEntries(
            (cell.attributes ?? []).map((a) => [String(a.id), String(a.value)])
          ),
        })),
      });
    }
  }

  return walked;
}

/** Column headers, in order. Selecting a column by name beats selecting by position. */
export function headersOf(report: ReportWithRows): string[] {
  const header = report.reports?.[0]?.rows?.find((r) => r.rowType === RowType.Header);
  return (header?.cells ?? []).map((c) => (c.value == null ? "" : String(c.value)));
}

/**
 * Index of the first header matching `pattern`, or -1.
 *
 * lib/xero/reports.ts previously assumed the closing balance was the last
 * cell in the row. Selecting by header instead means a column order change in
 * Xero produces no match rather than a silently wrong number.
 */
export function columnIndex(report: ReportWithRows, pattern: RegExp): number {
  return headersOf(report).findIndex((h) => pattern.test(h));
}

/** Xero reports money as plain strings, and empty for a blank cell. */
export function parseReportAmount(raw: string): string | null {
  const cleaned = raw.replace(/[,$\s]/g, "").trim();
  if (cleaned === "") return null;

  const bracketed = /^\(.*\)$/.test(cleaned) ? `-${cleaned.slice(1, -1)}` : cleaned;
  if (!/^-?\d+(\.\d+)?$/.test(bracketed)) return null;

  return new Decimal(bracketed).toFixed(4);
}

/** Stable hash of the raw response, so a stored snapshot can be tied to its payload. */
export function payloadHash(rawBody: unknown): string {
  return createHash("sha256").update(JSON.stringify(rawBody)).digest("hex");
}

/**
 * A trial balance whose debits and credits disagree means the parse is wrong,
 * and every figure derived from it is untrustworthy. Callers fail the sync run
 * on false rather than storing the rows.
 */
export function trialBalanceBalances(
  debitTotal: string,
  creditTotal: string,
  tolerance = "0.01"
): boolean {
  return new Decimal(debitTotal).minus(creditTotal).abs().lessThanOrEqualTo(new Decimal(tolerance));
}

export type PlSectionKind =
  | "revenue"
  | "cost_of_sales"
  | "operating_expense"
  | "other_income"
  | "other_expense"
  | "total"
  | "unclassified";

/**
 * Xero section titles vary by organisation and by chart of accounts, so this
 * is a best effort over the common ones. Anything unrecognised returns
 * `unclassified` rather than guessing, because a misclassified section inverts
 * the favourable/adverse judgement for every account inside it, and a row
 * marked unclassified is visibly unjudged rather than silently wrong.
 */
export function classifySection(title: string | null): PlSectionKind {
  if (!title) return "unclassified";
  const t = title.toLowerCase();

  if (/total|gross profit|net profit|net income|net surplus/.test(t)) return "total";
  if (/cost of (sales|goods)|direct cost/.test(t)) return "cost_of_sales";
  if (/other income|non-?operating income/.test(t)) return "other_income";
  if (/other expense|non-?operating expense/.test(t)) return "other_expense";
  if (/expense|overhead|operating cost|less /.test(t)) return "operating_expense";
  if (/income|revenue|turnover|sales/.test(t)) return "revenue";

  return "unclassified";
}

export interface PlAccountRow {
  section: string | null;
  sectionKind: PlSectionKind;
  accountName: string;
  xeroAccountId: string | null;
  /** Column label from the report header, in the order Xero returned them. */
  amountsByColumn: { columnLabel: string; amount: string | null }[];
  isSubtotal: boolean;
}

/**
 * Profit and loss, one row per account with every period column it carried.
 *
 * Column labels come from the report's own header rather than being assumed
 * positionally, so a change in how many comparison periods were requested
 * cannot silently shift which month a figure belongs to. The caller maps the
 * label to a period key; this function does not guess at date formats.
 */
export function parseProfitAndLoss(report: ReportWithRows): PlAccountRow[] {
  const headers = headersOf(report);

  return rowsOf(report)
    .filter((row) => row.cells.length >= 2 && row.cells[0]!.value.trim() !== "")
    .map((row) => ({
      section: row.sectionTitle,
      sectionKind: classifySection(row.sectionTitle),
      accountName: row.cells[0]!.value,
      xeroAccountId: row.cells[0]!.attributes.account ?? null,
      isSubtotal: row.isSubtotal,
      // Column 0 is the account name, so amounts start at 1.
      amountsByColumn: row.cells.slice(1).map((cell, i) => ({
        columnLabel: headers[i + 1] ?? `column_${i + 1}`,
        amount: parseReportAmount(cell.value),
      })),
    }));
}

export function parseBankSummaryClosingBalances(report: ReportWithRows): BankSummaryBalance[] {
  const results: BankSummaryBalance[] = [];
  const topLevelRows = report.reports?.[0]?.rows ?? [];
  // Located by header where the report provides one. The last-cell fallback is
  // the original unverified assumption and is kept only so a report without
  // headers still parses; bankSummaryColumnResolved() reports which was used.
  const closingIndex = columnIndex(report, /clos/i);

  for (const section of topLevelRows) {
    if (section.rowType !== RowType.Section || !section.rows) continue;
    for (const row of section.rows) {
      if (row.rowType !== RowType.Row || !row.cells || row.cells.length < 2) continue;
      const accountName = row.cells[0]?.value;
      const index = closingIndex >= 0 ? closingIndex : row.cells.length - 1;
      const closingBalance = row.cells[index]?.value;
      if (accountName && closingBalance !== undefined) {
        results.push({
          accountName: String(accountName),
          closingBalance: String(closingBalance),
          xeroAccountId:
            (row.cells[0]?.attributes ?? []).find((a) => String(a.id) === "account")?.value ?? null,
        });
      }
    }
  }

  return results;
}

/**
 * True when the closing balance was located by its column header rather than
 * by falling back to the last cell. The fallback is the documented, unverified
 * assumption; callers that care about trusting the figure can check this.
 */
export function bankSummaryColumnResolved(report: ReportWithRows): boolean {
  return columnIndex(report, /clos/i) >= 0;
}
