import { describe, it, expect } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import {
  isValidDateOnly,
  daysSince,
  oldestDateOnly,
  nzDateOnlyNow,
  displayInNz,
  nowUtcIso,
  NZ_TIMEZONE,
} from "../lib/dates";

describe("isValidDateOnly", () => {
  it("accepts real dates", () => {
    expect(isValidDateOnly("2026-08-24")).toBe(true);
    expect(isValidDateOnly("2028-02-29")).toBe(true); // 2028 is a leap year
    expect(isValidDateOnly("2000-02-29")).toBe(true); // 2000 is, by the 400 rule
  });

  it("rejects dates that do not exist", () => {
    // Date.parse accepts all of these and silently rolls into the next month,
    // so a balance dated 2026-02-29 was filed under February while February's
    // own range ends on the 28th. The row landed in neither period.
    expect(isValidDateOnly("2026-02-29")).toBe(false);
    expect(isValidDateOnly("2026-02-30")).toBe(false);
    expect(isValidDateOnly("2026-04-31")).toBe(false);
    expect(isValidDateOnly("2026-06-31")).toBe(false);
    expect(isValidDateOnly("1900-02-29")).toBe(false); // not a leap year
  });

  it("rejects out-of-range months and days", () => {
    expect(isValidDateOnly("2026-13-01")).toBe(false);
    expect(isValidDateOnly("2026-00-10")).toBe(false);
    expect(isValidDateOnly("2026-01-00")).toBe(false);
    expect(isValidDateOnly("2026-01-32")).toBe(false);
  });

  it("rejects wrong shapes", () => {
    expect(isValidDateOnly("24/08/2026")).toBe(false);
    expect(isValidDateOnly("2026-8-24")).toBe(false);
    expect(isValidDateOnly("2026-08-24T00:00:00Z")).toBe(false);
    expect(isValidDateOnly("")).toBe(false);
  });
});

describe("daysSince", () => {
  it("counts whole days back", () => {
    expect(daysSince("2026-08-20", "2026-08-24T03:00:00Z")).toBe(4);
  });

  it("reports zero for a balance dated today in NZ", () => {
    // 20:00 UTC is 08:00 the next morning in Auckland. Diffing the accounting
    // date against the raw UTC instant returned -1 here: a balance dated today
    // reported as one day in the future.
    expect(daysSince("2026-08-24", "2026-08-23T20:00:00Z")).toBe(0);
  });

  it("reports one full day for yesterday, during the NZ business morning", () => {
    expect(daysSince("2026-08-23", "2026-08-23T20:00:00Z")).toBe(1);
  });

  it("never returns a negative for a date that is today or earlier in NZ", () => {
    // Every hour of a day, against a balance dated that NZ day.
    for (let hour = 0; hour < 24; hour++) {
      const instant = new Date(Date.UTC(2026, 7, 23, hour, 0, 0)).toISOString();
      const nzToday = formatInTimeZone(new Date(instant), NZ_TIMEZONE, "yyyy-MM-dd");
      expect(daysSince(nzToday, instant)).toBe(0);
    }
  });
});

describe("nzDateOnlyNow", () => {
  it("agrees with the NZ date shown by displayInNz for the same instant", () => {
    // Both derive the NZ calendar date from the same moment, so they must
    // agree. The earlier implementation applied the Pacific/Auckland offset
    // twice, which is correct on a host already in NZ and a day ahead for
    // twelve hours of every day on a UTC host. Production runs UTC, so this
    // disagreement is exactly what went wrong.
    const instant = nowUtcIso();
    expect(nzDateOnlyNow()).toBe(displayInNz(instant).slice(0, 10));
  });

  it("returns a date that passes validation", () => {
    expect(isValidDateOnly(nzDateOnlyNow())).toBe(true);
  });
});

describe("oldestDateOnly", () => {
  it("returns the stalest source date", () => {
    expect(oldestDateOnly(["2026-08-24", "2026-01-02", "2026-05-05"])).toBe("2026-01-02");
  });

  it("returns null for no dates", () => {
    expect(oldestDateOnly([])).toBeNull();
  });

  it("does not mutate the caller's array", () => {
    const dates = ["2026-08-24", "2026-01-02"];
    oldestDateOnly(dates);
    expect(dates).toEqual(["2026-08-24", "2026-01-02"]);
  });
});
