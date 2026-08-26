import { describe, it, expect } from "vitest";
import { resolveScopes, SCOPE_PROFILES, RETIRED_SCOPE_PROFILES } from "../lib/xero/scopeProfiles";

/**
 * Granular Xero scopes, each one verified by issuing an authorize request and
 * observing whether Xero redirected to its error page. Apps created from
 * 2 March 2026 are granted these and not the older broad scopes.
 *
 * Verified rather than transcribed, because the previous version of this file
 * asserted from documentation that per-report scopes did not exist. They do,
 * and the resulting profile could not complete OAuth at all.
 */
const VERIFIED_VALID = new Set([
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.settings.read",
  "accounting.contacts.read",
  "accounting.attachments.read",
  "accounting.budgets.read",
  "accounting.invoices.read",
  "accounting.payments.read",
  "accounting.banktransactions.read",
  "accounting.manualjournals.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.banksummary.read",
  "accounting.reports.aged.read",
  "accounting.reports.budgetsummary.read",
  "accounting.reports.executivesummary.read",
  "accounting.reports.tenninetynine.read",
]);

/** Confirmed rejected by the same method. */
const VERIFIED_INVALID = new Set([
  "accounting.transactions.read",
  "accounting.reports.read",
  "accounting.creditnotes.read",
  "accounting.journals.read",
  "accounting.accounts.read",
]);

describe("read_core_v3", () => {
  const profile = SCOPE_PROFILES.read_core_v3!;

  it("contains only scopes confirmed valid at the authorize endpoint", () => {
    expect(profile.filter((s) => !VERIFIED_VALID.has(s))).toEqual([]);
  });

  it("contains no scope confirmed to be rejected", () => {
    expect(profile.filter((s) => VERIFIED_INVALID.has(s))).toEqual([]);
  });

  it("is read-only: no scope grants write access", () => {
    // A Xero write scope is the same string without the .read suffix.
    expect(profile.filter((s) => s.startsWith("accounting.") && !s.endsWith(".read"))).toEqual([]);
  });

  it("covers every report the sync routes request", () => {
    // getReportBankSummary, getReportProfitAndLoss and getReportTrialBalance
    // each need their own grant now that the general reports scope is gone.
    expect(profile).toContain("accounting.reports.banksummary.read");
    expect(profile).toContain("accounting.reports.profitandloss.read");
    expect(profile).toContain("accounting.reports.trialbalance.read");
  });

  it("covers the chart of accounts that getAccounts reads", () => {
    expect(profile).toContain("accounting.settings.read");
  });

  it("requests nothing the build does not read", () => {
    /**
     * Least privilege, asserted rather than intended. The app makes four Xero
     * calls; anything beyond the grants those need would appear on a consent
     * screen the client is asked to approve, describing access the software
     * never uses.
     *
     * This fails deliberately when a scope is added ahead of the feature that
     * needs it. Add the call first, then the scope.
     */
    const permitted = new Set([
      "openid",
      "profile",
      "email",
      "offline_access",
      "accounting.settings.read",
      "accounting.reports.banksummary.read",
      "accounting.reports.profitandloss.read",
      "accounting.reports.trialbalance.read",
    ]);
    expect(profile.filter((s) => !permitted.has(s))).toEqual([]);
  });

  it("resolves", () => {
    expect(resolveScopes("read_core_v3").length).toBeGreaterThan(0);
  });
});

describe("retired profiles", () => {
  it("retains both so existing authorisation rows stay explainable", () => {
    expect(SCOPE_PROFILES.read_core_v1).toBeDefined();
    expect(SCOPE_PROFILES.read_core_v2).toBeDefined();
  });

  it("marks both retired", () => {
    expect(RETIRED_SCOPE_PROFILES.has("read_core_v1")).toBe(true);
    expect(RETIRED_SCOPE_PROFILES.has("read_core_v2")).toBe(true);
  });

  it("refuses to build a client from either", () => {
    expect(() => resolveScopes("read_core_v1")).toThrow(/retired/);
    expect(() => resolveScopes("read_core_v2")).toThrow(/retired/);
  });

  it("names the reason read_core_v2 fails: the broad scopes are no longer granted", () => {
    // This is the defect that reached a live consent screen. v2 looked correct
    // and passed every test written against the documentation of the day.
    const rejected = SCOPE_PROFILES.read_core_v2!.filter((s) => VERIFIED_INVALID.has(s));
    expect(rejected).toContain("accounting.transactions.read");
    expect(rejected).toContain("accounting.reports.read");
  });
});

describe("resolveScopes", () => {
  it("throws on an unknown profile rather than granting nothing", () => {
    expect(() => resolveScopes("does_not_exist")).toThrow(/Unknown scope profile/);
  });
});
