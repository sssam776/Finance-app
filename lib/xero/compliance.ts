/**
 * Spec 9.6 — production compliance gate, as a runtime check.
 *
 * Pure by design: no database, no `process.env`, no Xero client. Everything it
 * needs is passed in, so the rules can be tested directly and so the single
 * caller (`buildXeroClient`) stays the only place that decides *when* to run
 * them.
 *
 * "The feature flag alone is not sufficient. Database approval records must
 * also pass." — so every condition below is checked independently and the
 * first failure denies. This gate fails closed: an unrecognised state is a
 * denial, never a pass.
 */

export type ComplianceStatus =
  | "draft"
  | "internal_review"
  | "xero_confirmation_required"
  | "approved"
  | "rejected"
  | "retired";

export type XeroEnvironment = "development" | "staging" | "production";

export interface ComplianceCheckInput {
  appKey: string;
  environment: XeroEnvironment;
  complianceStatus: ComplianceStatus;
  enabled: boolean;
  operationalOwner: string | null;
  scopeProfile: string;
  approvalReference: string | null;
}

export interface ComplianceContext {
  /** `XERO_MULTI_APP_ENABLED === "true"` */
  multiAppEnabled: boolean;
  /** Enabled app records with environment='production'. */
  enabledProductionAppCount: number;
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}

/**
 * Returns a human-readable reason the app must not be used, or null if it may
 * be. The message is surfaced to an operator, so it names the field to fix.
 */
export function complianceFailureReason(
  app: ComplianceCheckInput,
  context: ComplianceContext
): string | null {
  if (!app.enabled) {
    return `Xero app "${app.appKey}" is disabled.`;
  }

  // Terminal states are refused everywhere, including development — a rejected
  // or retired registration is not a dev convenience.
  if (app.complianceStatus === "rejected" || app.complianceStatus === "retired") {
    return `Xero app "${app.appKey}" has compliance_status='${app.complianceStatus}' and must not be used in any environment.`;
  }

  if (app.environment !== "production") {
    return null;
  }

  if (app.complianceStatus !== "approved") {
    return `Xero app "${app.appKey}" is production but compliance_status='${app.complianceStatus}' (spec 9.6 requires 'approved').`;
  }
  if (isBlank(app.operationalOwner)) {
    return `Production Xero app "${app.appKey}" has no operational owner recorded (spec 9.6).`;
  }
  if (isBlank(app.scopeProfile)) {
    return `Production Xero app "${app.appKey}" has no approved scope profile recorded (spec 9.6).`;
  }
  if (isBlank(app.approvalReference)) {
    return `Production Xero app "${app.appKey}" has no approval/exemption reference recorded (spec 9.6).`;
  }

  // The flag and the two-app minimum gate *multi-app routing* specifically.
  // A deliberately single-app production deployment is not multi-app routing,
  // so it is not held to them — but the moment a second production app is
  // enabled, the flag must have been turned on consciously.
  if (context.enabledProductionAppCount > 1 && !context.multiAppEnabled) {
    return `${context.enabledProductionAppCount} production Xero apps are enabled but XERO_MULTI_APP_ENABLED is not "true" (spec 9.6).`;
  }
  if (context.multiAppEnabled && context.enabledProductionAppCount < 2) {
    return `XERO_MULTI_APP_ENABLED is "true" but only ${context.enabledProductionAppCount} production app record(s) are enabled (spec 9.6 requires at least two).`;
  }

  return null;
}

/**
 * Spec 7.6.7 — "Capacity is checked before starting OAuth; reaching capacity
 * creates an admin decision, not an automatic spillover."
 *
 * Checked before building the consent URL rather than after the callback, so
 * nobody is sent to Xero, asked to approve access to their accounting data,
 * and only then told there was no room for them.
 *
 * There is deliberately no automatic fallback to another app with spare
 * capacity: spec 7.6.2 forbids the router picking an app because it has room,
 * and spec 3.3 forbids a second same-purpose Starter app as a free-tier
 * workaround. Reaching the ceiling is a commercial decision (Core tier), so
 * the code stops and says so.
 */
export function capacityFailureReason(
  app: Pick<ComplianceCheckInput, "appKey"> & { tier: string; connectionLimit: number },
  activeConnectionCount: number
): string | null {
  if (activeConnectionCount < app.connectionLimit) return null;

  return (
    `Xero app "${app.appKey}" is at capacity: ${activeConnectionCount} of ${app.connectionLimit} ` +
    `connections used on the ${app.tier} tier. Spec 7.6.7 requires an admin decision here, not an ` +
    `automatic spillover to another app. Upgrade the tier or retire an existing connection first.`
  );
}

export class XeroComplianceError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "XeroComplianceError";
  }
}

export class XeroCapacityError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "XeroCapacityError";
  }
}

export function assertCapacityAvailable(
  app: Pick<ComplianceCheckInput, "appKey"> & { tier: string; connectionLimit: number },
  activeConnectionCount: number
): void {
  const reason = capacityFailureReason(app, activeConnectionCount);
  if (reason) throw new XeroCapacityError(reason);
}

export function assertXeroAppUsable(app: ComplianceCheckInput, context: ComplianceContext): void {
  const reason = complianceFailureReason(app, context);
  if (reason) throw new XeroComplianceError(reason);
}
