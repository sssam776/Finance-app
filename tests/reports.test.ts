import { describe, it, expect } from "vitest";
import { RowType, type ReportWithRows } from "xero-node";
import {
  rowsOf,
  headersOf,
  columnIndex,
  parseReportAmount,
  payloadHash,
  trialBalanceBalances,
  parseBankSummaryClosingBalances,
  bankSummaryColumnResolved,
  classifySection,
  parseProfitAndLoss,
} from "../lib/xero/reports";

/** Xero's shape: one report, a header row, then sections of rows of cells. */
function report(rows: unknown[]): ReportWithRows {
  return { reports: [{ rows }] } as unknown as ReportWithRows;
}

const header = (values: string[]) => ({
  rowType: RowType.Header,
  cells: values.map((v) => ({ value: v })),
});

const section = (title: string, rows: unknown[]) => ({
  rowType: RowType.Section,
  title,
  rows,
});

const row = (values: string[], attributes?: Record<string, string>[]) => ({
  rowType: RowType.Row,
  cells: values.map((v, i) => ({
    value: v,
    attributes: attributes?.[i]
      ? Object.entries(attributes[i]!).map(([id, value]) => ({ id, value }))
      : undefined,
  })),
});

describe("rowsOf", () => {
  it("walks sections and preserves the report's own ordering", () => {
    const walked = rowsOf(
      report([
        header(["Account", "Balance"]),
        section("Assets", [row(["Cheque", "100.00"]), row(["Savings", "200.00"])]),
        section("Liabilities", [row(["Card", "-50.00"])]),
      ])
    );

    expect(walked.map((r) => r.cells[0]!.value)).toEqual(["Cheque", "Savings", "Card"]);
    expect(walked.map((r) => r.rowOrder)).toEqual([0, 1, 2]);
  });

  it("carries the section title onto each row", () => {
    const walked = rowsOf(report([section("Assets", [row(["Cheque", "100.00"])])]));
    expect(walked[0]!.sectionTitle).toBe("Assets");
  });

  it("exposes cell attributes, which is where Xero puts the account id", () => {
    const walked = rowsOf(
      report([section("Assets", [row(["Cheque", "100.00"], [{ account: "abc-123" }])])])
    );
    expect(walked[0]!.cells[0]!.attributes.account).toBe("abc-123");
  });

  it("marks summary rows as subtotals rather than dropping them", () => {
    const walked = rowsOf(
      report([
        section("Assets", [
          row(["Cheque", "100.00"]),
          { rowType: RowType.SummaryRow, cells: [{ value: "Total" }, { value: "100.00" }] },
        ]),
      ])
    );
    expect(walked).toHaveLength(2);
    expect(walked[1]!.isSubtotal).toBe(true);
    expect(walked[0]!.isSubtotal).toBe(false);
  });

  it("returns nothing for an empty report rather than throwing", () => {
    expect(rowsOf(report([]))).toEqual([]);
    expect(rowsOf({} as ReportWithRows)).toEqual([]);
  });

  it("normalises a null cell value to an empty string", () => {
    const walked = rowsOf(
      report([section("A", [{ rowType: RowType.Row, cells: [{ value: null }, { value: "1" }] }])])
    );
    expect(walked[0]!.cells[0]!.value).toBe("");
  });
});

describe("column selection", () => {
  const bankSummary = report([
    header(["Account", "Opening Balance", "Cash Received", "Cash Spent", "Closing Balance"]),
    section("Bank", [row(["Cheque", "10.00", "5.00", "2.00", "13.00"])]),
  ]);

  it("reads the headers", () => {
    expect(headersOf(bankSummary)).toHaveLength(5);
    expect(headersOf(bankSummary)[4]).toBe("Closing Balance");
  });

  it("finds a column by header rather than by position", () => {
    expect(columnIndex(bankSummary, /clos/i)).toBe(4);
    expect(columnIndex(bankSummary, /opening/i)).toBe(1);
  });

  it("returns -1 when no column matches", () => {
    expect(columnIndex(bankSummary, /nonexistent/i)).toBe(-1);
  });
});

describe("parseBankSummaryClosingBalances", () => {
  it("selects the closing column by header", () => {
    const balances = parseBankSummaryClosingBalances(
      report([
        header(["Account", "Opening Balance", "Cash Received", "Cash Spent", "Closing Balance"]),
        section("Bank", [row(["Cheque", "10.00", "5.00", "2.00", "13.00"])]),
      ])
    );
    expect(balances[0]!.closingBalance).toBe("13.00");
  });

  it("does not take the last cell when closing is not last", () => {
    // The original implementation read the last cell unconditionally, so a
    // column order change produced a confidently wrong balance.
    const balances = parseBankSummaryClosingBalances(
      report([
        header(["Account", "Closing Balance", "Opening Balance"]),
        section("Bank", [row(["Cheque", "13.00", "10.00"])]),
      ])
    );
    expect(balances[0]!.closingBalance).toBe("13.00");
  });

  it("falls back to the last cell when the report carries no headers", () => {
    const balances = parseBankSummaryClosingBalances(
      report([section("Bank", [row(["Cheque", "10.00", "13.00"])])])
    );
    expect(balances[0]!.closingBalance).toBe("13.00");
  });

  it("reports whether the column was resolved by header or guessed", () => {
    const withHeader = report([
      header(["Account", "Closing Balance"]),
      section("Bank", [row(["Cheque", "13.00"])]),
    ]);
    const withoutHeader = report([section("Bank", [row(["Cheque", "13.00"])])]);

    expect(bankSummaryColumnResolved(withHeader)).toBe(true);
    expect(bankSummaryColumnResolved(withoutHeader)).toBe(false);
  });

  it("captures the account id when the row carries one", () => {
    const balances = parseBankSummaryClosingBalances(
      report([
        header(["Account", "Closing Balance"]),
        section("Bank", [row(["Cheque", "13.00"], [{ account: "guid-1" }])]),
      ])
    );
    expect(balances[0]!.xeroAccountId).toBe("guid-1");
  });

  it("leaves the account id null when absent, so the caller can fall back", () => {
    const balances = parseBankSummaryClosingBalances(
      report([header(["Account", "Closing Balance"]), section("Bank", [row(["Cheque", "13.00"])])])
    );
    expect(balances[0]!.xeroAccountId).toBeNull();
  });
});

describe("parseReportAmount", () => {
  it("parses plain amounts to four decimal places", () => {
    expect(parseReportAmount("1234.56")).toBe("1234.5600");
    expect(parseReportAmount("-50")).toBe("-50.0000");
  });

  it("strips thousands separators and currency symbols", () => {
    expect(parseReportAmount("$1,234.56")).toBe("1234.5600");
  });

  it("reads bracketed accounting negatives", () => {
    expect(parseReportAmount("(1,234.56)")).toBe("-1234.5600");
  });

  it("returns null for a blank cell rather than zero", () => {
    // A blank cell means no figure, which is not the same as a balance of zero.
    expect(parseReportAmount("")).toBeNull();
    expect(parseReportAmount("   ")).toBeNull();
  });

  it("rejects values that are not fixed-point numbers", () => {
    expect(parseReportAmount("Infinity")).toBeNull();
    expect(parseReportAmount("1e99")).toBeNull();
    expect(parseReportAmount("n/a")).toBeNull();
  });
});

describe("trialBalanceBalances", () => {
  it("accepts equal debits and credits", () => {
    expect(trialBalanceBalances("1000.00", "1000.00")).toBe(true);
  });

  it("accepts a rounding difference within tolerance", () => {
    expect(trialBalanceBalances("1000.00", "1000.01")).toBe(true);
  });

  it("rejects a real imbalance", () => {
    // A trial balance that does not balance means the parse is wrong, and
    // every figure derived from it is untrustworthy.
    expect(trialBalanceBalances("1000.00", "900.00")).toBe(false);
  });
});

describe("classifySection", () => {
  it("classifies the common Xero section titles", () => {
    expect(classifySection("Income")).toBe("revenue");
    expect(classifySection("Trading Income")).toBe("revenue");
    expect(classifySection("Cost of Sales")).toBe("cost_of_sales");
    expect(classifySection("Less Operating Expenses")).toBe("operating_expense");
    expect(classifySection("Other Income")).toBe("other_income");
    expect(classifySection("Gross Profit")).toBe("total");
    expect(classifySection("Net Profit")).toBe("total");
  });

  it("prefers the more specific match when titles overlap", () => {
    // "Cost of Sales" contains "sales", which would otherwise read as revenue
    // and invert the judgement for every account under it.
    expect(classifySection("Cost of Sales")).toBe("cost_of_sales");
    // "Total Income" contains "income" but is a computed row.
    expect(classifySection("Total Income")).toBe("total");
    // "Other Expense" must not fall through to operating_expense.
    expect(classifySection("Other Expenses")).toBe("other_expense");
  });

  it("returns unclassified rather than guessing", () => {
    // A misclassified section inverts favourable/adverse for every account in
    // it. Visibly unjudged beats silently wrong.
    expect(classifySection("Bespoke Section Name")).toBe("unclassified");
    expect(classifySection(null)).toBe("unclassified");
    expect(classifySection("")).toBe("unclassified");
  });

  it("is case-insensitive", () => {
    expect(classifySection("LESS OPERATING EXPENSES")).toBe("operating_expense");
  });
});

describe("parseProfitAndLoss", () => {
  const pl = report([
    header(["Account", "Aug 2026", "Jul 2026", "Aug 2025"]),
    section("Income", [row(["Sales", "10000.00", "9000.00", "8000.00"], [{ account: "guid-sales" }])]),
    section("Less Operating Expenses", [
      row(["Rent", "2000.00", "2000.00", "1800.00"]),
      { rowType: RowType.SummaryRow, cells: [{ value: "Total Expenses" }, { value: "2000.00" }] },
    ]),
  ]);

  it("returns one row per account with every column", () => {
    const rows = parseProfitAndLoss(pl);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.accountName).toBe("Sales");
    expect(rows[0]!.amountsByColumn).toHaveLength(3);
  });

  it("labels amounts from the report header rather than by position", () => {
    // If the number of comparison periods changes, a positional assumption
    // would silently shift which month a figure belongs to.
    const rows = parseProfitAndLoss(pl);
    expect(rows[0]!.amountsByColumn.map((c) => c.columnLabel)).toEqual([
      "Aug 2026",
      "Jul 2026",
      "Aug 2025",
    ]);
    expect(rows[0]!.amountsByColumn[0]!.amount).toBe("10000.0000");
  });

  it("classifies each row's section", () => {
    const rows = parseProfitAndLoss(pl);
    expect(rows[0]!.sectionKind).toBe("revenue");
    expect(rows[1]!.sectionKind).toBe("operating_expense");
  });

  it("carries the Xero account id where the row has one", () => {
    expect(parseProfitAndLoss(pl)[0]!.xeroAccountId).toBe("guid-sales");
    expect(parseProfitAndLoss(pl)[1]!.xeroAccountId).toBeNull();
  });

  it("marks subtotal rows so the caller can exclude them from account movement", () => {
    const rows = parseProfitAndLoss(pl);
    expect(rows.find((r) => r.accountName === "Total Expenses")!.isSubtotal).toBe(true);
    expect(rows[0]!.isSubtotal).toBe(false);
  });

  it("skips rows with a blank account name", () => {
    const withBlank = report([
      header(["Account", "Aug 2026"]),
      section("Income", [row(["", "0.00"]), row(["Sales", "10.00"])]),
    ]);
    expect(parseProfitAndLoss(withBlank)).toHaveLength(1);
  });
});

describe("payloadHash", () => {
  it("is stable for the same payload", () => {
    expect(payloadHash({ a: 1 })).toBe(payloadHash({ a: 1 }));
  });

  it("differs when the payload differs", () => {
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});
