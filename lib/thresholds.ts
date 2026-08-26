import Decimal from "decimal.js";
import { Money } from "./money";
import { GLOBAL_THRESHOLD_SCOPE, type ThresholdContext } from "@/db/schema";

/**
 * CASH-005 — configurable variance exception thresholds.
 *
 * Pure resolution and comparison, kept out of the route and out of the
 * dashboard: what counts as an exception is accounting policy, and REM-001
 * says policy does not live in presentation code. The route reads the rows,
 * this module decides.
 */

export interface ThresholdRow {
  entityId: string;
  context: ThresholdContext;
  absoluteAmount: string;
  percent: string | null;
}

export interface ResolvedThreshold {
  /** Which row was applied, so the UI can say why a row is flagged. */
  scope: "entity" | "group";
  context: ThresholdContext;
  absoluteAmount: string;
  percent: string | null;
}

/**
 * An entity's own threshold overrides the group default, within one context.
 * Contexts never fall back to one another: a missing balance-sheet materiality
 * is not a reason to apply the cash tolerance instead.
 */
export function resolveThreshold(
  rows: ThresholdRow[],
  entityId: string,
  context: ThresholdContext = "cash"
): ResolvedThreshold | null {
  const inContext = rows.filter((r) => r.context === context);

  const forEntity = inContext.find((r) => r.entityId === entityId);
  if (forEntity) {
    return {
      scope: "entity",
      context,
      absoluteAmount: forEntity.absoluteAmount,
      percent: forEntity.percent,
    };
  }

  const groupDefault = inContext.find((r) => r.entityId === GLOBAL_THRESHOLD_SCOPE);
  if (groupDefault) {
    return {
      scope: "group",
      context,
      absoluteAmount: groupDefault.absoluteAmount,
      percent: groupDefault.percent,
    };
  }

  return null;
}

/**
 * Breaching *either* configured trigger makes it an exception: a $50k variance
 * on a $10m account is small in percentage terms and still worth a look, and a
 * 40% variance on a small account matters even though the dollars are minor.
 *
 * Strictly greater than — a variance exactly equal to a $1,000 threshold is
 * within tolerance, not an exception.
 */
export function isVarianceException(
  varianceAmount: string,
  variancePercentValue: string | null,
  threshold: ResolvedThreshold | null,
  currency = "NZD"
): boolean {
  if (!threshold) return false;

  const observedAmount = Money.of(varianceAmount, currency).abs();
  const amountLimit = Money.of(threshold.absoluteAmount, currency).abs();
  if (observedAmount.compare(amountLimit) > 0) return true;

  if (threshold.percent !== null && variancePercentValue !== null) {
    const observedPercent = new Decimal(variancePercentValue).abs();
    const percentLimit = new Decimal(threshold.percent).abs();
    if (observedPercent.greaterThan(percentLimit)) return true;
  }

  return false;
}
