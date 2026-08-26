import { describe, it, expect } from "vitest";
import {
  complianceFailureReason,
  assertXeroAppUsable,
  capacityFailureReason,
  assertCapacityAvailable,
  XeroComplianceError,
  XeroCapacityError,
  type ComplianceCheckInput,
  type ComplianceContext,
} from "../lib/xero/compliance";

const SINGLE_APP: ComplianceContext = { multiAppEnabled: false, enabledProductionAppCount: 1 };

function app(overrides: Partial<ComplianceCheckInput> = {}): ComplianceCheckInput {
  return {
    appKey: "ramwall_read_core",
    environment: "production",
    complianceStatus: "approved",
    enabled: true,
    operationalOwner: "financial.controller@ramwall.example",
    scopeProfile: "read_core_v1",
    approvalReference: "XERO-APP-2026-001",
    ...overrides,
  };
}

describe("spec 9.6 compliance gate", () => {
  it("allows a fully approved single production app", () => {
    expect(complianceFailureReason(app(), SINGLE_APP)).toBeNull();
  });

  it("blocks a disabled app", () => {
    expect(complianceFailureReason(app({ enabled: false }), SINGLE_APP)).toMatch(/disabled/);
  });

  it("blocks rejected and retired apps in every environment, including development", () => {
    const devContext: ComplianceContext = { multiAppEnabled: false, enabledProductionAppCount: 0 };
    for (const status of ["rejected", "retired"] as const) {
      const reason = complianceFailureReason(
        app({ environment: "development", complianceStatus: status }),
        devContext
      );
      expect(reason).toMatch(new RegExp(status));
    }
  });

  it("allows a draft app in development — that is what development is for", () => {
    const reason = complianceFailureReason(
      app({ environment: "development", complianceStatus: "draft", approvalReference: null, operationalOwner: null }),
      { multiAppEnabled: false, enabledProductionAppCount: 0 }
    );
    expect(reason).toBeNull();
  });

  it("blocks a draft app in production", () => {
    expect(complianceFailureReason(app({ complianceStatus: "draft" }), SINGLE_APP)).toMatch(
      /compliance_status='draft'/
    );
  });

  it("blocks an approved production app missing its owner, scope profile or approval reference", () => {
    expect(complianceFailureReason(app({ operationalOwner: null }), SINGLE_APP)).toMatch(/operational owner/);
    expect(complianceFailureReason(app({ operationalOwner: "   " }), SINGLE_APP)).toMatch(/operational owner/);
    expect(complianceFailureReason(app({ scopeProfile: "" }), SINGLE_APP)).toMatch(/scope profile/);
    expect(complianceFailureReason(app({ approvalReference: null }), SINGLE_APP)).toMatch(/approval/);
  });

  it("blocks a second production app when the multi-app flag is off", () => {
    const reason = complianceFailureReason(app(), {
      multiAppEnabled: false,
      enabledProductionAppCount: 2,
    });
    expect(reason).toMatch(/XERO_MULTI_APP_ENABLED/);
  });

  it("blocks the multi-app flag being on with fewer than two production apps", () => {
    const reason = complianceFailureReason(app(), {
      multiAppEnabled: true,
      enabledProductionAppCount: 1,
    });
    expect(reason).toMatch(/at least two/);
  });

  it("allows two production apps once the flag is on", () => {
    expect(
      complianceFailureReason(app(), { multiAppEnabled: true, enabledProductionAppCount: 2 })
    ).toBeNull();
  });

  it("throws XeroComplianceError from the assert form", () => {
    expect(() => assertXeroAppUsable(app({ enabled: false }), SINGLE_APP)).toThrow(XeroComplianceError);
    expect(() => assertXeroAppUsable(app(), SINGLE_APP)).not.toThrow();
  });
});

describe("spec 7.6.7 connection capacity", () => {
  const starter = { appKey: "ramwall_read_core", tier: "Starter", connectionLimit: 5 };

  it("allows a connection while slots remain", () => {
    expect(capacityFailureReason(starter, 0)).toBeNull();
    expect(capacityFailureReason(starter, 4)).toBeNull();
  });

  it("blocks the sixth connection on a five-slot Starter app", () => {
    const reason = capacityFailureReason(starter, 5);
    expect(reason).toMatch(/at capacity: 5 of 5/);
    expect(reason).toMatch(/Starter/);
  });

  it("blocks rather than wrapping around if the count somehow exceeds the limit", () => {
    expect(capacityFailureReason(starter, 9)).toMatch(/9 of 5/);
  });

  it("scales with the tier's own limit rather than a hard-coded five", () => {
    const core = { appKey: "ramwall_core", tier: "Core", connectionLimit: 50 };
    expect(capacityFailureReason(core, 49)).toBeNull();
    expect(capacityFailureReason(core, 50)).toMatch(/50 of 50/);
  });

  it("refuses to suggest spilling over to another app", () => {
    // Spec 7.6.2: the router must never pick an app because it has spare
    // capacity, so the message must call for a decision, not a fallback.
    const reason = capacityFailureReason(starter, 5) ?? "";
    expect(reason).toMatch(/admin decision/);
    expect(reason).not.toMatch(/another app with|automatically|falling back to/i);
  });

  it("throws XeroCapacityError from the assert form", () => {
    expect(() => assertCapacityAvailable(starter, 5)).toThrow(XeroCapacityError);
    expect(() => assertCapacityAvailable(starter, 4)).not.toThrow();
  });
});
