import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SCOPE_PROFILES } from "../lib/xero/scopeProfiles";

/**
 * Structural guards. These assert properties of the codebase itself rather
 * than the behaviour of any one function, so that a rule the whole build
 * depends on cannot be undone by a small diff in an unrelated file.
 */

const REPO_ROOT = path.join(__dirname, "..");

describe("no write scope can be added quietly", () => {
  /**
   * Scopes that legitimately carry no .read suffix. Everything else must be
   * read-only: spec 9.4 makes "no write scopes anywhere in this build" a hard
   * rule, and a write scope is a two-character diff away from a read one.
   */
  const NON_ACCOUNTING_SCOPES = new Set(["openid", "profile", "email", "offline_access"]);

  /** Pure, so the detector can be tested against a known-bad profile. */
  function findWriteScopes(profiles: Record<string, string[]>): string[] {
    const offenders: string[] = [];
    for (const [profile, scopes] of Object.entries(profiles)) {
      for (const scope of scopes) {
        if (NON_ACCOUNTING_SCOPES.has(scope)) continue;
        if (!scope.endsWith(".read")) offenders.push(`${profile}: ${scope}`);
      }
    }
    return offenders;
  }

  it("catches a write scope when one is present", () => {
    // Proves the guard below can actually fail. A guard that cannot fail
    // provides no protection, and this one exists precisely because a write
    // scope is a two-character diff from a read one.
    expect(
      findWriteScopes({ bad: ["openid", "accounting.transactions.read", "accounting.transactions"] })
    ).toEqual(["bad: accounting.transactions"]);
  });

  it("does not flag the four scopes that legitimately lack a .read suffix", () => {
    expect(findWriteScopes({ ok: ["openid", "profile", "email", "offline_access"] })).toEqual([]);
  });

  it("every scope in every real profile is read-only", () => {
    // If this fails, someone has added write access to a build that is
    // documented as read-only. That is a governance decision, not a code
    // change: see spec 9.4 and 9.5.
    expect(findWriteScopes(SCOPE_PROFILES)).toEqual([]);
  });

  it("no profile requests payroll or file write access", () => {
    const all = Object.values(SCOPE_PROFILES).flat();
    expect(all.filter((s) => s.startsWith("payroll.") && !s.endsWith(".read"))).toEqual([]);
    expect(all.filter((s) => s.startsWith("files.") && !s.endsWith(".read"))).toEqual([]);
  });
});

describe("buildXeroClient stays the only route to Xero", () => {
  function sourceFiles(dir: string): string[] {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) return [];

    const found: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        found.push(...sourceFiles(path.join(dir, entry.name)));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        found.push(full);
      }
    }
    return found;
  }

  it("only lib/xero constructs a XeroClient", () => {
    // The spec 9.6 compliance gate and the 7.6.7 capacity check both live in
    // buildXeroClient. A XeroClient built anywhere else bypasses both.
    const offenders: string[] = [];

    for (const dir of ["app", "lib", "db", "scripts"]) {
      for (const file of sourceFiles(dir)) {
        const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
        if (relative.startsWith("lib/xero/")) continue;

        const source = fs.readFileSync(file, "utf8");
        if (/new\s+XeroClient\s*\(/.test(source)) offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the compliance gate is actually called by buildXeroClient", () => {
    // A guard that only checks callers is worthless if the gate itself is
    // removed from the one function they all go through.
    const registry = fs.readFileSync(path.join(REPO_ROOT, "lib/xero/appRegistry.ts"), "utf8");
    expect(registry).toMatch(/assertXeroAppUsable\s*\(/);
  });
});

describe("actor identity is never taken from the request body", () => {
  /**
   * Before authentication existed, routes accepted importedByEmail,
   * initiatingUserEmail and createdBy from the caller, so audit_events
   * recorded whatever the caller chose to send. Nothing may reintroduce that.
   */
  const CLIENT_SUPPLIED_ACTOR =
    /(body|form)\s*[.[]?\s*(get\s*\(\s*)?["']?\w*(importedBy|initiatingUser|createdBy|actorEmail)\w*/i;

  it("catches a client-supplied actor when one is present", () => {
    // Proves the pattern below can fail, against the exact shapes this
    // codebase actually used before the auth layer landed.
    expect(CLIENT_SUPPLIED_ACTOR.test('const who = form.get("importedByEmail")')).toBe(true);
    expect(CLIENT_SUPPLIED_ACTOR.test("const who = body.createdBy")).toBe(true);
    expect(CLIENT_SUPPLIED_ACTOR.test('body["actorEmail"]')).toBe(true);
  });

  it("does not flag reading identity from the session", () => {
    expect(CLIENT_SUPPLIED_ACTOR.test("const importedByEmail = actor.email;")).toBe(false);
    expect(CLIENT_SUPPLIED_ACTOR.test("actorEmail: actor.email,")).toBe(false);
  });

  it("no route reads an actor email from a body or form field", () => {
    const offenders: string[] = [];

    function walk(dir: string) {
      const abs = path.join(REPO_ROOT, dir);
      if (!fs.existsSync(abs)) return;

      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(rel);
          continue;
        }
        if (!/\.ts$/.test(entry.name)) continue;

        const source = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
        if (CLIENT_SUPPLIED_ACTOR.test(source)) offenders.push(rel.replace(/\\/g, "/"));
      }
    }

    walk("app/api");
    expect(offenders).toEqual([]);
  });
});
