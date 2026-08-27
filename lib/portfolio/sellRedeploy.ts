import Decimal from "decimal.js";

/**
 * Sell-and-redeploy model (spec 17).
 *
 * The load-bearing rule, and the reason this cannot be done on the back of an
 * envelope: **the repayment required to release a property is set by the
 * bank's valuation of it, not by what it sells for.** Debt is secured against
 * a pool, so releasing one asset means paying the pool back down to its target
 * LVR on whatever security remains. That number is fixed before a buyer is
 * found.
 *
 * A low sale price bites in two other ways instead. Proceeds may not cover the
 * paydown, which turns a sale into a demand for cash. And a sale below bank
 * value can prompt the lender to revalue the retained pool, which raises the
 * paydown itself: the haircut input models that, and it is the difference
 * between a sale that frees money and one that costs it.
 */

export interface SellRedeployInput {
  /** Bank valuation of the property being released. The covenant reference. */
  propertyBankValue: string;
  propertyNoi: string;

  poolValue: string;
  poolDebt: string;
  poolNoi: string;
  /** Decimal fraction, e.g. "0.65". */
  targetLvr: string;
  /** Decimal fraction, e.g. "0.07". */
  stressRate: string;

  salePrice: string;
  /** Decimal fraction. Spec default 0.025, range 0 to 0.04. */
  sellingCostPct: string;
  /** Decimal fraction. Spec default 0, range 0 to 0.20. */
  retainedPoolHaircutPct: string;
  /** Decimal fraction. Spec default 0.60, range 0 to 0.75. */
  replacementLvr: string;
}

export type SellRedeployVerdict = "top_up_required" | "serviceability_breaks" | "viable_release";

export interface SellRedeployResult {
  /** Every intermediate value, so the result can be audited rather than trusted. */
  retainedPoolValue: string;
  maxDebtAfterRelease: string;
  releaseRepayment: string;
  netSaleProceeds: string;
  cashReleased: string;
  topUpRequired: string;
  bankValueShortfall: string;
  noiLost: string;
  remainingNoi: string;
  debtAfter: string;
  /** Null when there is no debt left to service: a ratio against nothing is not a number. */
  remainingIcr: string | null;
  /** Null when no cash is released, since there is nothing to redeploy. */
  replacementCapacity: string | null;
  /** Null when capacity is null or zero. */
  requiredReplacementYield: string | null;

  verdict: SellRedeployVerdict;
  /** Plain-language statement of the verdict, for the screen and the export. */
  explanation: string;
}

const ZERO = new Decimal(0);

function d(value: string): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new Error(`Expected a finite decimal, received "${value}"`);
  return parsed;
}

export function sellRedeploy(input: SellRedeployInput): SellRedeployResult {
  const propertyBankValue = d(input.propertyBankValue);
  const propertyNoi = d(input.propertyNoi);
  const poolValue = d(input.poolValue);
  const poolDebt = d(input.poolDebt);
  const poolNoi = d(input.poolNoi);
  const targetLvr = d(input.targetLvr);
  const stressRate = d(input.stressRate);
  const salePrice = d(input.salePrice);
  const sellingCostPct = d(input.sellingCostPct);
  const haircut = d(input.retainedPoolHaircutPct);
  const replacementLvr = d(input.replacementLvr);

  // 17.1 Retained pool value after sale and haircut.
  const retainedPoolValue = Decimal.max(poolValue.minus(propertyBankValue), ZERO).times(
    new Decimal(1).minus(haircut)
  );

  // 17.2 Maximum debt the retained security will carry.
  const maxDebt = retainedPoolValue.times(targetLvr);

  // 17.3 The covenant paydown. Driven by bank valuation, never by sale price.
  const releaseRepayment = Decimal.max(poolDebt.minus(maxDebt), ZERO);

  // 17.4
  const netSaleProceeds = salePrice.times(new Decimal(1).minus(sellingCostPct));

  // 17.5 Signed deliberately. A negative cash release is the finding, not an
  // error to be floored away, and topUpRequired states the same fact positively.
  const cashReleased = netSaleProceeds.minus(releaseRepayment);

  // 17.6
  const topUp = Decimal.max(releaseRepayment.minus(netSaleProceeds), ZERO);

  // 17.7 How far below the bank's valuation the sale sits. This is what would
  // prompt a lender to revalue the retained pool, which the haircut models.
  const bankValueShortfall = Decimal.max(propertyBankValue.minus(salePrice), ZERO);

  // 17.8, 17.9
  const noiLost = propertyNoi;
  const remainingNoi = poolNoi.minus(propertyNoi);
  const debtAfter = poolDebt.minus(releaseRepayment);

  // 17.10 Null rather than infinity: a pool with no debt left does not have a
  // cover ratio, and showing one would invite a comparison against a covenant.
  const stressInterest = debtAfter.times(stressRate);
  const remainingIcr = stressInterest.isZero() ? null : remainingNoi.dividedBy(stressInterest);

  /**
   * 17.11 Only when cash is actually released. Redeployment capacity computed
   * from a negative release would be a negative purchase, and at a replacement
   * LVR of 100% the divisor is zero.
   */
  const gearingRoom = new Decimal(1).minus(replacementLvr);
  const replacementCapacity =
    cashReleased.greaterThan(ZERO) && gearingRoom.greaterThan(ZERO)
      ? cashReleased.dividedBy(gearingRoom)
      : null;

  // 17.12
  const requiredReplacementYield =
    replacementCapacity && replacementCapacity.greaterThan(ZERO)
      ? noiLost.dividedBy(replacementCapacity)
      : null;

  /**
   * Spec 18. Ordered: a sale that demands cash is the finding regardless of
   * what happens to cover afterwards, and broken serviceability outranks a
   * headline cash figure. Reporting "viable" first would bury both.
   */
  let verdict: SellRedeployVerdict;
  let explanation: string;

  if (topUp.greaterThan(ZERO)) {
    verdict = "top_up_required";
    explanation =
      `Net proceeds do not cover the ${releaseRepayment.toFixed(2)} the lender requires to release ` +
      `the security, so this sale needs ${topUp.toFixed(2)} from elsewhere rather than freeing cash.`;
  } else if (remainingIcr !== null && remainingIcr.lessThan(1)) {
    verdict = "serviceability_breaks";
    explanation =
      `Cash is released, but the retained pool covers only ${remainingIcr.toFixed(2)}x of its ` +
      `stressed interest afterwards. Below 1.0x the remaining assets do not service the ` +
      `remaining debt.`;
  } else {
    verdict = "viable_release";
    explanation =
      `Releases ${cashReleased.toFixed(2)} after the ${releaseRepayment.toFixed(2)} covenant ` +
      `paydown` +
      (remainingIcr === null
        ? ", leaving no debt in the pool."
        : `, and the retained pool still covers ${remainingIcr.toFixed(2)}x.`);
  }

  return {
    retainedPoolValue: retainedPoolValue.toFixed(2),
    maxDebtAfterRelease: maxDebt.toFixed(2),
    releaseRepayment: releaseRepayment.toFixed(2),
    netSaleProceeds: netSaleProceeds.toFixed(2),
    cashReleased: cashReleased.toFixed(2),
    topUpRequired: topUp.toFixed(2),
    bankValueShortfall: bankValueShortfall.toFixed(2),
    noiLost: noiLost.toFixed(2),
    remainingNoi: remainingNoi.toFixed(2),
    debtAfter: debtAfter.toFixed(2),
    remainingIcr: remainingIcr === null ? null : remainingIcr.toFixed(4),
    replacementCapacity: replacementCapacity === null ? null : replacementCapacity.toFixed(2),
    requiredReplacementYield:
      requiredReplacementYield === null ? null : requiredReplacementYield.toFixed(4),
    verdict,
    explanation,
  };
}

/** Spec 16 defaults, so the screen and any caller start from the same place. */
export const SELL_REDEPLOY_DEFAULTS = {
  sellingCostPct: "0.025",
  retainedPoolHaircutPct: "0",
  replacementLvr: "0.60",
} as const;

/** Spec 16 slider bounds, enforced at the API rather than only in the UI. */
export const SELL_REDEPLOY_BOUNDS = {
  sellingCostPct: { min: 0, max: 0.04 },
  retainedPoolHaircutPct: { min: 0, max: 0.2 },
  replacementLvr: { min: 0, max: 0.75 },
} as const;
