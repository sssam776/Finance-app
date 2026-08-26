import { formatInTimeZone } from "date-fns-tz";

/**
 * Accounting dates (invoice date, bank balance date) are stored as
 * date-only strings (YYYY-MM-DD) with no timezone attached, per spec Part XI.16.
 * Operational timestamps (sync time, import time) are stored in UTC ISO-8601
 * and rendered in Pacific/Auckland for display.
 */

export const NZ_TIMEZONE = "Pacific/Auckland";

export type DateOnly = string; // YYYY-MM-DD
export type UtcTimestamp = string; // ISO-8601 UTC

export function nowUtcIso(): UtcTimestamp {
  return new Date().toISOString();
}

/**
 * Rejects dates that do not exist, which `Date.parse` alone does not.
 * `Date.parse("2026-02-29")` succeeds and silently yields 1 March, so a
 * balance dated 29 February 2026 would be filed under February while
 * February's own range ends on the 28th, putting the row in neither month.
 *
 * The check round-trips instead: build the date from its own parts and
 * require it to report those parts back.
 */
export function isValidDateOnly(value: string): value is DateOnly {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

export function displayInNz(utcTimestamp: UtcTimestamp): string {
  return formatInTimeZone(new Date(utcTimestamp), NZ_TIMEZONE, "yyyy-MM-dd HH:mm:ss zzz");
}

/**
 * `formatInTimeZone` takes a UTC instant and converts it itself. Passing it a
 * value already shifted by `toZonedTime` applies the offset twice, which is
 * correct on a host whose local zone is already Pacific/Auckland and wrong for
 * twelve hours of every day on a UTC host. Production runs UTC.
 */
export function nzDateOnlyNow(): DateOnly {
  return formatInTimeZone(new Date(), NZ_TIMEZONE, "yyyy-MM-dd");
}

/** Given a set of source date-only strings, returns the oldest (stalest) one. */
export function oldestDateOnly(dates: DateOnly[]): DateOnly | null {
  if (dates.length === 0) return null;
  return [...dates].sort()[0]!;
}

/**
 * Whole days between two NZ calendar dates.
 *
 * The reference instant is resolved to its NZ calendar date first. Diffing an
 * NZ accounting date against a raw UTC instant is wrong for the whole NZ
 * business morning, because NZ is UTC+12 or +13: at 20:00 UTC it is already
 * 08:00 the next day in Auckland, so a balance dated today reported as one
 * day in the future.
 */
export function daysSince(dateOnly: DateOnly, referenceUtc: UtcTimestamp = nowUtcIso()): number {
  const referenceDateOnly = formatInTimeZone(new Date(referenceUtc), NZ_TIMEZONE, "yyyy-MM-dd");

  const source = Date.parse(`${dateOnly}T00:00:00Z`);
  const reference = Date.parse(`${referenceDateOnly}T00:00:00Z`);

  return Math.round((reference - source) / (1000 * 60 * 60 * 24));
}
