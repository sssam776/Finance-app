import { describe, it, expect } from "vitest";
import {
  sellRedeploy,
  SELL_REDEPLOY_DEFAULTS,
  type SellRedeployInput,
} from "../lib/portfolio/sellRedeploy";

/**
 * The worked example from the CFO architecture document, used as the anchor:
 * 367 Great South Road, bank value 3.425m, in an ASB pool of 45.34m carrying
 * 28.12m of debt against a 65% release target.
 */
function greatSouthRoad(over: Partial<SellRedeployInput> = {}): SellRedeployInput {
  return {
    propertyBankValue: "3425000.00",
    propertyNoi: "250000.00",
    poolValue: "45340000.00",
    poolDebt: "28120000.00",
    poolNoi: "2930000.00",
    targetLvr: "0.65",
    stressRate: "0.07",
    salePrice: "3425000.00",
    sellingCostPct: "0",
    retainedPoolHaircutPct: "0",
    replacementLvr: "0.60",
    ...over,
  };
}

describe("the documented worked example", () => {
  it("reproduces the release paydown from the stated inputs", () => {
    /**
     * 28.12m - 65% x (45.34m - 3.425m) = 875,250.
     *
     * The document states 880,580 for this calculation. Its own formula
     * applied to its own stated figures gives 875,250, and the 5,330
     * difference is rounding in the prose rather than a different method: a
     * pool value of 45,331,800 produces exactly 880,580, and that rounds to
     * the "45.34m" the document prints.
     *
     * Asserted at the arithmetic rather than at the printed answer, because
     * the register will hold exact valuations and this is what it will
     * compute from. Worth knowing when a figure here is compared against the
     * workbook: the workbook's displayed inputs are rounded to two decimal
     * places of millions, so small differences are expected and are not a
     * defect in either.
     */
    const result = sellRedeploy(greatSouthRoad());
    expect(result.retainedPoolValue).toBe("41915000.00");
    expect(result.maxDebtAfterRelease).toBe("27244750.00");
    expect(result.releaseRepayment).toBe("875250.00");
  });

  it("leaves the paydown unchanged when the sale price falls", () => {
    /**
     * The rule the whole model turns on. Selling at 3.0m rather than 3.425m
     * does not change what the lender requires, because the requirement is
     * computed from the bank's valuation of the retained security.
     */
    const atValue = sellRedeploy(greatSouthRoad());
    const below = sellRedeploy(greatSouthRoad({ salePrice: "3000000.00" }));

    expect(below.releaseRepayment).toBe(atValue.releaseRepayment);
    // What a low price does change is the surplus and the shortfall against value.
    expect(Number(below.cashReleased)).toBeLessThan(Number(atValue.cashReleased));
    expect(below.bankValueShortfall).toBe("425000.00");
  });

  it("turns the sale into a top-up once a 12% pool markdown is applied", () => {
    /**
     * A sale below bank value can prompt the lender to revalue the retained
     * pool, which raises the paydown rather than lowering it. The document
     * puts the paydown at about 4.15m and the top-up at about 1.22m.
     */
    const result = sellRedeploy(
      greatSouthRoad({ salePrice: "3000000.00", retainedPoolHaircutPct: "0.12" })
    );

    expect(Number(result.releaseRepayment)).toBeGreaterThan(4_000_000);
    expect(Number(result.releaseRepayment)).toBeLessThan(4_300_000);
    expect(result.verdict).toBe("top_up_required");
    expect(Number(result.topUpRequired)).toBeGreaterThan(1_100_000);
    expect(Number(result.topUpRequired)).toBeLessThan(1_300_000);
  });
});

describe("the cases the specification requires", () => {
  it("zero commission", () => {
    const result = sellRedeploy(greatSouthRoad({ sellingCostPct: "0" }));
    expect(result.netSaleProceeds).toBe("3425000.00");
  });

  it("sale below bank valuation", () => {
    const result = sellRedeploy(greatSouthRoad({ salePrice: "3000000.00" }));
    expect(result.bankValueShortfall).toBe("425000.00");
  });

  it("sale above bank valuation reports no shortfall", () => {
    const result = sellRedeploy(greatSouthRoad({ salePrice: "4000000.00" }));
    expect(result.bankValueShortfall).toBe("0.00");
  });

  it("zero haircut", () => {
    const result = sellRedeploy(greatSouthRoad({ retainedPoolHaircutPct: "0" }));
    expect(result.retainedPoolValue).toBe("41915000.00");
  });

  it("20% haircut", () => {
    const result = sellRedeploy(greatSouthRoad({ retainedPoolHaircutPct: "0.20" }));
    // 41.915m x 0.8
    expect(result.retainedPoolValue).toBe("33532000.00");
    expect(Number(result.releaseRepayment)).toBeGreaterThan(Number(sellRedeploy(greatSouthRoad()).releaseRepayment));
  });

  it("no cash release", () => {
    // Proceeds exactly cover the paydown, so the sale neither frees cash nor
    // demands it. Both sides must read zero rather than one of them going
    // slightly negative.
    const result = sellRedeploy(greatSouthRoad({ salePrice: "875250.00", sellingCostPct: "0" }));
    expect(result.cashReleased).toBe("0.00");
    expect(result.topUpRequired).toBe("0.00");
    expect(result.replacementCapacity).toBeNull();
  });

  it("top-up required", () => {
    const result = sellRedeploy(greatSouthRoad({ salePrice: "500000.00" }));
    expect(result.verdict).toBe("top_up_required");
    expect(Number(result.topUpRequired)).toBeGreaterThan(0);
    // A negative release is reported as such rather than floored to zero.
    expect(Number(result.cashReleased)).toBeLessThan(0);
  });

  it("debt fully repaid", () => {
    // A pool small enough that the retained security carries no debt at all.
    const result = sellRedeploy(
      greatSouthRoad({ poolValue: "3425000.00", poolDebt: "1000000.00", salePrice: "5000000.00" })
    );
    expect(result.retainedPoolValue).toBe("0.00");
    expect(result.releaseRepayment).toBe("1000000.00");
    expect(result.debtAfter).toBe("0.00");
    // No debt left means no cover ratio, rather than a division by zero.
    expect(result.remainingIcr).toBeNull();
    expect(result.verdict).toBe("viable_release");
  });

  it("replacement LVR of 0%", () => {
    // Unleveraged: capacity is exactly the cash released.
    const result = sellRedeploy(greatSouthRoad({ replacementLvr: "0" }));
    expect(result.replacementCapacity).toBe(result.cashReleased);
  });

  it("replacement LVR of 75%", () => {
    // Cash released buys four times its value at 75% gearing.
    const result = sellRedeploy(greatSouthRoad({ replacementLvr: "0.75" }));
    expect(Number(result.replacementCapacity)).toBeCloseTo(Number(result.cashReleased) * 4, 2);
  });

  it("negative NOI", () => {
    // A loss-making property. Selling it raises the retained pool's income.
    const result = sellRedeploy(greatSouthRoad({ propertyNoi: "-50000.00" }));
    expect(result.noiLost).toBe("-50000.00");
    expect(result.remainingNoi).toBe("2980000.00");
    expect(Number(result.remainingNoi)).toBeGreaterThan(Number(greatSouthRoad().poolNoi));
  });
});

describe("verdicts", () => {
  it("reports a top-up ahead of anything else", () => {
    // A sale that demands cash is the finding, whatever happens to cover.
    const result = sellRedeploy(greatSouthRoad({ salePrice: "100000.00", propertyNoi: "0" }));
    expect(result.verdict).toBe("top_up_required");
    expect(result.explanation).toContain("needs");
  });

  it("reports broken serviceability ahead of a headline cash figure", () => {
    /**
     * Cash is released, but the retained pool cannot service what is left.
     * Leading with the cash figure would bury the reason not to do it.
     */
    const result = sellRedeploy(
      greatSouthRoad({ poolNoi: "300000.00", propertyNoi: "250000.00", salePrice: "5000000.00" })
    );
    expect(Number(result.cashReleased)).toBeGreaterThan(0);
    expect(Number(result.remainingIcr)).toBeLessThan(1);
    expect(result.verdict).toBe("serviceability_breaks");
  });

  it("reports a viable release when cash frees and cover holds", () => {
    const result = sellRedeploy(greatSouthRoad({ salePrice: "5000000.00" }));
    expect(result.verdict).toBe("viable_release");
    expect(Number(result.cashReleased)).toBeGreaterThan(0);
    expect(Number(result.remainingIcr)).toBeGreaterThanOrEqual(1);
  });
});

describe("edges", () => {
  it("does not produce a negative retained pool when the property exceeds the pool", () => {
    const result = sellRedeploy(greatSouthRoad({ propertyBankValue: "99000000.00" }));
    expect(result.retainedPoolValue).toBe("0.00");
  });

  it("never reports a negative repayment when the pool is already under its target", () => {
    const result = sellRedeploy(greatSouthRoad({ poolDebt: "1000.00" }));
    expect(result.releaseRepayment).toBe("0.00");
  });

  it("returns no replacement capacity at a replacement LVR of 100%", () => {
    // The divisor is zero: fully geared means no cash is required, which is
    // not a purchase capacity.
    const result = sellRedeploy(greatSouthRoad({ replacementLvr: "1", salePrice: "5000000.00" }));
    expect(result.replacementCapacity).toBeNull();
    expect(result.requiredReplacementYield).toBeNull();
  });

  it("uses the specification's stated defaults", () => {
    expect(SELL_REDEPLOY_DEFAULTS.sellingCostPct).toBe("0.025");
    expect(SELL_REDEPLOY_DEFAULTS.retainedPoolHaircutPct).toBe("0");
    expect(SELL_REDEPLOY_DEFAULTS.replacementLvr).toBe("0.60");
  });

  it("keeps full precision through the intermediate steps", () => {
    // Money is Decimal throughout: a float would drift across twelve steps.
    const result = sellRedeploy(
      greatSouthRoad({ propertyBankValue: "0.10", poolValue: "0.30", poolDebt: "0.20" })
    );
    expect(result.retainedPoolValue).toBe("0.20");
  });
});
