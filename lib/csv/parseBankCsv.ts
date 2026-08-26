import { parse } from "csv-parse/sync";
import { isValidDateOnly, type DateOnly } from "../dates";

/**
 * ASB and BNZ CSV exports are transaction listings, not a single balance
 * figure. Both banks' standard exports include a per-row running balance
 * column when the customer selects "include balance" at export time.
 *
 * ASSUMPTION — unverified, decision required: this parser assumes the
 * uploaded file is such an export and derives the account's closing balance
 * from the balance on the last (most recent) row. Confirm this against an
 * actual ASB and BNZ export before relying on this for a real close.
 *
 * Column names are matched case-insensitively against known aliases because
 * ASB and BNZ do not use identical headers.
 */

export const PARSER_VERSION = "bank-csv-v1";

export interface ParsedBankRow {
  date: DateOnly;
  description: string;
  amount: string | null;
  balance: string;
  rowNumber: number;
}

export interface ParsedBankCsvResult {
  rows: ParsedBankRow[];
  closingBalance: string;
  balanceDate: DateOnly;
  currency: string;
}

const DATE_ALIASES = ["date", "transaction date", "tran date"];
const BALANCE_ALIASES = ["balance", "running balance", "account balance"];
const AMOUNT_ALIASES = ["amount", "tran amount", "value"];
const DESCRIPTION_ALIASES = ["description", "payee", "particulars", "memo", "narrative", "details"];

function findColumn(headers: string[], aliases: string[]): string | undefined {
  const lowered = headers.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const idx = lowered.indexOf(alias);
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

function toDateOnly(raw: string): DateOnly {
  const trimmed = raw.trim();
  // Both banks commonly export dd/mm/yyyy.
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const dateOnly = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    if (isValidDateOnly(dateOnly)) return dateOnly;
  }
  if (isValidDateOnly(trimmed)) return trimmed;
  throw new Error(`Unrecognised date format: "${raw}". Expected dd/mm/yyyy or yyyy-mm-dd.`);
}

/**
 * A bank statement holds plain fixed-point amounts. Anything else in a balance
 * column is a malformed or hostile file, not a number to be stored.
 *
 * `Number.isNaN(Number(x))` is not sufficient on its own: it accepts
 * "Infinity", "1e999999999" and "0x10", all of which survive into the database
 * as strings and then break or explode the cash position when Decimal tries to
 * materialise them. Matching an explicit grammar first is the only reliable
 * filter.
 */
const FIXED_POINT = /^-?\d{1,15}(\.\d{1,4})?$/;

function toDecimalString(raw: string): string {
  const cleaned = raw.replace(/[,$]/g, "").trim();
  // Accounting negatives are often exported as (1,234.56).
  const normalised = /^\(.*\)$/.test(cleaned) ? `-${cleaned.slice(1, -1)}` : cleaned;

  if (!FIXED_POINT.test(normalised)) {
    throw new Error(
      `Unrecognised numeric value: "${raw}". Expected a plain amount such as -1234.56, at most 15 digits and 4 decimal places.`
    );
  }
  return normalised;
}

export function parseBankCsv(fileContents: string, currency = "NZD"): ParsedBankCsvResult {
  const records: Record<string, string>[] = parse(fileContents, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error("CSV file contains no data rows.");
  }

  const headers = Object.keys(records[0]!);
  const dateCol = findColumn(headers, DATE_ALIASES);
  const balanceCol = findColumn(headers, BALANCE_ALIASES);
  const amountCol = findColumn(headers, AMOUNT_ALIASES);
  const descCol = findColumn(headers, DESCRIPTION_ALIASES);

  if (!dateCol) {
    throw new Error(`Could not find a date column. Found headers: ${headers.join(", ")}`);
  }
  if (!balanceCol) {
    throw new Error(
      `Could not find a running-balance column. Re-export with balance included. Found headers: ${headers.join(", ")}`
    );
  }

  const rows: ParsedBankRow[] = records.map((record, index) => ({
    date: toDateOnly(record[dateCol]!),
    description: descCol ? record[descCol] ?? "" : "",
    amount: amountCol ? toDecimalString(record[amountCol]!) : null,
    balance: toDecimalString(record[balanceCol]!),
    rowNumber: index + 2, // +1 header row, +1 for 1-indexing
  }));

  const last = rows[rows.length - 1]!;

  return {
    rows,
    closingBalance: last.balance,
    balanceDate: last.date,
    currency,
  };
}
