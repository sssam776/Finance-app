import { describe, it, expect } from "vitest";
import { periodKeyFromColumnLabel } from "../lib/variance/columnLabel";

describe("periodKeyFromColumnLabel", () => {
  it("reads Xero's abbreviated month labels", () => {
    expect(periodKeyFromColumnLabel("Aug 2026")).toBe("2026-08");
    expect(periodKeyFromColumnLabel("Jan 2025")).toBe("2025-01");
    expect(periodKeyFromColumnLabel("Dec 2026")).toBe("2026-12");
  });

  it("reads full month names", () => {
    expect(periodKeyFromColumnLabel("August 2026")).toBe("2026-08");
    expect(periodKeyFromColumnLabel("September 2026")).toBe("2026-09");
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(periodKeyFromColumnLabel("  AUG 2026 ")).toBe("2026-08");
    expect(periodKeyFromColumnLabel("aug 2026")).toBe("2026-08");
  });

  it("passes an existing period key through unchanged", () => {
    expect(periodKeyFromColumnLabel("2026-08")).toBe("2026-08");
  });

  it("returns null rather than guessing at an unrecognised label", () => {
    // A mislabelled column files a figure under the wrong month, and nothing
    // downstream can tell. Missing is recoverable; wrong is not.
    expect(periodKeyFromColumnLabel("Total")).toBeNull();
    expect(periodKeyFromColumnLabel("Year to date")).toBeNull();
    expect(periodKeyFromColumnLabel("Budget")).toBeNull();
    expect(periodKeyFromColumnLabel("")).toBeNull();
  });

  it("rejects a month name that is not a real month", () => {
    expect(periodKeyFromColumnLabel("Smarch 2026")).toBeNull();
  });

  it("rejects a year outside the plausible reporting window", () => {
    // isValidPeriodKey guards the years Date.UTC would silently remap.
    expect(periodKeyFromColumnLabel("Aug 0050")).toBeNull();
    expect(periodKeyFromColumnLabel("Aug 2500")).toBeNull();
  });

  it("does not accept a bare year or a bare month", () => {
    expect(periodKeyFromColumnLabel("2026")).toBeNull();
    expect(periodKeyFromColumnLabel("Aug")).toBeNull();
  });

  it("reads Xero's date-style period-end headers", () => {
    // Xero returns this shape on P&L period columns. Rejecting it meant every
    // amount in the report was skipped and the snapshot came back empty.
    expect(periodKeyFromColumnLabel("28 Feb 18")).toBe("2018-02");
    expect(periodKeyFromColumnLabel("30 Jun 23")).toBe("2023-06");
    expect(periodKeyFromColumnLabel("31 Aug 2026")).toBe("2026-08");
    expect(periodKeyFromColumnLabel("1 Jan 2026")).toBe("2026-01");
  });

  it("reads a two-digit year as this century", () => {
    expect(periodKeyFromColumnLabel("31 Dec 99")).toBe("2099-12");
    expect(periodKeyFromColumnLabel("31 Dec 00")).toBe("2000-12");
  });

  it("still rejects a date-style label with an unreal month", () => {
    expect(periodKeyFromColumnLabel("28 Feb")).toBeNull();
    expect(periodKeyFromColumnLabel("28 Smarch 18")).toBeNull();
  });
});
