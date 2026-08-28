import Decimal from "decimal.js";
import type { DateOnly } from "../dates";
import {
  lvr,
  headroom,
  overLimitBy,
  debtCapacity,
  debtYield,
  stressInterestCoverRatio,
  assessCovenant,
  type CovenantRuleLike,
  type CovenantAssessment,
  type Ratio,
} from "./ratios";

/**
 * The position of one cross-collateralised security pool.
 *
 * ASB and BNZ lend against a pool of properties rather than against any single
 * building, so no question about one property can be answered without the
 * whole pool. That is the reason this exists as its own computation and not as
 * a per-property calculation with a sum on top.
 *
 * Every figure is derived here and none is stored. A pool's LVR is a fact
 * about the values and balances that were true on a date, and a stored copy
 * would be a second answer capable of disagreeing with the first.
 */

export interface PoolPropertyInput {
  propertyId: string;
  name: string;
  entityShortCode: string;
  status: "investment" | "development" | "held_for_sale";
  /**
   * The valuation on the basis the covenant is tested against, usually bank
   * value. Null when the property has never been valued on that basis, which
   * is a gap to report rather than a zero to add.
   */
  value: string | null;
  valuationBasis: string;
  valuationDate: DateOnly | null;
  /** Share of the value charged to this pool. Decimal fraction, usually "1". */
  contributionShare: string;
  /** Annual net operating income, null when unmapped. */
  annualNoi: string | null;
  noiMappingStatus: "mapped" | "unmapped" | "partial";
}

export interface PoolFacilityInput {
  facilityId: string;
  facilityReference: string;
  drawnAmount: string;
  currency: string;
  interestCapitalised: boolean;
}

export interface PoolInput {
  poolId: string;
  poolName: string;
  lenderName: string;
  targetLvr: string;
  stressRate: string;
  currency: string;
  properties: PoolPropertyInput[];
  facilities: PoolFacilityInput[];
  covenants: CovenantRuleLike[];
}

export interface PoolPosition {
  poolId: string;
  poolName: string;
  lenderName: string;
  currency: string;
  targetLvr: string;
  stressRate: string;

  /** Sum of charged value across properties that have one. */
  securityValue: string;
  drawnDebt: string;
  annualNoi: string;

  lvr: Ratio | null;
  debtCapacity: string;
  headroom: string;
  overLimitBy: string;
  debtYield: Ratio | null;
  stressIcr: Ratio | null;

  lvrCovenant: CovenantAssessment;
  icrCovenant: CovenantAssessment;

  propertyCount: number;
  facilityCount: number;

  /**
   * Everything the position is missing, in the caller's words rather than as a
   * silent zero. A pool half of whose properties have no valuation still
   * produces an LVR, and that number is worse than no number unless the screen
   * says what it was computed from.
   */
  gaps: string[];
}

function sum(values: string[]): Decimal {
  return values.reduce((total, v) => total.plus(new Decimal(v)), new Decimal(0));
}

/**
 * Interest that capitalises is excluded from cover.
 *
 * Second-tier development debt is not serviced out of income, so including it
 * understates every other lender's coverage. The CFO schedule excludes it for
 * exactly this reason, and blending it in is how a healthy senior book comes
 * to look uncovered.
 */
function servicedDebt(facilities: PoolFacilityInput[]): Decimal {
  return sum(facilities.filter((f) => !f.interestCapitalised).map((f) => f.drawnAmount));
}

export function poolPosition(input: PoolInput, asOf: DateOnly): PoolPosition {
  const gaps: string[] = [];

  const valued = input.properties.filter((p) => p.value !== null);
  const unvalued = input.properties.filter((p) => p.value === null);
  if (unvalued.length > 0) {
    gaps.push(
      `${unvalued.length} of ${input.properties.length} properties have no ${input.properties[0]?.valuationBasis ?? "bank"} valuation and contribute nothing to the security value.`
    );
  }

  // Charged value, not headline value: a property can be partially charged to
  // a pool, and the covenant is tested on what the lender actually holds.
  const securityValue = valued.reduce(
    (total, p) => total.plus(new Decimal(p.value!).times(new Decimal(p.contributionShare))),
    new Decimal(0)
  );

  const drawnDebt = sum(input.facilities.map((f) => f.drawnAmount));

  const noiMapped = input.properties.filter((p) => p.annualNoi !== null);
  const noiUnmapped = input.properties.filter(
    (p) => p.annualNoi === null || p.noiMappingStatus !== "mapped"
  );
  if (noiUnmapped.length > 0) {
    gaps.push(
      `${noiUnmapped.length} of ${input.properties.length} properties have no mapped income, so cover and debt yield understate the true position.`
    );
  }
  const annualNoi = sum(noiMapped.map((p) => p.annualNoi!));

  const capitalising = input.facilities.filter((f) => f.interestCapitalised);
  if (capitalising.length > 0) {
    gaps.push(
      `${capitalising.length} facility(s) capitalise interest and are excluded from cover, which is the correct treatment for debt not serviced out of income.`
    );
  }

  const securityValueString = securityValue.toFixed(2);
  const drawnDebtString = drawnDebt.toFixed(2);
  const annualNoiString = annualNoi.toFixed(2);
  const servicedDebtString = servicedDebt(input.facilities).toFixed(2);

  const poolLvr = lvr(drawnDebtString, securityValueString);
  const icr = stressInterestCoverRatio(annualNoiString, servicedDebtString, input.stressRate);

  return {
    poolId: input.poolId,
    poolName: input.poolName,
    lenderName: input.lenderName,
    currency: input.currency,
    targetLvr: input.targetLvr,
    stressRate: input.stressRate,

    securityValue: securityValueString,
    drawnDebt: drawnDebtString,
    annualNoi: annualNoiString,

    lvr: poolLvr,
    debtCapacity: debtCapacity(securityValueString, input.targetLvr),
    headroom: headroom(securityValueString, input.targetLvr, drawnDebtString),
    overLimitBy: overLimitBy(securityValueString, input.targetLvr, drawnDebtString),
    debtYield: debtYield(annualNoiString, drawnDebtString),
    stressIcr: icr,

    lvrCovenant: assessCovenant(input.covenants, "lvr", poolLvr, asOf),
    icrCovenant: assessCovenant(input.covenants, "icr", icr, asOf),

    propertyCount: input.properties.length,
    facilityCount: input.facilities.length,
    gaps,
  };
}

export interface PortfolioSplit {
  /** Investment stock: the book the senior LVR is actually tested on. */
  investmentValue: string;
  developmentValue: string;
  heldForSaleValue: string;
}

/**
 * Value split by what the property is for.
 *
 * Development stock sits outside the investment book deliberately. Blending it
 * in produced a group figure of 54.7% that flattered the investment book,
 * while the investment book alone stood at 58.5% and far closer to its
 * ceiling. Two different numbers, and only one of them is the one a lender
 * tests.
 */
export function splitByStatus(properties: PoolPropertyInput[]): PortfolioSplit {
  const totalFor = (status: PoolPropertyInput["status"]) =>
    properties
      .filter((p) => p.status === status && p.value !== null)
      .reduce(
        (total, p) => total.plus(new Decimal(p.value!).times(new Decimal(p.contributionShare))),
        new Decimal(0)
      )
      .toFixed(2);

  return {
    investmentValue: totalFor("investment"),
    developmentValue: totalFor("development"),
    heldForSaleValue: totalFor("held_for_sale"),
  };
}
