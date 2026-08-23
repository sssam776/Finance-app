import { describe, it, expect } from "vitest";
import { resolveScopes, SCOPE_PROFILES, RETIRED_SCOPE_PROFILES } from "../lib/xero/scopeProfiles";

/**
 * Xero's OAuth 2.0 accounting scopes, as published. One scope per broad area,
 * not one per endpoint. Anything outside this set is rejected at the authorize
 * endpoint with invalid_scope, which fails the whole connection.
 */
const REAL_XERO_SCOPES = new Set([
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.transactions",
  "accounting.transactions.read",
  "accounting.reports.read",
  "accounting.reports.tenninetynine.read",
  "accounting.journals.read",
  "accounting.settings",
  "accounting.settings.read",
  "accounting.contacts",
  "accounting.contacts.read",
  "accounting.attachments",
  "accounting.attachments.read",
  "accounting.budgets.read",
]);

describe("read_core_v2", () => {
  it("contains only scopes Xero actually issues", () => {
    const invalid = SCOPE_PROFILES.read_core_v2!.filter((s) => !REAL_XERO_SCOPES.has(s));
    expect(invalid).toEqual([]);
  });

  it("is read-only: no scope grants write access", () => {
    // Xero write scopes are the same string without the .read suffix.
    const writeScopes = SCOPE_PROFILES.read_core_v2!.filter(
      (s) => s.startsWith("accounting.") && !s.endsWith(".read")
    );
    expect(writeScopes).toEqual([]);
  });

  it("covers the reports the sync route depends on", () => {
    // app/api/xero/sync/route.ts calls getReportBankSummary, which needs the
    // general reports scope. There is no per-report scope in Xero.
    expect(SCOPE_PROFILES.read_core_v2).toContain("accounting.reports.read");
  });

  it("covers transactions without naming individual endpoints", () => {
    expect(SCOPE_PROFILES.read_core_v2).toContain("accounting.transactions.read");
  });

  it("does not request journals, per spec 9.2", () => {
    expect(SCOPE_PROFILES.read_core_v2).not.toContain("accounting.journals.read");
  });

  it("resolves", () => {
    expect(resolveScopes("read_core_v2").length).toBeGreaterThan(0);
  });
});

describe("read_core_v1", () => {
  it("is retained so existing authorisation rows stay explainable", () => {
    expect(SCOPE_PROFILES.read_core_v1).toBeDefined();
  });

  it("is marked retired", () => {
    expect(RETIRED_SCOPE_PROFILES.has("read_core_v1")).toBe(true);
  });

  it("cannot be used to build a client", () => {
    expect(() => resolveScopes("read_core_v1")).toThrow(/retired/);
  });

  it("does in fact contain scopes Xero does not issue", () => {
    // The reason it is retired, asserted rather than assumed.
    const invalid = SCOPE_PROFILES.read_core_v1!.filter((s) => !REAL_XERO_SCOPES.has(s));
    expect(invalid).toContain("accounting.invoices.read");
    expect(invalid).toContain("accounting.reports.banksummary.read");
    expect(invalid.length).toBeGreaterThan(5);
  });
});

describe("resolveScopes", () => {
  it("throws on an unknown profile rather than granting nothing", () => {
    expect(() => resolveScopes("does_not_exist")).toThrow(/Unknown scope profile/);
  });
});
