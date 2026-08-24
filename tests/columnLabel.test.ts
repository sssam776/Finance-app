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
});
