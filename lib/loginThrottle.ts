/**
 * Failed-login throttling.
 *
 * The failures are already recorded in `audit_events` as `auth.login_failed`,
 * so this counts those rather than introducing a second store that could
 * disagree with the audit trail.
 *
 * Pure on purpose: the caller supplies the timestamps and the clock.
 *
 * TRADEOFF, deliberate: attempts are counted per email address, so someone who
 * knows a colleague's address can lock them out for the window length. On a
 * finance tool with a handful of named users, a fifteen-minute lockout is a
 * better failure than unlimited offline-speed guessing against a real account.
 * If this ever faces the open internet, add per-IP counting alongside it
 * rather than replacing this.
 */

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

/**
 * Per-email counting alone is bypassable: a caller who varies the address
 * never accumulates failures against any one of them, so every request still
 * reaches scrypt and still writes a permanent audit row. This second limit
 * counts failures across all addresses in the same window and closes that.
 *
 * Set well above the per-email limit so ordinary users fumbling their
 * passwords at the same time are unaffected. Ten named finance users cannot
 * plausibly produce 50 failures in fifteen minutes between them; a script can
 * produce that in seconds.
 */
export const MAX_GLOBAL_FAILURES = 50;

export interface ThrottleDecision {
  blocked: boolean;
  recentFailures: number;
  retryAfterSeconds: number;
  /** Which limit fired, so the audit record says why. */
  scope?: "email" | "global";
}

function withinWindow(timestamps: string[], nowMs: number): number[] {
  const cutoff = nowMs - WINDOW_MS;
  return timestamps
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t) && t > cutoff)
    .sort((a, b) => a - b);
}

function decide(times: number[], limit: number, nowMs: number, scope: "email" | "global"): ThrottleDecision {
  if (times.length < limit) {
    return { blocked: false, recentFailures: times.length, retryAfterSeconds: 0 };
  }
  const oldest = times[times.length - limit]!;
  return {
    blocked: true,
    recentFailures: times.length,
    retryAfterSeconds: Math.ceil(Math.max(0, oldest + WINDOW_MS - nowMs) / 1000),
    scope,
  };
}

/**
 * `failureTimestamps` are ISO-8601 strings of recent `auth.login_failed`
 * events for one email. Anything outside the window is ignored, so the caller
 * may pass a wider slice without changing the outcome.
 */
export function throttleDecision(failureTimestamps: string[], nowMs: number): ThrottleDecision {
  // The block lifts when the oldest failure in the window ages out, so a
  // locked-out account recovers on its own without an admin.
  return decide(withinWindow(failureTimestamps, nowMs), MAX_FAILURES, nowMs, "email");
}

/**
 * Both limits, per-email first so a genuinely repeated attack on one account
 * is still reported as such. `globalFailureTimestamps` covers every address.
 */
export function combinedThrottleDecision(
  emailFailureTimestamps: string[],
  globalFailureTimestamps: string[],
  nowMs: number
): ThrottleDecision {
  const byEmail = throttleDecision(emailFailureTimestamps, nowMs);
  if (byEmail.blocked) return byEmail;

  return decide(withinWindow(globalFailureTimestamps, nowMs), MAX_GLOBAL_FAILURES, nowMs, "global");
}
