import Decimal from "decimal.js";
import { Money, variancePercent } from "../money";
import { isVarianceException, type ResolvedThreshold } from "../thresholds";

/**
 * VAR-001 and VAR-003: what moved between two periods, by how much, and
 * whether the movement is good or bad news.
 *
 * The whole module exists so the sign convention lives in one tested place.
 * Revenue rising and expenses rising are both a positive movement
 * arithmetically and opposite in meaning, and getting that backwards produces
 * a report that is confidently wrong in a way no type checker can catch: every
 * number is right and every judgement is inverted.
 *
 * Pure. Money only, never Number.
 */

/**
 * Xero's section titles vary by organisation, so the caller classifies rows
 * and this module reasons about the classification.
 */
export type SectionKind =
  | "revenue"
  | "cost_of_sales"
  | "operating_expense"
  | "other_income"
  | "other_expense"
  | "total"
  | "unclassified";

/** Kinds where spending more is worse. Everything else reads as income. */
const COST_KINDS: ReadonlySet<SectionKind> = new Set([
  "cost_of_sales",
  "operating_expense",
  "other_expense",
]);

export interface PlRow {
  accountCode: string | null;
  accountName: string;
  sectionKind: SectionKind;
  /** Decimal string. */
  amount: string;
  currency?: string;
}

export interface MovementRow {
  accountCode: string | null;
  accountName: string;
  sectionKind: SectionKind;
  currency: string;
  actual: string;
  comparative: string;
  /** actual minus comparative. Signed as the arithmetic falls, not as the judgement. */
  movement: string;
  /** Null when the comparative is zero: a percentage against nothing is not a number. */
  percent: string | null;
  /**
   * Whether the movement is good news for the entity. Null for rows where the
   * question does not apply, such as totals and unclassified sections.
   */
  favourable: boolean | null;
  isException: boolean;
  /** Absolute movement, for ranking. */
  magnitude: string;
}

/**
 * Good news or bad news, given the movement's arithmetic sign.
 *
 * Income rising is favourable. Cost rising is adverse. A zero movement is
 * neither, and returns null rather than defaulting to favourable, because
 * "no change" being reported as good is how a flat month gets read as a win.
 */
export function isFavourable(sectionKind: SectionKind, movement: string): boolean | null {
  if (sectionKind === "total" || sectionKind === "unclassified") return null;

  const direction = new Decimal(movement);
  if (direction.isZero()) return null;

  return COST_KINDS.has(sectionKind) ? direction.isNegative() : direction.isPositive();
}

/**
 * Joins on account code where both sides have one, and falls back to the
 * account name. Xero omits the code on computed rows, and an entity that has
 * never set codes has only names to match on.
 */
function keyOf(row: PlRow): string {
  return row.accountCode ? `code:${row.accountCode}` : `name:${row.accountName.toLowerCase()}`;
}

export interface MovementOptions {
  threshold: ResolvedThreshold | null;
  /** Rows present in one period and not the other are treated as a move from zero. */
  currency?: string;
}

/**
 * Every account appearing in either period, with its movement.
 *
 * An account that exists in one period and not the other is a real movement,
 * not a missing row: a cost line that appears this month for the first time is
 * exactly the thing a controller wants ranked to the top.
 */
export function computeMovements(
  actualRows: PlRow[],
  comparativeRows: PlRow[],
  options: MovementOptions
): MovementRow[] {
  const currency = options.currency ?? "NZD";
  const comparativeByKey = new Map(comparativeRows.map((r) => [keyOf(r), r]));
  const actualByKey = new Map(actualRows.map((r) => [keyOf(r), r]));

  const allKeys = [...new Set([...actualByKey.keys(), ...comparativeByKey.keys()])];
  const rows: MovementRow[] = [];

  for (const key of allKeys) {
    const actualRow = actualByKey.get(key);
    const comparativeRow = comparativeByKey.get(key);
    const reference = actualRow ?? comparativeRow!;

    const actual = Money.of(actualRow?.amount ?? "0", currency);
    const comparative = Money.of(comparativeRow?.amount ?? "0", currency);
    const movement = actual.subtract(comparative);
    const movementString = movement.toFixedString(2);

    const percentValue = variancePercent(actual, comparative);
    const percent = percentValue ? percentValue.toFixed(2) : null;

    rows.push({
      accountCode: reference.accountCode,
      accountName: reference.accountName,
      sectionKind: reference.sectionKind,
      currency,
      actual: actual.toFixedString(2),
      comparative: comparative.toFixedString(2),
      movement: movementString,
      percent,
      favourable: isFavourable(reference.sectionKind, movementString),
      isException: isVarianceException(movementString, percent, options.threshold, currency),
      magnitude: movement.abs().toFixedString(2),
    });
  }

  return rows;
}

/**
 * VAR-003 ranking: exceptions first, then by size of movement.
 *
 * Sorting by magnitude alone buries a small movement that breached a tight
 * entity threshold underneath a large one that did not, which inverts the
 * point of having thresholds at all.
 */
export function rankByMateriality(rows: MovementRow[]): MovementRow[] {
  return [...rows].sort((a, b) => {
    if (a.isException !== b.isException) return a.isException ? -1 : 1;
    const bySize = new Decimal(b.magnitude).comparedTo(new Decimal(a.magnitude));
    if (bySize !== 0) return bySize;
    return a.accountName.localeCompare(b.accountName);
  });
}

export interface MovementSummary {
  rows: MovementRow[];
  exceptionCount: number;
  adverseCount: number;
  favourableCount: number;
}

export function summariseMovements(
  actualRows: PlRow[],
  comparativeRows: PlRow[],
  options: MovementOptions
): MovementSummary {
  const rows = rankByMateriality(computeMovements(actualRows, comparativeRows, options));

  return {
    rows,
    exceptionCount: rows.filter((r) => r.isException).length,
    adverseCount: rows.filter((r) => r.favourable === false).length,
    favourableCount: rows.filter((r) => r.favourable === true).length,
  };
}
