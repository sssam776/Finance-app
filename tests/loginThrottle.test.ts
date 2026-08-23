import { describe, it, expect } from "vitest";
import { throttleDecision, MAX_FAILURES, WINDOW_MS } from "../lib/loginThrottle";

const NOW = 1_700_000_000_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("throttleDecision", () => {
  it("allows a clean account", () => {
    const d = throttleDecision([], NOW);
    expect(d.blocked).toBe(false);
    expect(d.recentFailures).toBe(0);
  });

  it("allows right up to the limit", () => {
    const attempts = Array.from({ length: MAX_FAILURES - 1 }, (_, i) => iso(-i * 1000));
    expect(throttleDecision(attempts, NOW).blocked).toBe(false);
  });

  it("blocks at the limit", () => {
    const attempts = Array.from({ length: MAX_FAILURES }, (_, i) => iso(-i * 1000));
    const d = throttleDecision(attempts, NOW);
    expect(d.blocked).toBe(true);
    expect(d.recentFailures).toBe(MAX_FAILURES);
    expect(d.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("ignores failures that have aged out of the window", () => {
    const stale = Array.from({ length: 20 }, (_, i) => iso(-WINDOW_MS - (i + 1) * 1000));
    expect(throttleDecision(stale, NOW).blocked).toBe(false);
  });

  it("counts only the in-window failures when history is mixed", () => {
    const stale = Array.from({ length: 10 }, (_, i) => iso(-WINDOW_MS - (i + 1) * 1000));
    const fresh = Array.from({ length: 2 }, (_, i) => iso(-i * 1000));
    const d = throttleDecision([...stale, ...fresh], NOW);
    expect(d.blocked).toBe(false);
    expect(d.recentFailures).toBe(2);
  });

  it("lifts the block on its own as the oldest failure ages out", () => {
    const attempts = Array.from({ length: MAX_FAILURES }, (_, i) => iso(-i * 1000));
    expect(throttleDecision(attempts, NOW).blocked).toBe(true);
    // One millisecond past the oldest attempt leaving the window.
    expect(throttleDecision(attempts, NOW + WINDOW_MS + 1).blocked).toBe(false);
  });

  it("reports a retry time that shrinks as the window slides", () => {
    const attempts = Array.from({ length: MAX_FAILURES }, () => iso(0));
    const early = throttleDecision(attempts, NOW + 60_000).retryAfterSeconds;
    const later = throttleDecision(attempts, NOW + 600_000).retryAfterSeconds;
    expect(later).toBeLessThan(early);
    expect(later).toBeGreaterThanOrEqual(0);
  });

  it("stays blocked when attempts keep arriving", () => {
    const attempts = Array.from({ length: 25 }, (_, i) => iso(-i * 1000));
    expect(throttleDecision(attempts, NOW).blocked).toBe(true);
  });

  it("ignores unparseable timestamps rather than counting them", () => {
    const junk = Array.from({ length: MAX_FAILURES }, () => "not-a-date");
    expect(throttleDecision(junk, NOW).blocked).toBe(false);
  });
});
