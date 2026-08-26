import { describe, it, expect } from "vitest";
import {
  resolveWorkpaperStatus,
  periodReadiness,
  isSettled,
  type WorkpaperInput,
} from "../lib/reconciliation/status";
import { resolveThreshold, type ThresholdRow } from "../lib/thresholds";

const ROWS: ThresholdRow[] = [
  { entityId: "*", context: "balance_sheet", absoluteAmount: "100.00", percent: null },
];
const materiality = resolveThreshold(ROWS, "e1", "balance_sheet");

function wp(overrides: Partial<WorkpaperInput> = {}): WorkpaperInput {
  return {
    tbAmount: "10000.00",
    substantiatedAmount: "10000.00",
    substantiationType: "bank_balance",
    availability: "available",
    ...overrides,
  };
}

describe("BS-005 — an unsupported balance can never read as reconciled", () => {
  it("is unsubstantiated when nothing is attached", () => {
    const r = resolveWorkpaperStatus(
      wp({ substantiationType: "none", substantiatedAmount: null }),
      materiality
    );
    expect(r.status).toBe("unsubstantiated");
    expect(r.difference).toBeNull();
  });

  it("stays unsubstantiated even when the trial balance figure looks perfect", () => {
    // The failure mode this prevents: a nil balance with no source reading as
    // reconciled because zero minus nothing is zero.
    const r = resolveWorkpaperStatus(
      wp({ tbAmount: "0.00", substantiatedAmount: null, substantiationType: "none" }),
      materiality
    );
    expect(r.status).toBe("unsubstantiated");
  });

  it("distinguishes a source saying zero from no source at all", () => {
    // A schedule that genuinely shows nil is evidence. A missing schedule is not.
    const withSource = resolveWorkpaperStatus(
      wp({ tbAmount: "0.00", substantiatedAmount: "0.00", substantiationType: "manual_schedule" }),
      materiality
    );
    expect(withSource.status).toBe("reconciled");

    const withoutSource = resolveWorkpaperStatus(
      wp({ tbAmount: "0.00", substantiatedAmount: null, substantiationType: "manual_schedule" }),
      materiality
    );
    expect(withoutSource.status).toBe("unsubstantiated");
  });

  it("is unsubstantiated when the source exists but is unavailable this period", () => {
    const r = resolveWorkpaperStatus(wp({ availability: "unavailable" }), materiality);
    expect(r.status).toBe("unsubstantiated");
    expect(r.reason).toMatch(/unavailable/);
  });

  it("refuses a one-sided intercompany balance", () => {
    // A balance confirmed from one side only is an assertion, not a
    // reconciliation.
    const r = resolveWorkpaperStatus(
      wp({ substantiationType: "intercompany", availability: "counterparty_unavailable" }),
      materiality
    );
    expect(r.status).toBe("unsubstantiated");
    expect(r.reason).toMatch(/one side|assertion/i);
  });

  it("has no input at all that yields reconciled without a source", () => {
    // Exhaustive over the shapes a caller could construct with no support.
    for (const availability of ["available", "partial", "unavailable", "counterparty_unavailable"] as const) {
      const r = resolveWorkpaperStatus(
        wp({ substantiatedAmount: null, substantiationType: "none", availability }),
        materiality
      );
      expect(r.status).not.toBe("reconciled");
      expect(r.status).not.toBe("reconciled_with_timing_difference");
    }
  });
});

describe("resolveWorkpaperStatus — supported balances", () => {
  it("reconciles an exact agreement", () => {
    expect(resolveWorkpaperStatus(wp(), materiality).status).toBe("reconciled");
  });

  it("reconciles a difference inside materiality", () => {
    const r = resolveWorkpaperStatus(wp({ substantiatedAmount: "9950.00" }), materiality);
    expect(r.status).toBe("reconciled");
    expect(r.difference).toBe("50.00");
  });

  it("does not reconcile a difference over materiality", () => {
    const r = resolveWorkpaperStatus(wp({ substantiatedAmount: "9000.00" }), materiality);
    expect(r.status).toBe("unresolved");
    expect(r.difference).toBe("1000.00");
    expect(r.reason).toMatch(/unexplained/);
  });

  it("records an explained timing difference as its own status, not as reconciled", () => {
    // A difference someone explained is still a difference. Folding it into
    // reconciled loses the fact that the balance does not currently agree.
    const r = resolveWorkpaperStatus(
      wp({ substantiatedAmount: "9000.00", timingDifferenceNote: "Deposit cleared 2 August" }),
      materiality
    );
    expect(r.status).toBe("reconciled_with_timing_difference");
    expect(r.difference).toBe("1000.00");
  });

  it("ignores a blank timing note", () => {
    const r = resolveWorkpaperStatus(
      wp({ substantiatedAmount: "9000.00", timingDifferenceNote: "   " }),
      materiality
    );
    expect(r.status).toBe("unresolved");
  });

  it("reports partial coverage rather than a difference that looks whole", () => {
    const r = resolveWorkpaperStatus(
      wp({ substantiatedAmount: "6000.00", availability: "partial" }),
      materiality
    );
    expect(r.status).toBe("partial");
    expect(r.reason).toMatch(/only part/);
  });

  it("requires exact agreement when no materiality is configured", () => {
    // Guessing a tolerance would be inventing accounting policy.
    expect(resolveWorkpaperStatus(wp({ substantiatedAmount: "9999.99" }), null).status).toBe(
      "unresolved"
    );
    expect(resolveWorkpaperStatus(wp(), null).status).toBe("reconciled");
  });

  it("treats a difference by magnitude, not by sign", () => {
    const over = resolveWorkpaperStatus(wp({ substantiatedAmount: "10500.00" }), materiality);
    expect(over.status).toBe("unresolved");
    expect(over.difference).toBe("-500.00");
  });
});

describe("periodReadiness", () => {
  const settledRow = { accountCode: "100", status: "reconciled" as const, isMaterial: true };

  it("is ready when every material account is settled", () => {
    const r = periodReadiness([settledRow, { accountCode: "200", status: "reviewed", isMaterial: true }]);
    expect(r.ready).toBe(true);
    expect(r.blocking).toEqual([]);
  });

  it("is blocked by a material account that is not settled", () => {
    const r = periodReadiness([
      settledRow,
      { accountCode: "300", status: "unsubstantiated", isMaterial: true },
    ]);
    expect(r.ready).toBe(false);
    expect(r.blocking).toEqual(["300"]);
  });

  it("is not blocked by an immaterial account", () => {
    // An immaterial balance left unsupported is recorded and does not hold up
    // a close, which is how an accountant actually works.
    const r = periodReadiness([
      settledRow,
      { accountCode: "999", status: "unsubstantiated", isMaterial: false },
    ]);
    expect(r.ready).toBe(true);
    expect(r.outstanding).toBe(1);
  });

  it("counts outstanding separately from blocking", () => {
    const r = periodReadiness([
      settledRow,
      { accountCode: "998", status: "in_progress", isMaterial: false },
      { accountCode: "300", status: "unresolved", isMaterial: true },
    ]);
    expect(r.settled).toBe(1);
    expect(r.outstanding).toBe(2);
    expect(r.blocking).toEqual(["300"]);
  });

  it("treats an empty period as ready rather than throwing", () => {
    expect(periodReadiness([]).ready).toBe(true);
  });
});

describe("isSettled", () => {
  it("counts only genuinely supported statuses", () => {
    expect(isSettled("reconciled")).toBe(true);
    expect(isSettled("reconciled_with_timing_difference")).toBe(true);
    expect(isSettled("reviewed")).toBe(true);
    expect(isSettled("locked")).toBe(true);
  });

  it("does not count an unsupported or in-flight status", () => {
    expect(isSettled("unsubstantiated")).toBe(false);
    expect(isSettled("partial")).toBe(false);
    expect(isSettled("unresolved")).toBe(false);
    expect(isSettled("in_progress")).toBe(false);
    expect(isSettled("not_started")).toBe(false);
  });
});
