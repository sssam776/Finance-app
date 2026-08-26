import { describe, it, expect } from "vitest";
import {
  lvr,
  debtCapacity,
  headroom,
  overLimitBy,
  debtYield,
  interestCoverRatio,
  stressInterest,
  stressInterestCoverRatio,
  assessCovenant,
  asPercent,
  asMultiple,
  type CovenantRuleLike,
} from "../lib/portfolio/ratios";

/**
 * The worked figures here are the group's actual position as described in the
 * CFO architecture document, so a change that breaks the arithmetic fails
 * against real numbers rather than invented ones.
 */

describe("lvr", () => {
  it("divides drawn debt by eligible value", () => {
    // Senior debt 37.59m against investment bank value 64.22m = 58.5%.
    expect(asPercent(lvr("37590000", "64220000"))).toBe("58.5");
  });

  it("returns null rather than zero when there is no value to divide by", () => {
    // A pool with no security does not have an LVR of 0%. Reporting one next to
    // a 65% covenant would read as enormous headroom.
    expect(lvr("1000", "0")).toBeNull();
  });

  it("reports an over-geared position above 1 rather than clamping", () => {
    expect(asPercent(lvr("120", "100"))).toBe("120.0");
  });
});

describe("debtCapacity and headroom", () => {
  it("computes senior capacity to the 65% target", () => {
    // 0.65 x 64.22m - 37.59m = 4.153m.
    expect(debtCapacity("64220000", "0.65")).toBe("41743000.00");
    expect(headroom("64220000", "0.65", "37590000")).toBe("4153000.00");
  });

  it("computes development capacity to the 60% target", () => {
    // GH: 0.60 x 13.60m - 8.14m = 0.02m. Uses bank value, not market value.
    expect(headroom("13600000", "0.60", "8140000")).toBe("20000.00");
  });

  it("floors headroom at zero when the position is over its target", () => {
    expect(headroom("100", "0.65", "80")).toBe("0.00");
  });

  it("reports the excess separately so it is not lost to the floor", () => {
    expect(overLimitBy("100", "0.65", "80")).toBe("15.00");
    expect(overLimitBy("100", "0.65", "50")).toBe("0.00");
  });
});

describe("debtYield", () => {
  it("divides NOI by drawn debt", () => {
    // 2.93m NOI against 37.59m senior debt = 7.8%.
    expect(asPercent(debtYield("2930000", "37590000"))).toBe("7.8");
  });

  it("returns null when there is no debt", () => {
    // Debt-free is not a debt yield of zero; the ratio does not exist.
    expect(debtYield("2930000", "0")).toBeNull();
  });
});

describe("interest cover", () => {
  it("computes stress interest at the assumed rate", () => {
    expect(stressInterest("10000000", "0.07")).toBe("700000.00");
  });

  it("computes cover under stress", () => {
    expect(asMultiple(stressInterestCoverRatio("931000", "10000000", "0.07"))).toBe("1.33x");
  });

  it("returns null when there is no interest cost", () => {
    expect(interestCoverRatio("500000", "0")).toBeNull();
    expect(stressInterestCoverRatio("500000", "0", "0.07")).toBeNull();
  });

  it("reports negative cover rather than flooring it at zero", () => {
    // A loss-making pool is uncovered in a way that a floor of zero would hide.
    expect(asMultiple(interestCoverRatio("-50000", "100000"))).toBe("-0.50x");
  });
});

describe("assessCovenant", () => {
  const asbLvr: CovenantRuleLike = {
    metric: "lvr",
    operator: "lte",
    threshold: "0.65",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    ruleType: "covenant",
  };

  // The step-up: 1.75x until 31 March 2027, 1.95x from that date.
  const icrBefore: CovenantRuleLike = {
    metric: "icr",
    operator: "gte",
    threshold: "1.75",
    effectiveFrom: "2020-01-01",
    effectiveTo: "2027-03-30",
    ruleType: "covenant",
  };
  const icrAfter: CovenantRuleLike = {
    metric: "icr",
    operator: "gte",
    threshold: "1.95",
    effectiveFrom: "2027-03-31",
    effectiveTo: null,
    ruleType: "covenant",
  };

  it("passes an LVR inside its ceiling", () => {
    const result = assessCovenant([asbLvr], "lvr", "0.585", "2026-08-26");
    expect(result.outcome).toBe("pass");
    expect(result.threshold).toBe("0.65");
  });

  it("breaches an LVR above its ceiling", () => {
    expect(assessCovenant([asbLvr], "lvr", "0.70", "2026-08-26").outcome).toBe("breach");
  });

  it("treats a value exactly on the threshold as passing", () => {
    expect(assessCovenant([asbLvr], "lvr", "0.65", "2026-08-26").outcome).toBe("pass");
  });

  it("applies the threshold in force on the date asked about", () => {
    // The same 1.94x cover passes before the step-up and fails after it. One
    // stored threshold could only ever tell one of these two truths.
    const rules = [icrBefore, icrAfter];
    expect(assessCovenant(rules, "icr", "1.94", "2026-08-26").outcome).toBe("pass");
    expect(assessCovenant(rules, "icr", "1.94", "2027-06-30").outcome).toBe("breach");
  });

  it("selects the later threshold exactly on the step-up date", () => {
    const result = assessCovenant([icrBefore, icrAfter], "icr", "1.94", "2027-03-31");
    expect(result.threshold).toBe("1.95");
    expect(result.outcome).toBe("breach");
  });

  it("reports no_rule for a lender with no express financial covenant", () => {
    // Monitored, not breaching. Drawing this as a breach would raise an alarm
    // about a term that does not exist.
    const result = assessCovenant([], "icr", "0.38", "2026-08-26");
    expect(result.outcome).toBe("no_rule");
    expect(result.reason).toContain("No approved version is in effect");
  });

  it("reports not_measurable when the ratio could not be calculated", () => {
    // Distinct from a pass. An unmeasurable ratio must never render as green.
    const result = assessCovenant([asbLvr], "lvr", null, "2026-08-26");
    expect(result.outcome).toBe("not_measurable");
    expect(result.threshold).toBe("0.65");
  });

  it("fails closed when two rules overlap on the same date", () => {
    const overlapping: CovenantRuleLike = { ...icrAfter, effectiveFrom: "2020-01-01" };
    const result = assessCovenant([icrBefore, overlapping], "icr", "1.94", "2026-08-26");
    expect(result.outcome).toBe("no_rule");
    expect(result.reason).toContain("Overlapping effective windows");
  });

  it("ignores rules for a different metric", () => {
    expect(assessCovenant([asbLvr], "icr", "1.20", "2026-08-26").outcome).toBe("no_rule");
  });

  it("carries the rule type through so a management test is not shown as a covenant", () => {
    const stress: CovenantRuleLike = { ...asbLvr, ruleType: "management_stress" };
    expect(assessCovenant([stress], "lvr", "0.585", "2026-08-26").ruleType).toBe(
      "management_stress"
    );
  });
});

describe("display helpers", () => {
  it("keeps a missing ratio missing rather than rendering zero", () => {
    expect(asPercent(null)).toBeNull();
    expect(asMultiple(null)).toBeNull();
  });
});
