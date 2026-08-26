/**
 * CSV serialisation for exports.
 *
 * Two things make this more than a join with commas.
 *
 * A spreadsheet treats a cell beginning with `=`, `+`, `-`, `@`, tab or
 * carriage return as a formula. Account names in this app come from Xero,
 * where they are free text a user can edit, so an exported file can carry a
 * cell that executes when the recipient opens it. That is a real attack on a
 * finance team, who open exports for a living and are precisely the people
 * with something worth taking. Every field is checked and neutralised.
 *
 * The other is the byte order mark. Excel on Windows reads a UTF-8 file
 * without one as the system codepage, so an account name with a macron or a
 * currency symbol arrives corrupted. One byte prevents it.
 */

/** Cells opening with these are interpreted as formulas rather than text. */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

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

  let text = String(value);

  /**
   * Prefixed with a tab rather than stripped. Removing the character would
   * change the value, and a finance export that silently alters figures is
   * worse than one that fails. The tab defuses the formula and spreadsheets
   * do not display it.
   */
  if (!PLAIN_NUMBER.test(text) && FORMULA_TRIGGERS.some((t) => text.startsWith(t))) {
    text = `\t${text}`;
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
