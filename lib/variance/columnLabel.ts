import { isValidPeriodKey, type PeriodKey } from "../periods";

/**
 * Xero labels Profit and Loss columns with month names, "Aug 2026".
 *
 * Turning that back into a period key is unavoidable, so it happens in one
 * tested place. It returns null rather than guessing: a mislabelled column
 * files a figure under the wrong month, and a wrong month is worse than a
 * missing one because nothing downstream can tell.
 */

const MONTH_PREFIXES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function keyFrom(monthWord: string, yearDigits: string): PeriodKey | null {
  const monthIndex = MONTH_PREFIXES.indexOf(monthWord.slice(0, 3).toLowerCase());
  if (monthIndex < 0) return null;

  // Xero abbreviates the year in date-style headers ("28 Feb 18"). Two digits
  // are read as 2000-2099; the reporting window this app covers contains no
  // twentieth-century periods, and isValidPeriodKey rejects anything outside it.
  const year = yearDigits.length === 2 ? `20${yearDigits}` : yearDigits;
  const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return isValidPeriodKey(key) ? key : null;
}

export function periodKeyFromColumnLabel(label: string): PeriodKey | null {
  const trimmed = label.trim();

  // "Aug 2026" / "August 2026". Checked before isValidPeriodKey because that
  // is a type predicate over `string`, so calling it in an early return leaves
  // the remaining branch narrowed to `never`.
  const monthYear = trimmed.match(/^([A-Za-z]{3,})\s+(\d{4})$/);
  if (monthYear) return keyFrom(monthYear[1]!, monthYear[2]!);

  // "28 Feb 18" / "30 Jun 2023". Xero returns this shape for period-end
  // columns, and rejecting it meant every amount in the report was skipped as
  // unresolved and the snapshot came back empty.
  const dayMonthYear = trimmed.match(/^\d{1,2}\s+([A-Za-z]{3,})\s+(\d{2}|\d{4})$/);
  if (dayMonthYear) return keyFrom(dayMonthYear[1]!, dayMonthYear[2]!);

  // Already a period key, which a caller may pass through unchanged.
  return isValidPeriodKey(trimmed) ? trimmed : null;
}
