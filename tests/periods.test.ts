import { describe, it, expect } from "vitest";
import {
  periodKeyOf,
  periodRange,
  addMonths,
  priorPeriod,
  priorYear,
  periodsBetween,
  financialYearOf,
  financialYearPeriods,
  financialYearToDate,
  relativeLabel,
  formatPeriod,
  isValidPeriodKey,
  lastDayOfMonth,
} from "../lib/periods";

describe("period keys", () => {
  it("derives a key from a date", () => {
    expect(periodKeyOf("2026-03-31")).toBe("2026-03");
  });

  it("rejects a malformed date rather than slicing junk", () => {
    expect(() => periodKeyOf("31/03/2026")).toThrow(/Invalid date/);
  });

  it("validates the key format", () => {
    expect(isValidPeriodKey("2026-03")).toBe(true);
    expect(isValidPeriodKey("2026-13")).toBe(false);
    expect(isValidPeriodKey("2026-00")).toBe(false);
    expect(isValidPeriodKey("2026-3")).toBe(false);
    expect(isValidPeriodKey("March 2026")).toBe(false);
  });

  it("rejects years that Date.UTC would silently remap", () => {
    // Date.UTC maps years 0-99 to 1900-1999, so addMonths("0050-01", 1) used
    // to return "1950-02". A year under 1000 also formats to fewer than four
    // characters, breaking the lexicographic ordering everything else needs.
    expect(isValidPeriodKey("0050-01")).toBe(false);
    expect(isValidPeriodKey("0099-06")).toBe(false);
    expect(isValidPeriodKey("0100-01")).toBe(false);
    expect(isValidPeriodKey("0999-12")).toBe(false);
  });

  it("accepts the plausible reporting window and rejects outside it", () => {
    expect(isValidPeriodKey("1900-01")).toBe(true);
    expect(isValidPeriodKey("2199-12")).toBe(true);
    expect(isValidPeriodKey("2200-01")).toBe(false);
    expect(isValidPeriodKey("1899-12")).toBe(false);
  });
});

describe("periodRange", () => {
  it("covers the whole month", () => {
    expect(periodRange("2026-03")).toEqual({ key: "2026-03", start: "2026-03-01", end: "2026-03-31" });
  });

  it("handles 30-day months", () => {
    expect(periodRange("2026-04").end).toBe("2026-04-30");
  });

  it("handles February in a common year", () => {
    expect(periodRange("2026-02").end).toBe("2026-02-28");
  });

  it("handles February in a leap year", () => {
    expect(periodRange("2028-02").end).toBe("2028-02-29");
    expect(lastDayOfMonth(2028, 2)).toBe(29);
  });

  it("handles the century leap-year rule", () => {
    // 1900 was not a leap year; 2000 was.
    expect(lastDayOfMonth(1900, 2)).toBe(28);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
  });
});

describe("arithmetic", () => {
  it("rolls over a year boundary going forward", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("rolls back over a year boundary", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(priorPeriod("2026-01")).toBe("2025-12");
  });

  it("steps a full year", () => {
    expect(priorYear("2026-03")).toBe("2025-03");
    expect(addMonths("2026-03", 12)).toBe("2027-03");
  });

  it("handles large offsets", () => {
    expect(addMonths("2026-06", -30)).toBe("2023-12");
  });

  it("is reversible", () => {
    expect(addMonths(addMonths("2026-07", 17), -17)).toBe("2026-07");
  });
});

describe("periodsBetween", () => {
  it("is inclusive at both ends", () => {
    expect(periodsBetween("2026-01", "2026-03")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("returns a single period when both ends match", () => {
    expect(periodsBetween("2026-01", "2026-01")).toEqual(["2026-01"]);
  });

  it("returns nothing when the range is inverted, rather than looping", () => {
    expect(periodsBetween("2026-06", "2026-01")).toEqual([]);
  });

  it("spans a year boundary", () => {
    expect(periodsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("throws on an oversized range instead of silently truncating it", () => {
    // Previously this returned 1200 keys ending at 2099-12 and looked like a
    // complete answer. A caller summing over it reported a total for a range
    // it never covered, with nothing downstream able to tell.
    expect(() => periodsBetween("1950-01", "2150-12")).toThrow(/exceeds 1200 months/);
  });

  it("still returns a long but legitimate range in full", () => {
    const twentyFiveYears = periodsBetween("2000-01", "2024-12");
    expect(twentyFiveYears).toHaveLength(300);
    expect(twentyFiveYears[299]).toBe("2024-12");
  });
});

describe("financial years (March year end)", () => {
  it("names a year by the calendar year it ends in", () => {
    expect(financialYearOf("2026-03")).toBe(2026);
    expect(financialYearOf("2025-04")).toBe(2026);
  });

  it("puts the month after year end into the next financial year", () => {
    expect(financialYearOf("2026-04")).toBe(2027);
  });

  it("puts January through March into the year that ends in March", () => {
    expect(financialYearOf("2026-01")).toBe(2026);
    expect(financialYearOf("2026-02")).toBe(2026);
  });

  it("returns twelve periods ending at year end", () => {
    const fy = financialYearPeriods(2026);
    expect(fy).toHaveLength(12);
    expect(fy[0]).toBe("2025-04");
    expect(fy[11]).toBe("2026-03");
  });

  it("supports a December year end", () => {
    expect(financialYearOf("2026-01", 12)).toBe(2026);
    expect(financialYearOf("2026-12", 12)).toBe(2026);
    const fy = financialYearPeriods(2026, 12);
    expect(fy[0]).toBe("2026-01");
    expect(fy[11]).toBe("2026-12");
  });

  it("computes year to date", () => {
    const ytd = financialYearToDate("2025-06");
    expect(ytd).toEqual(["2025-04", "2025-05", "2025-06"]);
  });

  it("year to date at year end is the whole year", () => {
    expect(financialYearToDate("2026-03")).toHaveLength(12);
  });
});

describe("relativeLabel", () => {
  it("labels relative to the period being viewed, not absolutely", () => {
    // The point of deriving this: the same period is 'current' in one pack and
    // 'prior_year' in another twelve months later.
    expect(relativeLabel("2026-03", "2026-03")).toBe("current");
    expect(relativeLabel("2026-03", "2027-03")).toBe("prior_year");
    expect(relativeLabel("2026-03", "2026-04")).toBe("prior_period");
    expect(relativeLabel("2026-03", "2029-01")).toBe("other");
  });

  it("handles year boundaries", () => {
    expect(relativeLabel("2025-12", "2026-01")).toBe("prior_period");
    expect(relativeLabel("2025-01", "2026-01")).toBe("prior_year");
  });
});

describe("formatPeriod", () => {
  it("renders a readable heading", () => {
    expect(formatPeriod("2026-03")).toBe("March 2026");
    expect(formatPeriod("2026-12")).toBe("December 2026");
  });

  it("does not drift a month from timezone handling", () => {
    // Constructing 2026-01-01 in a UTC+13 zone without care yields December.
    expect(formatPeriod("2026-01")).toBe("January 2026");
  });
});
