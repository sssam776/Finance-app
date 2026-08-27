/**
 * CSV serialisation for exports.
 *
 * Two things make this more than a join with commas.
 *
 * A spreadsheet treats a cell beginning with `=`, `+`, `-`, `@`, tab, carriage
 * return or line feed as a formula. Account names in this app come from Xero,
 * where they are free text a user can edit, so an exported file can carry a
 * cell that executes when the recipient opens it. That is a real attack on a
 * finance team, who open exports for a living and are precisely the people
 * with something worth taking.
 *
 * The other is the byte order mark. Excel on Windows reads a UTF-8 file
 * without one as the system codepage, so an account name with a macron or a
 * currency symbol arrives corrupted. One byte prevents it.
 */

/** Cells opening with these are interpreted as formulas rather than text. */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r", "\n"];

/**
 * Stripped before the trigger test, never from the emitted value.
 *
 * The test used to be `startsWith` on the raw string, so a single leading byte
 * walked straight past it: a space, a non-breaking space, a BOM or any C0
 * control before the `=` and the cell was emitted untouched. Nothing upstream
 * trims either. `lib/xero/reports.ts` stores the account name exactly as Xero
 * returns it, and `app/api/bank-accounts/route.ts` validates with a bare
 * `z.string().min(1)`, so those values reach an export as typed.
 *
 * Whether a given spreadsheet then evaluates such a cell depends on its own
 * leading-whitespace handling on import. Depending on that is the defect: this
 * defence must not rest on an assumption the code neither states nor controls.
 */
const IGNORABLE_PREFIX = /^[\s\u0000-\u001f\u007f\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]+/;

/**
 * A plain decimal number, which is what every money and percentage column in
 * this app emits. `-6070.50` opens with a trigger character but is not a
 * formula in any spreadsheet, and this is the whole reason the check exists:
 * defusing it would make the cell text, and a column of text does not sum.
 * An export a controller cannot total is not much of an export.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";

  const text = String(value);
  if (PLAIN_NUMBER.test(text)) return text;

  const probe = text.replace(IGNORABLE_PREFIX, "");
  const dangerous = FORMULA_TRIGGERS.some((trigger) => probe.startsWith(trigger));

  /**
   * A defused cell is always quoted, and the tab goes inside the quotes.
   *
   * A bare tab prefix is not a defence on its own: tab is itself a trigger, so
   * an unquoted field can still open with one. Quoting is what makes the tab
   * an ordinary leading character of a text cell rather than the start of the
   * record, and it is the form the OWASP guidance describes.
   *
   * The tab does become part of the value, which `LEN()` and an exact-match
   * `VLOOKUP` will see. That is a real cost, accepted deliberately: stripping
   * the character instead would silently alter a figure, and altering finance
   * data to make it safe is worse than a cell that reads oddly.
   */
  if (dangerous) {
    return `"\t${text.replace(/"/g, '""')}"`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ];
  // CRLF is what the CSV specification calls for and what Excel expects.
  return lines.join("\r\n");
}

/** UTF-8 BOM, so Excel on Windows reads the encoding correctly. */
export const CSV_BOM = "﻿";

/**
 * A filename safe on every platform, carrying enough context that a folder of
 * these is still readable months later.
 */
export function csvFilename(parts: (string | null | undefined)[]): string {
  const slug = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join("-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "export"}.csv`;
}

export function csvResponse(filename: string, headers: string[], rows: unknown[][]): Response {
  return new Response(CSV_BOM + toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // An export is a point-in-time extract. A cached copy shown later would
      // be a different set of figures under the same name.
      "Cache-Control": "no-store",
    },
  });
}
