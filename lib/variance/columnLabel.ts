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

export function periodKeyFromColumnLabel(label: string): PeriodKey | null {
  const trimmed = label.trim();

  // A month-name label, which is what Xero returns. Checked first because
  // isValidPeriodKey is a type predicate over `string`, so calling it in an
  // early return leaves the remaining branch narrowed to `never`.
  const match = trimmed.match(/^([A-Za-z]{3,})\s+(\d{4})$/);
  if (match) {
    const monthIndex = MONTH_PREFIXES.indexOf(match[1]!.slice(0, 3).toLowerCase());
    if (monthIndex < 0) return null;

    const key = `${match[2]}-${String(monthIndex + 1).padStart(2, "0")}`;
    return isValidPeriodKey(key) ? key : null;
  }

  // Already a period key, which a caller may pass through unchanged.
  return isValidPeriodKey(trimmed) ? trimmed : null;
}
