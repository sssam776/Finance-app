import { describe, it, expect } from "vitest";
import { poolPosition, splitByStatus, type PoolInput, type PoolPropertyInput } from "../lib/portfolio/poolPosition";
import { asPercent, asMultiple, type CovenantRuleLike } from "../lib/portfolio/ratios";

const AS_OF = "2026-08-27";

function property(over: Partial<PoolPropertyInput> = {}): PoolPropertyInput {
  return {
    propertyId: "p1",
    name: "367 Great South Road",
    entityShortCode: "KAYO",
    status: "investment",
    value: "3425000.00",
    valuationBasis: "bank",
    valuationDate: "2026-03-31",
    contributionShare: "1",
    annualNoi: "250000.00",
    noiMappingStatus: "mapped",
    ...over,
  };
}

function pool(over: Partial<PoolInput> = {}): PoolInput {
  return {
    poolId: "pool-asb",
    poolName: "ASB",
    lenderName: "ASB",
    targetLvr: "0.65",
    stressRate: "0.07",
    currency: "NZD",
    properties: [property()],
    facilities: [
      {
        facilityId: "f1",
        facilityReference: "639-92-003",
        drawnAmount: "2000000.00",
        currency: "NZD",
        interestCapitalised: false,
      },
    ],
    covenants: [],
    ...over,
  };
}

describe("poolPosition", () => {
  it("computes the group's actual investment position", () => {
    // Senior debt 37.59m against investment bank value 64.22m.
    const position = poolPosition(
      pool({
        properties: [property({ value: "64220000.00", annualNoi: "2930000.00" })],
        facilities: [
          {
            facilityId: "f1",
            facilityReference: "senior",
            drawnAmount: "37590000.00",
            currency: "NZD",
            interestCapitalised: false,
          },
        ],
      }),
      AS_OF
    );

    expect(asPercent(position.lvr)).toBe("58.5");
    expect(position.headroom).toBe("4153000.00");
    expect(asPercent(position.debtYield)).toBe("7.8");
  });

  it("charges only the share of value pledged to the pool", () => {
    // A property can be partially charged, and the covenant is tested on what
    // the lender actually holds rather than on the headline value.
    const position = poolPosition(
      pool({ properties: [property({ value: "1000000.00", contributionShare: "0.5" })] }),
      AS_OF
    );
    expect(position.securityValue).toBe("500000.00");
  });

  it("omits an unvalued property from the security value and says so", () => {
    // Treating a missing valuation as zero would quietly inflate the LVR.
    const position = poolPosition(
      pool({
        properties: [property({ value: "1000000.00" }), property({ propertyId: "p2", value: null })],
      }),
      AS_OF
    );
    expect(position.securityValue).toBe("1000000.00");
    expect(position.propertyCount).toBe(2);
    expect(position.gaps.some((g) => g.includes("no bank valuation"))).toBe(true);
  });

  it("excludes capitalising debt from cover but not from the LVR", () => {
    /**
     * Second-tier development debt is not serviced out of income. Including it
     * in cover understates every other lender's coverage, but it is still debt
     * secured against the pool, so it belongs in the LVR.
     */
    const position = poolPosition(
      pool({
        properties: [property({ value: "10000000.00", annualNoi: "700000.00" })],
        facilities: [
          {
            facilityId: "f1",
            facilityReference: "senior",
            drawnAmount: "5000000.00",
            currency: "NZD",
            interestCapitalised: false,
          },
          {
            facilityId: "f2",
            facilityReference: "gh-invest",
            drawnAmount: "3000000.00",
            currency: "NZD",
            interestCapitalised: true,
          },
        ],
      }),
      AS_OF
    );

    expect(position.drawnDebt).toBe("8000000.00");
    // Cover is 700000 / (5000000 x 0.07), the capitalising 3m excluded.
    expect(asMultiple(position.stressIcr)).toBe("2.00x");
    expect(position.gaps.some((g) => g.includes("capitalise interest"))).toBe(true);
  });

  it("reports unmapped income rather than treating it as nil", () => {
    // Trust-held rentals missing from the mapping understate cover. That is a
    // mapping gap, not a lender with no income.
    const position = poolPosition(
      pool({
        properties: [
          property({ annualNoi: "250000.00" }),
          property({ propertyId: "p2", annualNoi: null, noiMappingStatus: "unmapped" }),
        ],
      }),
      AS_OF
    );
    expect(position.annualNoi).toBe("250000.00");
    expect(position.gaps.some((g) => g.includes("no mapped income"))).toBe(true);
  });

  it("returns no LVR rather than zero for a pool with no valued security", () => {
    const position = poolPosition(pool({ properties: [property({ value: null })] }), AS_OF);
    expect(position.lvr).toBeNull();
    expect(position.lvrCovenant.outcome).toBe("no_rule");
  });

  it("reports an over-geared pool without clamping the excess away", () => {
    const position = poolPosition(
      pool({
        properties: [property({ value: "1000000.00" })],
        facilities: [
          {
            facilityId: "f1",
            facilityReference: "over",
            drawnAmount: "800000.00",
            currency: "NZD",
            interestCapitalised: false,
          },
        ],
      }),
      AS_OF
    );
    expect(position.headroom).toBe("0.00");
    expect(position.overLimitBy).toBe("150000.00");
  });

  describe("covenants", () => {
    const lvrCeiling: CovenantRuleLike = {
      metric: "lvr",
      operator: "lte",
      threshold: "0.65",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      ruleType: "covenant",
    };

    it("passes an LVR inside its ceiling", () => {
      const position = poolPosition(
        pool({
          properties: [property({ value: "10000000.00" })],
          facilities: [
            {
              facilityId: "f1",
              facilityReference: "a",
              drawnAmount: "5000000.00",
              currency: "NZD",
              interestCapitalised: false,
            },
          ],
          covenants: [lvrCeiling],
        }),
        AS_OF
      );
      expect(position.lvrCovenant.outcome).toBe("pass");
    });

    it("applies the cover threshold in force on the date asked about", () => {
      /**
       * The step-up from 1.75x to 1.95x on 31 March 2027, with cover at 1.94x.
       * The same position passes before the step and breaches after it, which
       * is the whole reason covenant rules are effective-dated.
       */
      const covenants: CovenantRuleLike[] = [
        {
          metric: "icr",
          operator: "gte",
          threshold: "1.75",
          effectiveFrom: "2020-01-01",
          effectiveTo: "2027-03-30",
          ruleType: "covenant",
        },
        {
          metric: "icr",
          operator: "gte",
          threshold: "1.95",
          effectiveFrom: "2027-03-31",
          effectiveTo: null,
          ruleType: "covenant",
        },
      ];

      // NOI 679000 against 5,000,000 at 7% stress gives 1.94x.
      const marginal = pool({
        properties: [property({ value: "10000000.00", annualNoi: "679000.00" })],
        facilities: [
          {
            facilityId: "f1",
            facilityReference: "a",
            drawnAmount: "5000000.00",
            currency: "NZD",
            interestCapitalised: false,
          },
        ],
        covenants,
      });

      expect(asMultiple(poolPosition(marginal, "2026-08-27").stressIcr)).toBe("1.94x");
      expect(poolPosition(marginal, "2026-08-27").icrCovenant.outcome).toBe("pass");
      expect(poolPosition(marginal, "2027-06-30").icrCovenant.outcome).toBe("breach");
    });

    it("reports no_rule for a lender with no express financial covenant", () => {
      // Monitored, not breaching. Drawing this as a breach would raise an
      // alarm about a term that does not exist.
      const position = poolPosition(pool({ covenants: [] }), AS_OF);
      expect(position.lvrCovenant.outcome).toBe("no_rule");
    });
  });
});

describe("splitByStatus", () => {
  it("keeps development stock out of the investment book", () => {
    /**
     * Blending development into the group figure produced 54.7% and flattered
     * the investment book, which stood at 58.5% on its own and far closer to
     * its ceiling. Only one of those is the number a lender tests.
     */
    const split = splitByStatus([
      property({ propertyId: "a", status: "investment", value: "66430000.00" }),
      property({ propertyId: "b", status: "development", value: "2480000.00" }),
      property({ propertyId: "c", status: "held_for_sale", value: "19430000.00" }),
    ]);

    expect(split.investmentValue).toBe("66430000.00");
    expect(split.developmentValue).toBe("2480000.00");
    expect(split.heldForSaleValue).toBe("19430000.00");
  });

  it("ignores unvalued properties in every bucket", () => {
    const split = splitByStatus([property({ value: null })]);
    expect(split.investmentValue).toBe("0.00");
  });
});
