import { formatInTimeZone, toZonedTime } from "date-fns-tz";

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

export function isValidDateOnly(value: string): value is DateOnly {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function displayInNz(utcTimestamp: UtcTimestamp): string {
  return formatInTimeZone(new Date(utcTimestamp), NZ_TIMEZONE, "yyyy-MM-dd HH:mm:ss zzz");
}

export function nzDateOnlyNow(): DateOnly {
  const zoned = toZonedTime(new Date(), NZ_TIMEZONE);
  return formatInTimeZone(zoned, NZ_TIMEZONE, "yyyy-MM-dd");
}

/** Given a set of source date-only strings, returns the oldest (stalest) one. */
export function oldestDateOnly(dates: DateOnly[]): DateOnly | null {
  if (dates.length === 0) return null;
  return [...dates].sort()[0]!;
}

export function daysSince(dateOnly: DateOnly, referenceUtc: UtcTimestamp = nowUtcIso()): number {
  const ref = new Date(referenceUtc);
  const source = new Date(`${dateOnly}T00:00:00Z`);
  const diffMs = ref.getTime() - source.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
