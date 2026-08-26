import { describe, it, expect } from "vitest";
import { resolveEntityAccess, canAccessEntity, filterByEntityAccess } from "../lib/entityAccess";

describe("resolveEntityAccess", () => {
  it("gives an ungranted admin every entity", () => {
    // A freshly seeded system has one admin and no grants. That admin must be
    // able to set the system up.
    expect(resolveEntityAccess("admin", []).allowedEntityIds).toBeNull();
  });

  it("gives an ungranted viewer nothing", () => {
    // Nobody has decided what they may see, so the safe answer is nothing.
    expect(resolveEntityAccess("viewer", []).allowedEntityIds).toEqual([]);
  });

  it("scopes an admin the moment they are granted anything", () => {
    const access = resolveEntityAccess("admin", ["e1"]);
    expect(access.allowedEntityIds).toEqual(["e1"]);
    expect(canAccessEntity(access, "e2")).toBe(false);
  });

  it("honours explicit grants for a viewer", () => {
    const access = resolveEntityAccess("viewer", ["e1", "e2"]);
    expect(canAccessEntity(access, "e1")).toBe(true);
    expect(canAccessEntity(access, "e3")).toBe(false);
  });

  it("deduplicates repeated grants", () => {
    expect(resolveEntityAccess("viewer", ["e1", "e1", "e2"]).allowedEntityIds).toEqual(["e1", "e2"]);
  });
});

describe("canAccessEntity", () => {
  it("allows everything for unrestricted access", () => {
    const access = resolveEntityAccess("admin", []);
    expect(canAccessEntity(access, "anything-at-all")).toBe(true);
  });

  it("denies everything for an empty grant list", () => {
    const access = resolveEntityAccess("viewer", []);
    expect(canAccessEntity(access, "e1")).toBe(false);
  });

  it("does not treat an empty list as unrestricted", () => {
    // The bug this guards: `if (!ids.length) return true` would hand a
    // brand-new viewer the entire group's bank balances.
    const empty = resolveEntityAccess("viewer", []);
    const unrestricted = resolveEntityAccess("admin", []);
    expect(canAccessEntity(empty, "e1")).toBe(false);
    expect(canAccessEntity(unrestricted, "e1")).toBe(true);
  });
});

describe("filterByEntityAccess", () => {
  const rows = [
    { entityId: "e1", label: "one" },
    { entityId: "e2", label: "two" },
    { entityId: "e3", label: "three" },
  ];

  it("passes everything through for unrestricted access", () => {
    expect(filterByEntityAccess(resolveEntityAccess("admin", []), rows)).toHaveLength(3);
  });

  it("keeps only granted rows", () => {
    const filtered = filterByEntityAccess(resolveEntityAccess("viewer", ["e1", "e3"]), rows);
    expect(filtered.map((r) => r.label)).toEqual(["one", "three"]);
  });

  it("returns nothing for a viewer with no grants", () => {
    expect(filterByEntityAccess(resolveEntityAccess("viewer", []), rows)).toEqual([]);
  });

  it("ignores grants for entities that are not in the rows", () => {
    const filtered = filterByEntityAccess(resolveEntityAccess("viewer", ["e1", "does-not-exist"]), rows);
    expect(filtered.map((r) => r.label)).toEqual(["one"]);
  });
});
