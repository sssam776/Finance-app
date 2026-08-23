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

export interface ThrottleDecision {
  blocked: boolean;
  recentFailures: number;
  retryAfterSeconds: number;
}

/**
 * `failureTimestamps` are ISO-8601 strings of recent `auth.login_failed`
 * events for one email. Anything outside the window is ignored, so the caller
 * may pass a wider slice without changing the outcome.
 */
export function throttleDecision(failureTimestamps: string[], nowMs: number): ThrottleDecision {
  const cutoff = nowMs - WINDOW_MS;

  const withinWindow = failureTimestamps
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t) && t > cutoff)
    .sort((a, b) => a - b);

  if (withinWindow.length < MAX_FAILURES) {
    return { blocked: false, recentFailures: withinWindow.length, retryAfterSeconds: 0 };
  }

  // The block lifts when the oldest failure in the window ages out, so a
  // locked-out account recovers on its own without an admin.
  const oldest = withinWindow[withinWindow.length - MAX_FAILURES]!;
  const retryAfterMs = Math.max(0, oldest + WINDOW_MS - nowMs);

  return {
    blocked: true,
    recentFailures: withinWindow.length,
    retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
  };
}
