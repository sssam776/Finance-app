import { describe, it, expect } from "vitest";
import { escapeCsvField, toCsv, csvFilename, CSV_BOM } from "../lib/csv/toCsv";

describe("escapeCsvField", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeCsvField("Rental Income")).toBe("Rental Income");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvField('Kayo "Trading" Ltd')).toBe('"Kayo ""Trading"" Ltd"');
  });

  it("quotes fields containing a comma", () => {
    expect(escapeCsvField("Auckland, New Zealand")).toBe('"Auckland, New Zealand"');
  });

  it("quotes fields containing a newline", () => {
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders null and undefined as empty rather than as the words", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  describe("formula injection", () => {
    /**
     * Account names come from Xero and are user-editable, so an export can
     * carry a cell that executes when a finance team opens it.
     */
    it("defuses a leading equals", () => {
      expect(escapeCsvField("=1+1")).toBe("\t=1+1");
    });

    it("defuses the other spreadsheet triggers", () => {
      expect(escapeCsvField("+SUM(A1)")).toBe("\t+SUM(A1)");
      expect(escapeCsvField("@import")).toBe("\t@import");
    });

    it("defuses a command disguised as an account name", () => {
      const hostile = '=cmd|\' /C calc\'!A0';
      expect(escapeCsvField(hostile).startsWith("\t=")).toBe(true);
    });

    it("leaves a negative figure alone so the column still sums", () => {
      // -1250.00 opens with a trigger character but is not a formula. Defusing
      // it would make the cell text, and a controller cannot total a column of
      // text. Every money and percentage column in this app can be negative.
      expect(escapeCsvField("-1250.00")).toBe("-1250.00");
      expect(escapeCsvField("-15.67")).toBe("-15.67");
      expect(escapeCsvField("-0")).toBe("-0");
    });

    it("still defuses something that only looks like a negative number", () => {
      expect(escapeCsvField("-1+1")).toBe("\t-1+1");
      expect(escapeCsvField("-1250.00.00")).toBe("\t-1250.00.00");
      expect(escapeCsvField("-cmd|' /C calc'!A0")).toBe("\t-cmd|' /C calc'!A0");
    });

    it("does not defuse an ordinary positive figure", () => {
      expect(escapeCsvField("764625.62")).toBe("764625.62");
    });

    it("quotes as well when a hostile cell also contains a comma", () => {
      expect(escapeCsvField("=A1,B2")).toBe('"\t=A1,B2"');
    });
  });
});

describe("toCsv", () => {
  it("writes a header row and CRLF line endings", () => {
    const csv = toCsv(["Account", "Amount"], [["Rental Income", "764625.62"]]);
    expect(csv).toBe("Account,Amount\r\nRental Income,764625.62");
  });

  it("handles an empty row set without emitting a stray line", () => {
    expect(toCsv(["Account"], [])).toBe("Account");
  });
});

describe("csvFilename", () => {
  it("joins the parts it is given", () => {
    expect(csvFilename(["pl-movement", "KAYO", "2026-07"])).toBe("pl-movement-KAYO-2026-07.csv");
  });

  it("drops empty parts rather than leaving separators behind", () => {
    expect(csvFilename(["cash", null, undefined, ""])).toBe("cash.csv");
  });

  it("replaces characters that are unsafe in a filename", () => {
    expect(csvFilename(["a/b", "c:d"])).toBe("a-b-c-d.csv");
  });

  it("never returns a bare extension", () => {
    expect(csvFilename([])).toBe("export.csv");
  });
});

describe("CSV_BOM", () => {
  it("is the UTF-8 byte order mark Excel needs", () => {
    expect(CSV_BOM).toBe("﻿");
  });
});
