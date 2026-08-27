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
      expect(escapeCsvField("=1+1")).toBe('"\t=1+1"');
    });

    it("defuses the other spreadsheet triggers", () => {
      expect(escapeCsvField("+SUM(A1)")).toBe('"\t+SUM(A1)"');
      expect(escapeCsvField("@import")).toBe('"\t@import"');
    });

    it("defuses a command disguised as an account name", () => {
      const hostile = '=cmd|\' /C calc\'!A0';
      expect(escapeCsvField(hostile).startsWith('"\t=')).toBe(true);
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
      expect(escapeCsvField("-1+1")).toBe('"\t-1+1"');
      expect(escapeCsvField("-1250.00.00")).toBe('"\t-1250.00.00"');
      expect(escapeCsvField("-cmd|' /C calc'!A0")).toBe('"\t-cmd|\' /C calc\'!A0"');
    });

    it("does not defuse an ordinary positive figure", () => {
      expect(escapeCsvField("764625.62")).toBe("764625.62");
    });

    it("quotes as well when a hostile cell also contains a comma", () => {
      expect(escapeCsvField("=A1,B2")).toBe('"\t=A1,B2"');
    });

    it("always quotes a defused cell so the tab cannot open the record", () => {
      // Tab is itself a trigger, so an unquoted tab prefix is not a defence.
      // Quoting is what makes it a leading character of a text cell.
      const escaped = escapeCsvField("=1+1");
      expect(escaped.startsWith('"\t')).toBe(true);
      expect(escaped.endsWith('"')).toBe(true);
    });

    describe("a leading byte must not walk past the check", () => {
      /**
       * The test was startsWith on the raw string, so every one of these was
       * emitted untouched. Nothing upstream trims: Xero account names are
       * stored exactly as returned, and bank account names are validated with
       * a bare min(1).
       */
      const prefixes: [string, string][] = [
        ["space", "\u0020"],
        ["tab", "\t"],
        ["non-breaking space", "\u00a0"],
        ["vertical tab", "\u000b"],
        ["form feed", "\u000c"],
        ["NUL", "\u0000"],
        ["BOM", "\ufeff"],
        ["en quad", "\u2000"],
        ["zero-width space", "\u200b"],
        ["right-to-left mark", "\u200f"],
        ["line separator", "\u2028"],
        ["ideographic space", "\u3000"],
      ];

      for (const [name, prefix] of prefixes) {
        it(`defuses a formula behind a leading ${name}`, () => {
          const escaped = escapeCsvField(`${prefix}=1+1`);
          expect(escaped.startsWith('"\t')).toBe(true);
          // The original value survives intact: altering finance data to make
          // it safe is worse than a cell that reads oddly.
          expect(escaped).toContain(`${prefix}=1+1`);
        });
      }

      it("defuses every formula character behind a leading space", () => {
        for (const trigger of ["=", "+", "-", "@"]) {
          expect(escapeCsvField(` ${trigger}SUM(1+1)`).startsWith('"\t')).toBe(true);
        }
      });

      it("defuses a formula behind a whole run of ignorable bytes", () => {
        expect(escapeCsvField(" \t  ﻿=1+1").startsWith('"\t')).toBe(true);
      });

      it("leaves text alone when the ignorable run is followed by ordinary text", () => {
        // Whitespace before plain text is not an attack. Tab, CR and LF only
        // matter when a formula character follows them, and treating every
        // leading tab as hostile would defuse ordinary indented labels.
        expect(escapeCsvField(" \tSUM(1+1)")).toBe(" \tSUM(1+1)");
      });

      it("still quotes a field carrying CR or LF so it cannot forge a record", () => {
        expect(escapeCsvField(" \rSUM(1+1)")).toBe('" \rSUM(1+1)"');
        expect(escapeCsvField(" \nSUM(1+1)")).toBe('" \nSUM(1+1)"');
      });
    });

    it("defuses a leading line feed, not only a carriage return", () => {
      // Both survive CSV parsing inside a quoted field.
      expect(escapeCsvField("\n=1+1").startsWith('"\t')).toBe(true);
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
