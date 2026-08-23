/**
 * Versioned scope profiles (spec 9.1). Xero apps reference a profile by name
 * rather than a free-form scope string so a scope change is a reviewable,
 * auditable event.
 */

export const SCOPE_PROFILES: Record<string, string[]> = {
  /**
   * Spec 9.2's list, transcribed verbatim. RETAINED, NOT USED.
   *
   * Twelve of these twenty strings are not scopes Xero issues. Xero's
   * accounting API grants one scope per broad area, not one per endpoint:
   * there is no `accounting.invoices.read`, no `accounting.payments.read`,
   * and no per-report scope such as `accounting.reports.banksummary.read`.
   * An authorize request carrying them is rejected with `invalid_scope`,
   * which means an app on this profile cannot complete OAuth at all.
   *
   * The spec introduces the list as an "Initial read_core_v1 candidate"
   * (spec 9.2), so correcting it is what the spec asks for, not a deviation.
   *
   * Kept because a profile is referenced by name from the xero_apps registry
   * and an existing authorisation records the profile it was granted under.
   * Deleting it would make an old row unexplainable. Nothing should be
   * assigned to it.
   */
  read_core_v1: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "accounting.settings.read",
    "accounting.contacts.read",
    "accounting.invoices.read",
    "accounting.payments.read",
    "accounting.banktransactions.read",
    "accounting.manualjournals.read",
    "accounting.reports.aged.read",
    "accounting.reports.balancesheet.read",
    "accounting.reports.banksummary.read",
    "accounting.reports.budgetsummary.read",
    "accounting.reports.executivesummary.read",
    "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read",
    "accounting.reports.taxreports.read",
    "accounting.attachments.read",
    "accounting.budgets.read",
  ],

  /**
   * The same read-only intent expressed in scopes Xero actually issues.
   *
   * `accounting.transactions.read` covers invoices, payments, bank
   * transactions, credit notes, prepayments, overpayments and manual
   * journals. `accounting.reports.read` covers every report the earlier
   * per-report strings tried to name individually, including Bank Summary,
   * which `app/api/xero/sync/route.ts` depends on.
   *
   * Still read-only: every scope ends in `.read`, and no write scope exists
   * anywhere in this build (spec 9.4). `accounting.journals.read` stays
   * unrequested per spec 9.2.
   */
  read_core_v2: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "accounting.settings.read",
    "accounting.contacts.read",
    "accounting.transactions.read",
    "accounting.reports.read",
    "accounting.attachments.read",
    "accounting.budgets.read",
  ],
};

/**
 * Profiles that must not be assigned to a new app. Kept as data rather than a
 * comment so the check below cannot drift from the list.
 */
export const RETIRED_SCOPE_PROFILES = new Set(["read_core_v1"]);

export function resolveScopes(scopeProfile: string): string[] {
  const scopes = SCOPE_PROFILES[scopeProfile];
  if (!scopes) {
    throw new Error(`Unknown scope profile "${scopeProfile}". Add it to SCOPE_PROFILES first.`);
  }
  if (RETIRED_SCOPE_PROFILES.has(scopeProfile)) {
    // Fails here rather than at Xero's authorize endpoint, where the error is
    // an opaque invalid_scope with no indication of which string is wrong.
    throw new Error(
      `Scope profile "${scopeProfile}" is retired: it lists scopes Xero does not issue, so authorisation cannot succeed. Assign read_core_v2.`
    );
  }
  return scopes;
}
