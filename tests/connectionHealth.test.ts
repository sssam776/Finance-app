import { describe, it, expect } from "vitest";
import {
  connectionHealth,
  STALE_AFTER_HOURS,
  SEVERELY_STALE_AFTER_HOURS,
} from "../lib/xero/connectionHealth";

const NOW = 1_700_000_000_000;
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function conn(overrides: Partial<Parameters<typeof connectionHealth>[0]> = {}) {
  return {
    status: "healthy",
    lastSuccessfulCallAt: hoursAgo(1),
    lastConnectedAt: hoursAgo(2),
    ...overrides,
  };
}

describe("connectionHealth", () => {
  it("reports a recently synced healthy connection as ok and silent", () => {
    const h = connectionHealth(conn(), NOW);
    expect(h.level).toBe("ok");
    expect(h.message).toBeNull();
    expect(h.stale).toBe(false);
    expect(h.needsAttention).toBe(false);
  });

  it("warns once data crosses the stale threshold", () => {
    const h = connectionHealth(conn({ lastSuccessfulCallAt: hoursAgo(STALE_AFTER_HOURS) }), NOW);
    expect(h.level).toBe("warning");
    expect(h.stale).toBe(true);
    expect(h.message).toMatch(/hours ago/);
  });

  it("stays ok just under the stale threshold", () => {
    const h = connectionHealth(conn({ lastSuccessfulCallAt: hoursAgo(STALE_AFTER_HOURS - 0.1) }), NOW);
    expect(h.level).toBe("ok");
    expect(h.stale).toBe(false);
  });

  it("escalates to error when severely stale", () => {
    const h = connectionHealth(conn({ lastSuccessfulCallAt: hoursAgo(SEVERELY_STALE_AFTER_HOURS) }), NOW);
    expect(h.level).toBe("error");
    expect(h.needsAttention).toBe(true);
    expect(h.message).toMatch(/out of date/);
  });

  it("treats reauthorisation, disconnection and permission loss as errors needing a person", () => {
    for (const status of ["reauthorisation_required", "disconnected", "permission_missing"]) {
      const h = connectionHealth(conn({ status }), NOW);
      expect(h.level).toBe("error");
      expect(h.needsAttention).toBe(true);
      expect(h.stale).toBe(true);
    }
  });

  it("reports a terminal status even when the last sync was recent", () => {
    // A connection revoked in Xero five minutes ago is broken, not fresh.
    const h = connectionHealth(conn({ status: "disconnected", lastSuccessfulCallAt: hoursAgo(0.05) }), NOW);
    expect(h.level).toBe("error");
  });

  it("distinguishes never-synced from stale", () => {
    const h = connectionHealth(conn({ lastSuccessfulCallAt: null }), NOW);
    expect(h.level).toBe("warning");
    expect(h.hoursSinceSuccess).toBeNull();
    expect(h.message).toMatch(/no successful sync has run yet/i);
  });

  it("treats rate limiting as temporary, not as something to action", () => {
    const h = connectionHealth(conn({ status: "rate_limited" }), NOW);
    expect(h.level).toBe("warning");
    expect(h.needsAttention).toBe(false);
  });

  it("treats a failed sync as an error even if it was recent", () => {
    const h = connectionHealth(conn({ status: "sync_error", lastSuccessfulCallAt: hoursAgo(0.5) }), NOW);
    expect(h.level).toBe("error");
    expect(h.stale).toBe(true);
  });

  it("flags a future-dated sync instead of reading it as indefinitely fresh", () => {
    const h = connectionHealth(conn({ lastSuccessfulCallAt: new Date(NOW + 3_600_000).toISOString() }), NOW);
    expect(h.needsAttention).toBe(true);
    expect(h.message).toMatch(/clock/i);
    expect(h.stale).toBe(false);
  });

  it("flags capacity and compliance blocks distinctly", () => {
    expect(connectionHealth(conn({ status: "capacity_blocked" }), NOW).message).toMatch(/slots/);
    expect(connectionHealth(conn({ status: "compliance_blocked" }), NOW).message).toMatch(/approved/);
  });
});
