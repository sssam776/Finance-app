/**
 * Spec 17.6 — connection status and stale-data warnings.
 *
 * `status` and `lastSuccessfulCallAt` are already stored on every connection,
 * but nothing surfaced them, so a connection that silently stopped syncing
 * looked identical to one that synced a minute ago. A cash position built on
 * three-week-old Xero data is worse than no cash position, because it looks
 * current.
 *
 * Pure: the caller supplies the row and the clock.
 */

export type ConnectionStatus =
  | "pending_authorisation"
  | "healthy"
  | "refresh_due"
  | "reauthorisation_required"
  | "permission_missing"
  | "rate_limited"
  | "sync_error"
  | "disconnected"
  | "disabled"
  | "capacity_blocked"
  | "compliance_blocked";

/** Beyond this, data is old enough that a variance figure should not be trusted without a re-sync. */
export const STALE_AFTER_HOURS = 24;
/** Beyond this, treat the connection as effectively broken rather than merely stale. */
export const SEVERELY_STALE_AFTER_HOURS = 72;

export type HealthLevel = "ok" | "warning" | "error";

export interface ConnectionHealth {
  level: HealthLevel;
  /** One sentence an operator can act on. Null when there is nothing to say. */
  message: string | null;
  hoursSinceSuccess: number | null;
  stale: boolean;
  /** True when the fix is a human reconnecting the organisation, not a retry. */
  needsAttention: boolean;
}

/**
 * Statuses that no amount of waiting will fix. Each needs a person to do
 * something, so they outrank staleness in the message shown.
 */
const TERMINAL_MESSAGES: Partial<Record<ConnectionStatus, string>> = {
  reauthorisation_required: "Reauthorisation required. Reconnect this organisation to resume syncing.",
  permission_missing: "The connected Xero user lacks permission for the requested data.",
  disconnected: "Disconnected in Xero. Reconnect to resume syncing.",
  disabled: "Disabled in this app. No syncing will occur.",
  capacity_blocked: "Blocked: the Xero app has no connection slots left.",
  compliance_blocked: "Blocked: the Xero app is not approved for production use.",
};

function hoursBetween(fromIso: string, nowMs: number): number {
  return (nowMs - new Date(fromIso).getTime()) / 3_600_000;
}

export function connectionHealth(
  connection: { status: string; lastSuccessfulCallAt: string | null; lastConnectedAt: string | null },
  nowMs: number
): ConnectionHealth {
  const status = connection.status as ConnectionStatus;

  const terminal = TERMINAL_MESSAGES[status];
  if (terminal) {
    return {
      level: "error",
      message: terminal,
      hoursSinceSuccess: connection.lastSuccessfulCallAt
        ? hoursBetween(connection.lastSuccessfulCallAt, nowMs)
        : null,
      stale: true,
      needsAttention: true,
    };
  }

  if (status === "pending_authorisation") {
    return {
      level: "warning",
      message: "Authorisation has not been completed yet.",
      hoursSinceSuccess: null,
      stale: true,
      needsAttention: true,
    };
  }

  // Connected, but never successfully read anything. Distinct from stale: there
  // is no old data here, there is no data at all.
  if (!connection.lastSuccessfulCallAt) {
    return {
      level: "warning",
      message: "Connected, but no successful sync has run yet.",
      hoursSinceSuccess: null,
      stale: true,
      needsAttention: false,
    };
  }

  const hours = hoursBetween(connection.lastSuccessfulCallAt, nowMs);

  // A clock skew or a future-dated row must not read as "fresh for 200 hours".
  if (hours < 0) {
    return {
      level: "warning",
      message: "Last successful sync is dated in the future. Check the server clock.",
      hoursSinceSuccess: hours,
      stale: false,
      needsAttention: true,
    };
  }

  if (status === "rate_limited") {
    return {
      level: "warning",
      message: "Rate limited by Xero. Syncing will resume once the limit resets.",
      hoursSinceSuccess: hours,
      stale: hours >= STALE_AFTER_HOURS,
      needsAttention: false,
    };
  }

  if (status === "sync_error") {
    return {
      level: "error",
      message: "The last sync failed. See the sync run for the error.",
      hoursSinceSuccess: hours,
      stale: true,
      needsAttention: true,
    };
  }

  if (hours >= SEVERELY_STALE_AFTER_HOURS) {
    return {
      level: "error",
      message: `No successful sync for ${Math.floor(hours)} hours. Treat these figures as out of date.`,
      hoursSinceSuccess: hours,
      stale: true,
      needsAttention: true,
    };
  }

  if (hours >= STALE_AFTER_HOURS) {
    return {
      level: "warning",
      message: `Last successful sync was ${Math.floor(hours)} hours ago.`,
      hoursSinceSuccess: hours,
      stale: true,
      needsAttention: false,
    };
  }

  return {
    level: "ok",
    message: null,
    hoursSinceSuccess: hours,
    stale: false,
    needsAttention: false,
  };
}

/**
 * Status words that read as reassuring on their own.
 *
 * `connectionHealth` already consumes `status` — it is one input among several,
 * so the two can disagree. A connection whose OAuth is fine but whose last
 * successful sync was 665 hours ago carries `status: "healthy"` alongside
 * `level: "error"`.
 */
const REASSURING_STATUSES: ReadonlySet<string> = new Set(["healthy", "refresh_due"]);

/**
 * The word to show on a connection's status pill.
 *
 * The pill's colour comes from `level`, so its word has to come from the same
 * verdict or the two contradict each other: the Xero screen was rendering the
 * word "healthy" in the error tone, directly above a message saying the figures
 * were out of date. Colour and word disagreeing is worse than either alone,
 * because whichever one the reader trusts, the other was telling the truth.
 *
 * A status that is already a problem word is shown verbatim — "disconnected" in
 * the error tone agrees with itself and says more than a generic label could.
 * Only a reassuring word under a warning or error tone is replaced.
 */
export function healthLabel(level: HealthLevel, status: string): string {
  if (level === "ok" || !REASSURING_STATUSES.has(status)) {
    return status.replace(/_/g, " ");
  }
  return level === "error" ? "needs attention" : "stale";
}
