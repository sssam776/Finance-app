import { describe, it, expect } from "vitest";
import { resolveThreshold, isVarianceException, type ThresholdRow } from "../lib/thresholds";

const GROUP = "*";

const ROWS: ThresholdRow[] = [
  { entityId: GROUP, context: "cash", absoluteAmount: "1000.00", percent: "1.00" },
  { entityId: "entity-with-override", context: "cash", absoluteAmount: "50.00", percent: null },
];

describe("resolveThreshold", () => {
  it("prefers an entity's own threshold over the group default", () => {
    const resolved = resolveThreshold(ROWS, "entity-with-override");
    expect(resolved).toEqual({
      scope: "entity",
      context: "cash",
      absoluteAmount: "50.00",
      percent: null,
    });
  });

  it("falls back to the group default", () => {
    const resolved = resolveThreshold(ROWS, "some-other-entity");
    expect(resolved).toEqual({
      scope: "group",
      context: "cash",
      absoluteAmount: "1000.00",
      percent: "1.00",
    });
  });

  it("returns null when nothing is configured at all", () => {
    expect(resolveThreshold([], "any-entity")).toBeNull();
  });

  it("defaults to the cash context, so existing callers are unchanged", () => {
    expect(resolveThreshold(ROWS, "some-other-entity")?.context).toBe("cash");
  });
});

describe("threshold contexts", () => {
  const MIXED: ThresholdRow[] = [
    { entityId: GROUP, context: "cash", absoluteAmount: "1000.00", percent: "1.00" },
    { entityId: GROUP, context: "balance_sheet", absoluteAmount: "25000.00", percent: null },
  ];

  it("resolves the context asked for, not whichever row comes first", () => {
    expect(resolveThreshold(MIXED, "e1", "cash")?.absoluteAmount).toBe("1000.00");
    expect(resolveThreshold(MIXED, "e1", "balance_sheet")?.absoluteAmount).toBe("25000.00");
  });

  it("never falls back across contexts", () => {
    // The bug this prevents: a $1,000 cash tolerance standing in for
    // balance-sheet materiality marks every account over $1,000 material and
    // buries the ones that matter.
    expect(resolveThreshold(MIXED, "e1", "pnl_movement")).toBeNull();
  });

  it("applies an entity override only within its own context", () => {
    const rows: ThresholdRow[] = [
      ...MIXED,
      { entityId: "e1", context: "cash", absoluteAmount: "10.00", percent: null },
    ];
    expect(resolveThreshold(rows, "e1", "cash")).toMatchObject({ scope: "entity", absoluteAmount: "10.00" });
    expect(resolveThreshold(rows, "e1", "balance_sheet")).toMatchObject({ scope: "group" });
  });
});

describe("isVarianceException", () => {
  const groupThreshold = resolveThreshold(ROWS, "some-other-entity");

  it("flags a variance over the amount trigger", () => {
    expect(isVarianceException("1000.01", null, groupThreshold)).toBe(true);
  });

  it("does not flag a variance exactly on the amount trigger", () => {
    expect(isVarianceException("1000.00", null, groupThreshold)).toBe(false);
  });

  it("flags on the percent trigger even when the amount is small", () => {
    // $10 is far under the $1,000 trigger, but 5% is over the 1% trigger.
    expect(isVarianceException("10.00", "5.00", groupThreshold)).toBe(true);
  });

  it("treats a negative variance by magnitude", () => {
    expect(isVarianceException("-1500.00", null, groupThreshold)).toBe(true);
    expect(isVarianceException("-2.00", "-5.00", groupThreshold)).toBe(true);
  });

  it("ignores the percent trigger when the entity threshold has none", () => {
    const entityThreshold = resolveThreshold(ROWS, "entity-with-override");
    expect(isVarianceException("10.00", "99.00", entityThreshold)).toBe(false);
    expect(isVarianceException("50.01", null, entityThreshold)).toBe(true);
  });

  it("never flags when no threshold is configured", () => {
    expect(isVarianceException("999999.00", "5000.00", null)).toBe(false);
  });

  it("does not drift on decimals the way floats would", () => {
    // 0.1 + 0.2 style drift would push this over a 0.30 trigger.
    const tight = resolveThreshold(
      [{ entityId: GROUP, context: "cash", absoluteAmount: "0.30", percent: null }],
      "e"
    );
    expect(isVarianceException("0.30", null, tight)).toBe(false);
  });
});
