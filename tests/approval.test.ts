import { describe, it, expect } from "vitest";
import {
  segregationFailureReason,
  assertApprover,
  ApprovalError,
  resolveEffectiveVersion,
  type EffectiveDated,
} from "../lib/approval";

describe("segregation of duties", () => {
  it("allows a different person to approve", () => {
    expect(segregationFailureReason("preparer@ramwall.local", "reviewer@ramwall.local")).toBeNull();
  });

  it("refuses self-approval", () => {
    // An approval a preparer granted themselves records a review that never
    // happened, which is worse than no approval step at all.
    expect(segregationFailureReason("same@ramwall.local", "same@ramwall.local")).toMatch(
      /different person/
    );
  });

  it("refuses self-approval across case and whitespace differences", () => {
    // The same person with a differently-cased address is the same person.
    expect(segregationFailureReason("Same@Ramwall.local", " same@ramwall.local ")).toMatch(
      /different person/
    );
  });

  it("requires an approver at all", () => {
    expect(segregationFailureReason("preparer@ramwall.local", "")).toMatch(/approver is required/);
    expect(segregationFailureReason("preparer@ramwall.local", "   ")).toMatch(
      /approver is required/
    );
  });

  it("allows approval when nothing was prepared by a named person", () => {
    // No preparer means there is nobody to be different from. A module that
    // requires a preparer enforces that separately.
    expect(segregationFailureReason(null, "reviewer@ramwall.local")).toBeNull();
    expect(segregationFailureReason("", "reviewer@ramwall.local")).toBeNull();
  });

  it("can be relaxed deliberately, but never by accident", () => {
    expect(
      segregationFailureReason("same@ramwall.local", "same@ramwall.local", {
        requireDifferentApprover: false,
      })
    ).toBeNull();
    // Omitting the option keeps the rule on.
    expect(segregationFailureReason("same@ramwall.local", "same@ramwall.local", {})).not.toBeNull();
  });

  it("throws from the assert form", () => {
    expect(() => assertApprover("a@x.local", "a@x.local")).toThrow(ApprovalError);
    expect(() => assertApprover("a@x.local", "b@x.local")).not.toThrow();
  });
});

describe("resolveEffectiveVersion", () => {
  const v1: EffectiveDated & { label: string } = {
    label: "v1",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-06-30",
    status: "approved",
  };
  const v2: EffectiveDated & { label: string } = {
    label: "v2",
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    status: "approved",
  };

  it("picks the version whose window contains the date", () => {
    expect(resolveEffectiveVersion([v1, v2], "2026-03-15").row?.label).toBe("v1");
    expect(resolveEffectiveVersion([v1, v2], "2026-09-15").row?.label).toBe("v2");
  });

  it("treats both ends of the window as inclusive", () => {
    expect(resolveEffectiveVersion([v1, v2], "2026-01-01").row?.label).toBe("v1");
    expect(resolveEffectiveVersion([v1, v2], "2026-06-30").row?.label).toBe("v1");
    expect(resolveEffectiveVersion([v1, v2], "2026-07-01").row?.label).toBe("v2");
  });

  it("treats a null end as open-ended", () => {
    expect(resolveEffectiveVersion([v2], "2099-01-01").row?.label).toBe("v2");
  });

  it("returns nothing with a reason when no version applies", () => {
    const result = resolveEffectiveVersion([v1, v2], "2025-12-31");
    expect(result.row).toBeNull();
    expect(result.reason).toMatch(/No approved version/);
  });

  it("fails closed when two versions overlap", () => {
    // Picking either one silently means the same inputs can produce two
    // different board packs. resolveXeroRoute takes the same position.
    const overlapping = { ...v2, effectiveFrom: "2026-01-01", label: "v2-overlap" };
    const result = resolveEffectiveVersion([v1, overlapping], "2026-03-15");
    expect(result.row).toBeNull();
    expect(result.reason).toMatch(/2 versions are in effect/);
  });

  it("ignores versions that are not approved", () => {
    const draft = { ...v1, status: "draft", label: "draft" };
    const result = resolveEffectiveVersion([draft], "2026-03-15");
    expect(result.row).toBeNull();
    expect(result.reason).toMatch(/No approved version/);
  });

  it("does not let a draft create a false overlap", () => {
    // A draft sitting alongside the approved version must not block it.
    const draft = { ...v1, status: "draft", label: "draft" };
    expect(resolveEffectiveVersion([v1, draft], "2026-03-15").row?.label).toBe("v1");
  });

  it("accepts rows carrying no status when approval is not being tracked", () => {
    const noStatus = { effectiveFrom: "2026-01-01", effectiveTo: null, label: "x" };
    expect(resolveEffectiveVersion([noStatus], "2026-03-15").row?.label).toBe("x");
  });

  it("can consider unapproved rows when explicitly asked", () => {
    const draft = { ...v1, status: "draft", label: "draft" };
    expect(
      resolveEffectiveVersion([draft], "2026-03-15", { requireApproved: false }).row?.label
    ).toBe("draft");
  });

  it("returns nothing for an empty list rather than throwing", () => {
    expect(resolveEffectiveVersion([], "2026-03-15").row).toBeNull();
  });
});
