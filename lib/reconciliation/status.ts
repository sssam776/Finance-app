import Decimal from "decimal.js";
import { Money } from "../money";
import type { ResolvedThreshold } from "../thresholds";

/**
 * BS-004 and BS-005: what a balance-sheet workpaper's status may be, and what
 * it may never be.
 *
 * The requirement this module exists to satisfy is a refusal. A workpaper with
 * no substantiating source must never reach `reconciled`, however small the
 * difference is, because "the trial balance agrees with itself" is not
 * evidence that a balance is right. A module that quietly marks unsupported
 * balances as reconciled is worse than one that reports nothing: it tells the
 * Financial Controller a review happened.
 *
 * Pure. No database, no clock.
 */

export const WORKPAPER_STATUSES = [
  "not_started",
  "in_progress",
  "reconciled",
  "reconciled_with_timing_difference",
  "unresolved",
  "unsubstantiated",
  "partial",
  "reviewed",
  "locked",
] as const;

export type WorkpaperStatus = (typeof WORKPAPER_STATUSES)[number];

/** BS-002's list. `none` means nothing has been attached at all. */
export const SUBSTANTIATION_TYPES = [
  "bank_balance",
  "intercompany",
  "aged_receivables",
  "aged_payables",
  "gst_control",
  "loan_register",
  "wip_schedule",
  "fixed_assets",
  "manual_schedule",
  "none",
] as const;

export type SubstantiationType = (typeof SUBSTANTIATION_TYPES)[number];

export type SubstantiationAvailability =
  | "available"
  | "partial"
  | "unavailable"
  | "counterparty_unavailable";

export interface WorkpaperInput {
  /** Trial balance figure, debit-positive. Decimal string. */
  tbAmount: string;
  /**
   * What the supporting source says. Null means nothing has substantiated it,
   * which is not the same as a source saying zero.
   */
  substantiatedAmount: string | null;
  substantiationType: SubstantiationType;
  availability: SubstantiationAvailability;
  /** A recorded, explained timing difference between the two figures. */
  timingDifferenceNote?: string | null;
  currency?: string;
}

export interface WorkpaperResolution {
  status: WorkpaperStatus;
  /** Signed: trial balance minus substantiated. Null when nothing substantiates it. */
  difference: string | null;
  /** Plain-language reason, shown to whoever has to act on it. */
  reason: string;
}

/**
 * The status a workpaper is in, given what actually supports it.
 *
 * `reconciled` is reachable from exactly one path: a source exists, it is
 * fully available, and its figure agrees within materiality. Every other
 * combination lands somewhere that says so.
 */
export function resolveWorkpaperStatus(
  input: WorkpaperInput,
  materiality: ResolvedThreshold | null
): WorkpaperResolution {
  const currency = input.currency ?? "NZD";

  // Nothing attached. This is the case BS-005 is about, and it stays visibly
  // unsupported no matter how the numbers look.
  if (input.substantiationType === "none" || input.substantiatedAmount === null) {
    return {
      status: "unsubstantiated",
      difference: null,
      reason:
        "No supporting source is attached. A balance cannot be reconciled against itself, so this stays unsubstantiated until a schedule, statement or counterparty balance is provided.",
    };
  }

  if (input.availability === "unavailable") {
    return {
      status: "unsubstantiated",
      difference: null,
      reason: `The ${input.substantiationType.replace(/_/g, " ")} source is unavailable for this period.`,
    };
  }

  if (input.availability === "counterparty_unavailable") {
    // Module F's rule, borrowed: an intercompany balance is only substantiated
    // when both sides are readable. One side alone is an assertion.
    return {
      status: "unsubstantiated",
      difference: null,
      reason:
        "The counterparty entity is not connected, so only one side of this balance can be read. An intercompany balance confirmed from one side is an assertion, not a reconciliation.",
    };
  }

  const tb = Money.of(input.tbAmount, currency);
  const supported = Money.of(input.substantiatedAmount, currency);
  const difference = tb.subtract(supported).toFixedString(2);
  const withinMateriality = isWithinMateriality(difference, materiality, currency);

  if (input.availability === "partial") {
    return {
      status: "partial",
      difference,
      reason:
        "The supporting source covers only part of this balance, so the difference shown is not the whole story.",
    };
  }

  if (withinMateriality) {
    return {
      status: "reconciled",
      difference,
      reason: "Agrees with its supporting source within materiality.",
    };
  }

  // A difference that someone has explained as timing is still a difference,
  // and is reported as its own status rather than folded into reconciled.
  if (input.timingDifferenceNote && input.timingDifferenceNote.trim() !== "") {
    return {
      status: "reconciled_with_timing_difference",
      difference,
      reason: `Difference of ${difference} explained as timing: ${input.timingDifferenceNote.trim()}`,
    };
  }

  return {
    status: "unresolved",
    difference,
    reason: `Differs from its supporting source by ${difference}, which is over materiality and unexplained.`,
  };
}

function isWithinMateriality(
  difference: string,
  materiality: ResolvedThreshold | null,
  currency: string
): boolean {
  // No materiality configured means only an exact agreement counts. Guessing a
  // tolerance would be inventing accounting policy.
  if (!materiality) return new Decimal(difference).isZero();

  const observed = Money.of(difference, currency).abs();
  const limit = Money.of(materiality.absoluteAmount, currency).abs();
  return observed.compare(limit) <= 0;
}

/**
 * Statuses that mean the balance is supported. Used for close readiness, and
 * deliberately short.
 */
const SETTLED: ReadonlySet<WorkpaperStatus> = new Set([
  "reconciled",
  "reconciled_with_timing_difference",
  "reviewed",
  "locked",
]);

export function isSettled(status: WorkpaperStatus): boolean {
  return SETTLED.has(status);
}

export interface PeriodReadiness {
  ready: boolean;
  settled: number;
  outstanding: number;
  /** Material accounts that are not settled. These are what block a lock. */
  blocking: string[];
}

/**
 * BS-001: whether a period can be locked.
 *
 * Only material accounts block. An immaterial account left unsubstantiated is
 * recorded and does not hold up a close, which is how an accountant actually
 * works. An admin can still lock over the blockers, but that becomes an
 * explicit acknowledgement rather than a silent pass.
 */
export function periodReadiness(
  workpapers: { accountCode: string; status: WorkpaperStatus; isMaterial: boolean }[]
): PeriodReadiness {
  const settled = workpapers.filter((w) => isSettled(w.status));
  const blocking = workpapers
    .filter((w) => w.isMaterial && !isSettled(w.status))
    .map((w) => w.accountCode);

  return {
    ready: blocking.length === 0,
    settled: settled.length,
    outstanding: workpapers.length - settled.length,
    blocking,
  };
}
