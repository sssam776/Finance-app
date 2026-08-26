/**
 * Versioned scope profiles (spec 9.1). Xero apps reference a profile by name
 * rather than a free-form scope string so a scope change is a reviewable,
 * auditable event.
 */

export const SCOPE_PROFILES: Record<string, string[]> = {
  /**
   * Spec 9.2's list, transcribed verbatim. RETAINED, NOT USED.
   *
   * This profile was retired on the grounds that per-endpoint scopes such as
   * `accounting.invoices.read` and `accounting.reports.banksummary.read` were
   * not strings Xero issued. That was true of the broad-scope model and is no
   * longer true: Xero's granular scopes, mandatory for apps created from
   * 2 March 2026, are exactly this shape. Probing the authorize endpoint
   * confirms every per-report string here now authorises.
   *
   * It stays retired anyway, because three of its entries
   * (`accounting.creditnotes.read`, `accounting.journals.read`,
   * `accounting.reports.aged.read` is fine but unused) do not all resolve, and
   * because it requests far more than this build reads. read_core_v3 is the
   * corrected list.
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
   * The broad-scope model. RETAINED, NOT USED.
   *
   * `accounting.transactions.read` and `accounting.reports.read` were the
   * correct wide grants until Xero split them into granular scopes. An app
   * created on or after 2 March 2026 has access to the granular scopes only,
   * and rejects both of these with `invalid_scope` — which is a failure at
   * the consent screen, before any code runs, naming no particular string.
   *
   * Existing apps may keep using these until 13 September 2027. Nothing here
   * is assigned to this profile, so it is retired rather than maintained.
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

  /**
   * Granular scopes, and only the four the build actually calls.
   *
   * The application makes exactly four Xero requests — `getAccounts`,
   * `getReportBankSummary`, `getReportProfitAndLoss` and
   * `getReportTrialBalance` — so it asks for exactly four grants. Contacts,
   * attachments, budgets and the transaction family are not requested because
   * nothing reads them; the consent screen a client approves should describe
   * what the software does, not what it might do later. Adding a scope when a
   * feature needs it is a reviewable change. Holding one in advance is not.
   *
   * Every string was verified against Xero's authorize endpoint rather than
   * against documentation, on both registered client IDs.
   *
   * Still read-only: every accounting scope ends in `.read`, and no write
   * scope exists anywhere in this build (spec 9.4).
   */
  read_core_v3: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "accounting.settings.read",
    "accounting.reports.banksummary.read",
    "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read",
  ],
};

/**
 * Profiles that must not be assigned to a new app. Kept as data rather than a
 * comment so the check below cannot drift from the list.
 */
export const RETIRED_SCOPE_PROFILES = new Set(["read_core_v1", "read_core_v2"]);

export function resolveScopes(scopeProfile: string): string[] {
  const scopes = SCOPE_PROFILES[scopeProfile];
  if (!scopes) {
    throw new Error(`Unknown scope profile "${scopeProfile}". Add it to SCOPE_PROFILES first.`);
  }
  if (RETIRED_SCOPE_PROFILES.has(scopeProfile)) {
    // Fails here rather than at Xero's authorize endpoint, where the error is
    // an opaque invalid_scope with no indication of which string is wrong.
    throw new Error(
      `Scope profile "${scopeProfile}" is retired: it requests scopes an app created from 2 March 2026 cannot be granted, so authorisation fails at the consent screen. Assign read_core_v3.`
    );
  }
  return scopes;
}
