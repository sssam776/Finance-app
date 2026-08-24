/**
 * Approval rules, shared as functions rather than as a table.
 *
 * Seven module plans each invented a versioned, approved, effective-dated
 * table: group account mappings, rule versions, loan covenants, action
 * approvals, reconciliation periods, intercompany relationships, budget
 * snapshots. Seven tables with three columns in common is a coincidence, not
 * an abstraction, so the tables stay per-module and only the policy is shared.
 *
 * Pure. No database, no session, no clock of its own.
 */

export class ApprovalError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ApprovalError";
  }
}

export interface SegregationPolicy {
  /**
   * Whether the approver must be a different person from the preparer.
   *
   * Defaults on. The whole point of an approval step is that a second person
   * looked, and an approval a preparer granted themselves records a review
   * that never happened.
   */
  requireDifferentApprover?: boolean;
}

/**
 * Returns why this approval must be refused, or null if it may proceed.
 *
 * Comparison is case-insensitive and trimmed, because the same person with a
 * differently-cased address is the same person, and treating them as two is
 * how self-approval slips through a check that looks correct.
 */
export function segregationFailureReason(
  preparerEmail: string | null | undefined,
  approverEmail: string,
  policy: SegregationPolicy = {}
): string | null {
  const approver = approverEmail.trim().toLowerCase();
  if (approver === "") return "An approver is required.";

  if (policy.requireDifferentApprover === false) return null;

  const preparer = (preparerEmail ?? "").trim().toLowerCase();
  // Nobody prepared it, so there is nobody to be different from. A module that
  // requires a preparer enforces that separately; this rule is only about the
  // two being the same person.
  if (preparer === "") return null;

  if (preparer === approver) {
    return "The approver must be a different person from the preparer.";
  }
  return null;
}

export function assertApprover(
  preparerEmail: string | null | undefined,
  approverEmail: string,
  policy: SegregationPolicy = {}
): void {
  const reason = segregationFailureReason(preparerEmail, approverEmail, policy);
  if (reason) throw new ApprovalError(reason);
}

export interface EffectiveDated {
  /** Date-only, inclusive. */
  effectiveFrom: string;
  /** Date-only, inclusive. Null means open-ended. */
  effectiveTo?: string | null;
  status?: string;
}

export interface EffectiveResolution<T> {
  row: T | null;
  /** Set when nothing applied, or when the data is ambiguous. */
  reason: string | null;
}

/**
 * The one row in effect on a date.
 *
 * Fails closed on overlap. Two versions claiming the same date is a data
 * error, and picking either one silently means a board pack could be built
 * twice from the same inputs and disagree with itself. `resolveXeroRoute`
 * takes the same position on duplicate active assignments.
 *
 * Rows whose status is present and not "approved" are ignored: a draft
 * mapping must never be what a report is built from.
 */
export function resolveEffectiveVersion<T extends EffectiveDated>(
  rows: T[],
  asOf: string,
  options: { requireApproved?: boolean } = {}
): EffectiveResolution<T> {
  const requireApproved = options.requireApproved ?? true;

  const candidates = rows.filter((row) => {
    if (requireApproved && row.status !== undefined && row.status !== "approved") return false;
    if (row.effectiveFrom > asOf) return false;
    if (row.effectiveTo != null && row.effectiveTo < asOf) return false;
    return true;
  });

  if (candidates.length === 0) {
    return { row: null, reason: `No approved version is in effect on ${asOf}.` };
  }
  if (candidates.length > 1) {
    return {
      row: null,
      reason: `${candidates.length} versions are in effect on ${asOf}. Overlapping effective windows must be corrected before this can be used.`,
    };
  }

  return { row: candidates[0]!, reason: null };
}
