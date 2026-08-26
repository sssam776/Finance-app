import Decimal from "decimal.js";
import { resolveEffectiveVersion } from "../approval";

/**
 * The portfolio ratios, as pure functions over Decimal strings.
 *
 * These are the figures a lender tests and a board reads: LVR, headroom, debt
 * yield and interest cover. They live here rather than in a route or a
 * component because the same numbers appear on the executive home, the
 * covenant page and the sale-release model, and three copies of a formula is
 * three chances for them to disagree.
 *
 * Two rules run through the whole module.
 *
 * A ratio with no denominator returns null, never zero and never Infinity. A
 * pool with no value does not have an LVR of 0% — it does not have an LVR, and
 * the difference matters when the figure is about to be shown next to a
 * covenant. Callers must render the null as "not available" rather than
 * substituting a number.
 *
 * Nothing here is clamped. A negative NOI produces a negative interest cover,
 * because that is the truth about the position and hiding it behind a floor of
 * zero would make a loss-making pool look merely uncovered.
 */

/** Decimal fractions, not percentages: an LVR of 58.5% is "0.585". */
export type Ratio = string;

function toDecimal(value: string): Decimal {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) {
    throw new Error(`Expected a finite decimal, received "${value}"`);
  }
  return decimal;
}

/**
 * Division that refuses rather than producing a misleading answer. Decimal.js
 * throws on divide-by-zero rather than returning Infinity, but an explicit
 * check reads better at the call sites and keeps the null contract in one
 * place.
 */
function divide(numerator: Decimal, denominator: Decimal): Decimal | null {
  return denominator.isZero() ? null : numerator.dividedBy(denominator);
}

/**
 * Loan-to-value.
 *
 * `eligibleValue` must already be narrowed to the security actually being
 * tested — the caller decides whether that is bank value or market value, and
 * whether development stock is in or out. Passing a blended group value here
 * is how an investment book at 58.5% comes to be reported as 54.7%.
 */
export function lvr(drawnDebt: string, eligibleValue: string): Ratio | null {
  const result = divide(toDecimal(drawnDebt), toDecimal(eligibleValue));
  return result === null ? null : result.toString();
}

/** The most debt the security will carry at the target LVR. */
export function debtCapacity(eligibleValue: string, targetLvr: string): string {
  return toDecimal(eligibleValue).times(toDecimal(targetLvr)).toFixed(2);
}

/**
 * Undrawn capacity at the target LVR, floored at zero.
 *
 * The floor is deliberate and is the one place clamping is right: a position
 * over its target has no headroom, and a negative headroom would read as
 * available borrowing. Use `overLimitBy` when the size of the excess is what
 * is wanted.
 */
export function headroom(eligibleValue: string, targetLvr: string, drawnDebt: string): string {
  const capacity = toDecimal(debtCapacity(eligibleValue, targetLvr));
  const excess = capacity.minus(toDecimal(drawnDebt));
  return Decimal.max(excess, 0).toFixed(2);
}

/** How far drawn debt exceeds capacity, floored at zero. The inverse of headroom. */
export function overLimitBy(eligibleValue: string, targetLvr: string, drawnDebt: string): string {
  const capacity = toDecimal(debtCapacity(eligibleValue, targetLvr));
  return Decimal.max(toDecimal(drawnDebt).minus(capacity), 0).toFixed(2);
}

/** Annual NOI against drawn debt — the lender's sanity check on income per dollar lent. */
export function debtYield(annualNoi: string, drawnDebt: string): Ratio | null {
  const result = divide(toDecimal(annualNoi), toDecimal(drawnDebt));
  return result === null ? null : result.toString();
}

/** Interest cover. Expressed as a multiple: "1.95" is 1.95x. */
export function interestCoverRatio(annualNoi: string, annualInterest: string): Ratio | null {
  const result = divide(toDecimal(annualNoi), toDecimal(annualInterest));
  return result === null ? null : result.toString();
}

/** Interest at an assumed stress rate rather than the rate actually being paid. */
export function stressInterest(drawnDebt: string, stressRate: string): string {
  return toDecimal(drawnDebt).times(toDecimal(stressRate)).toFixed(2);
}

/**
 * Interest cover under a management stress rate.
 *
 * This is not a covenant test. A lender's covenant is measured at the rate in
 * the facility; this asks what cover would look like if rates moved to the
 * assumed level, and the two must never be labelled the same on screen.
 */
export function stressInterestCoverRatio(
  annualNoi: string,
  drawnDebt: string,
  stressRate: string
): Ratio | null {
  return interestCoverRatio(annualNoi, stressInterest(drawnDebt, stressRate));
}

// ---------------------------------------------------------------------------
// Covenant testing
// ---------------------------------------------------------------------------

export interface CovenantRuleLike {
  metric: "lvr" | "icr" | "dscr" | "debt_yield";
  operator: "lte" | "gte";
  threshold: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  ruleType: "covenant" | "monitoring" | "management_stress";
}

export type CovenantOutcome = "pass" | "breach" | "not_measurable" | "no_rule";

export interface CovenantAssessment {
  outcome: CovenantOutcome;
  /** The measured value, or null when it could not be measured. */
  actual: Ratio | null;
  threshold: string | null;
  operator: "lte" | "gte" | null;
  ruleType: CovenantRuleLike["ruleType"] | null;
  /** Set whenever the outcome is not a straight pass or breach. */
  reason: string | null;
}

/**
 * Tests one measured ratio against whichever rule was in force on `asOf`.
 *
 * Effective dating is the point of this function. A covenant that steps up on a
 * known future date is two rows, not one, and a position that passes today
 * against 1.75x while failing the 1.95x that starts next year has to be able to
 * say both things depending on the date it is asked about.
 *
 * Every non-pass is distinguished. A lender with no express financial covenant
 * is `no_rule` and must not be drawn as a breach; a ratio that could not be
 * computed is `not_measurable` and must not be drawn as a pass. Collapsing
 * either into the other is the failure this return shape exists to prevent.
 */
export function assessCovenant(
  rules: CovenantRuleLike[],
  metric: CovenantRuleLike["metric"],
  actual: Ratio | null,
  asOf: string
): CovenantAssessment {
  const forMetric = rules.filter((rule) => rule.metric === metric);
  const resolution = resolveEffectiveVersion(forMetric, asOf, { requireApproved: false });

  if (resolution.row === null) {
    return {
      outcome: "no_rule",
      actual,
      threshold: null,
      operator: null,
      ruleType: null,
      reason: resolution.reason,
    };
  }

  const rule = resolution.row;

  if (actual === null) {
    return {
      outcome: "not_measurable",
      actual: null,
      threshold: rule.threshold,
      operator: rule.operator,
      ruleType: rule.ruleType,
      reason: `No ${metric.toUpperCase()} could be calculated for ${asOf}.`,
    };
  }

  const measured = toDecimal(actual);
  const threshold = toDecimal(rule.threshold);
  const passes =
    rule.operator === "lte"
      ? measured.lessThanOrEqualTo(threshold)
      : measured.greaterThanOrEqualTo(threshold);

  return {
    outcome: passes ? "pass" : "breach",
    actual,
    threshold: rule.threshold,
    operator: rule.operator,
    ruleType: rule.ruleType,
    reason: null,
  };
}

/** A ratio as a display percentage. Returns null so a missing ratio stays missing. */
export function asPercent(ratio: Ratio | null, decimalPlaces = 1): string | null {
  return ratio === null ? null : toDecimal(ratio).times(100).toFixed(decimalPlaces);
}

/** A cover ratio as a display multiple, e.g. "1.33x". */
export function asMultiple(ratio: Ratio | null, decimalPlaces = 2): string | null {
  return ratio === null ? null : `${toDecimal(ratio).toFixed(decimalPlaces)}x`;
}
