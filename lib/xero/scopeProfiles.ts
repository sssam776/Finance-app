/**
 * Versioned scope profiles (spec 9.1). Xero apps reference a profile by name
 * rather than a free-form scope string so a scope change is a reviewable,
 * auditable event.
 */

export const SCOPE_PROFILES: Record<string, string[]> = {
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
};

export function resolveScopes(scopeProfile: string): string[] {
  const scopes = SCOPE_PROFILES[scopeProfile];
  if (!scopes) {
    throw new Error(`Unknown scope profile "${scopeProfile}". Add it to SCOPE_PROFILES first.`);
  }
  return scopes;
}
