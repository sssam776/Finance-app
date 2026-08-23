import { isValidDateOnly, type DateOnly } from "./dates";

/**
 * Reporting periods, as the single axis every report is stored and compared
 * against (spec 14.7).
 *
 * Modules B, C, D, G and H each need "the month ending 31 March 2026", "the
 * same month last year" and "the twelve months of a financial year". Left to
 * themselves they invent different keys for the same period, and a P&L column
 * stored by one cannot be read by another.
 *
 * A period key is `YYYY-MM`. It records WHICH period a figure belongs to and
 * nothing about how it is being viewed. Storing a column as `prior_year`
 * instead bakes the question into the answer: the same month is `current` in
 * one board pack and `prior_year` in the next one twelve months later. The
 * comparison label is derived at read time by `relativeLabel`.
 *
 * Pure and dependency-light: date arithmetic uses UTC construction so it
 * cannot drift with the host timezone. These are accounting periods, not
 * instants, so no timezone applies to them.
 */

export type PeriodKey = string; // YYYY-MM

/** NZ companies most commonly close 31 March. Configurable per entity later. */
export const DEFAULT_FINANCIAL_YEAR_END_MONTH = 3;

export interface PeriodRange {
  key: PeriodKey;
  start: DateOnly;
  end: DateOnly;
}

export function isValidPeriodKey(value: string): value is PeriodKey {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  return true;
}

function assertPeriodKey(key: string): asserts key is PeriodKey {
  if (!isValidPeriodKey(key)) {
    throw new Error(`Invalid period key "${key}". Expected YYYY-MM.`);
  }
}

function parts(key: PeriodKey): { year: number; month: number } {
  assertPeriodKey(key);
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function periodKeyOf(dateOnly: DateOnly): PeriodKey {
  if (!isValidDateOnly(dateOnly)) {
    throw new Error(`Invalid date "${dateOnly}". Expected YYYY-MM-DD.`);
  }
  return dateOnly.slice(0, 7);
}

/** Last calendar day of the month, leap years included. Day 0 of the next month. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodRange(key: PeriodKey): PeriodRange {
  const { year, month } = parts(key);
  return {
    key,
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`,
  };
}

/** Negative offsets go back. `addMonths("2026-01", -1)` is `"2025-12"`. */
export function addMonths(key: PeriodKey, delta: number): PeriodKey {
  const { year, month } = parts(key);
  // Month is 0-indexed here so the Date constructor normalises the rollover.
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

export function priorPeriod(key: PeriodKey): PeriodKey {
  return addMonths(key, -1);
}

export function priorYear(key: PeriodKey): PeriodKey {
  return addMonths(key, -12);
}

/** Inclusive at both ends. Returns [] when `from` is after `to`. */
export function periodsBetween(from: PeriodKey, to: PeriodKey): PeriodKey[] {
  assertPeriodKey(from);
  assertPeriodKey(to);
  if (from > to) return [];

  const keys: PeriodKey[] = [];
  let cursor = from;
  // Bounded so a malformed input cannot spin: 100 years of months.
  for (let i = 0; i < 1200 && cursor <= to; i += 1) {
    keys.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return keys;
}

/**
 * The financial year a period falls in, named by the calendar year it ENDS in.
 * With a March year end, 2025-04 through 2026-03 are all FY2026.
 */
export function financialYearOf(
  key: PeriodKey,
  yearEndMonth: number = DEFAULT_FINANCIAL_YEAR_END_MONTH
): number {
  const { year, month } = parts(key);
  return month > yearEndMonth ? year + 1 : year;
}

export function financialYearPeriods(
  financialYear: number,
  yearEndMonth: number = DEFAULT_FINANCIAL_YEAR_END_MONTH
): PeriodKey[] {
  const end: PeriodKey = `${financialYear}-${pad(yearEndMonth)}`;
  return periodsBetween(addMonths(end, -11), end);
}

/** Year to date within the financial year, up to and including `key`. */
export function financialYearToDate(
  key: PeriodKey,
  yearEndMonth: number = DEFAULT_FINANCIAL_YEAR_END_MONTH
): PeriodKey[] {
  const fy = financialYearOf(key, yearEndMonth);
  const start = addMonths(`${fy}-${pad(yearEndMonth)}`, -11);
  return periodsBetween(start, key);
}

export type RelativeLabel = "current" | "prior_period" | "prior_year" | "other";

/**
 * Derived at read time, never stored. A figure's period is a fact; whether it
 * is "prior year" depends entirely on what it is being compared against.
 */
export function relativeLabel(key: PeriodKey, current: PeriodKey): RelativeLabel {
  if (key === current) return "current";
  if (key === priorPeriod(current)) return "prior_period";
  if (key === priorYear(current)) return "prior_year";
  return "other";
}

/** "March 2026", for headings. */
export function formatPeriod(key: PeriodKey): string {
  const { year, month } = parts(key);
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-NZ", {
    month: "long",
    timeZone: "UTC",
  });
  return `${name} ${year}`;
}
