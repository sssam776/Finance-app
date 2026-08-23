import { describe, it, expect } from "vitest";
import {
  complianceFailureReason,
  assertXeroAppUsable,
  XeroComplianceError,
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
