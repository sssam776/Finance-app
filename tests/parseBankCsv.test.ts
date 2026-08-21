import { describe, it, expect } from "vitest";
import { parseBankCsv } from "../lib/csv/parseBankCsv";

const SAMPLE_ASB_STYLE = `Date,Unique Id,Tran Type,Payee,Memo,Amount,Balance
01/06/2026,1,DEBIT,Supplier A,Invoice 123,-500.00,4500.00
02/06/2026,2,CREDIT,Customer B,Payment,1000.00,5500.00
`;

describe("parseBankCsv", () => {
  it("derives the closing balance from the last row", () => {
    const result = parseBankCsv(SAMPLE_ASB_STYLE);
    expect(result.closingBalance).toBe("5500.00");
    expect(result.balanceDate).toBe("2026-06-02");
    expect(result.rows).toHaveLength(2);
  });

  it("throws a clear error when no balance column is present", () => {
    const noBalance = `Date,Amount\n01/06/2026,100\n`;
    expect(() => parseBankCsv(noBalance)).toThrow(/running-balance column/);
  });

  it("throws on empty file", () => {
    expect(() => parseBankCsv("Date,Balance\n")).toThrow(/no data rows/);
  });

  it("matches balance/date columns case-insensitively with BNZ-style headers", () => {
    const bnzStyle = `Date,Particulars,Amount,Balance\n15/07/2026,Rent,-200.00,10000.50\n`;
    const result = parseBankCsv(bnzStyle);
    expect(result.closingBalance).toBe("10000.50");
    expect(result.balanceDate).toBe("2026-07-15");
  });
});
