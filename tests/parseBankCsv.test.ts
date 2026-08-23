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

  it("rejects non-finite and exponent values that Number() would accept", () => {
    // Number.isNaN(Number("Infinity")) is false, so a looser check lets these
    // reach the database and then break every read of the cash position.
    for (const hostile of ["Infinity", "-Infinity", "1e999999999", "0x10", "1e5"]) {
      const csv = `Date,Balance\n01/06/2026,${hostile}\n`;
      expect(() => parseBankCsv(csv), hostile).toThrow(/Unrecognised numeric value/);
    }
  });

  it("rejects an absurdly long digit string", () => {
    const csv = `Date,Balance\n01/06/2026,${"9".repeat(40)}\n`;
    expect(() => parseBankCsv(csv)).toThrow(/Unrecognised numeric value/);
  });

  it("rejects more decimal places than money carries", () => {
    const csv = `Date,Balance\n01/06/2026,100.123456\n`;
    expect(() => parseBankCsv(csv)).toThrow(/Unrecognised numeric value/);
  });

  it("still accepts the formats banks actually export", () => {
    const csv = `Date,Amount,Balance\n01/06/2026,"-1,500.00","12,345.67"\n`;
    const result = parseBankCsv(csv);
    expect(result.closingBalance).toBe("12345.67");
    expect(result.rows[0]!.amount).toBe("-1500.00");
  });

  it("reads bracketed negatives as negative", () => {
    const csv = `Date,Amount,Balance\n01/06/2026,(250.00),(1000.00)\n`;
    const result = parseBankCsv(csv);
    expect(result.closingBalance).toBe("-1000.00");
    expect(result.rows[0]!.amount).toBe("-250.00");
  });
});
