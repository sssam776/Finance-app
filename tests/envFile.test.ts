import { describe, it, expect } from "vitest";
import { upsertEnvVar } from "../lib/envFile";

const EXISTING = [
  "# Xero",
  "XERO_RAMWALL_READ_CORE_DEV_CLIENT_ID=abc123",
  "XERO_RAMWALL_READ_CORE_DEV_CLIENT_SECRET=shhh",
  "",
  "XERO_TOKEN_ENCRYPTION_KEY_V1=base64key==",
  "",
].join("\n");

describe("upsertEnvVar", () => {
  /** The whole reason this is not a rewrite-from-object: nothing else may move. */
  it("leaves every other line untouched when appending", () => {
    const out = upsertEnvVar(EXISTING, "COMPOSIO_API_KEY", "ck_live");
    for (const line of EXISTING.split("\n").filter((l) => l !== "")) {
      expect(out).toContain(line);
    }
    expect(out).toContain("COMPOSIO_API_KEY=ck_live");
  });

  it("replaces in place rather than appending a second copy", () => {
    const once = upsertEnvVar(EXISTING, "COMPOSIO_API_KEY", "ck_first");
    const twice = upsertEnvVar(once, "COMPOSIO_API_KEY", "ck_second");
    expect(twice.match(/^COMPOSIO_API_KEY=/gm)).toHaveLength(1);
    expect(twice).toContain("COMPOSIO_API_KEY=ck_second");
    expect(twice).not.toContain("ck_first");
  });

  /**
   * .env.example ships the variable commented out as documentation. Treating
   * that as the line to replace would leave the key behind a "#" and unset,
   * which reads as "I set it" and behaves as "I did not".
   */
  it("does not overwrite a commented-out example line", () => {
    const withComment = "# COMPOSIO_API_KEY=your_key_here\nOTHER=1\n";
    const out = upsertEnvVar(withComment, "COMPOSIO_API_KEY", "ck_real");
    expect(out).toContain("# COMPOSIO_API_KEY=your_key_here");
    expect(out).toMatch(/^COMPOSIO_API_KEY=ck_real$/m);
  });

  it("keeps CRLF files on CRLF", () => {
    const crlf = "A=1\r\nB=2\r\n";
    const out = upsertEnvVar(crlf, "COMPOSIO_API_KEY", "ck_x");
    expect(out).not.toMatch(/(?<!\r)\n/);
  });

  it("keeps LF files on LF", () => {
    const out = upsertEnvVar("A=1\nB=2\n", "COMPOSIO_API_KEY", "ck_x");
    expect(out).not.toContain("\r");
  });

  it("handles a file with no trailing newline without joining two lines", () => {
    const out = upsertEnvVar("A=1", "COMPOSIO_API_KEY", "ck_x");
    expect(out).toMatch(/^A=1$/m);
    expect(out).toMatch(/^COMPOSIO_API_KEY=ck_x$/m);
  });

  it("writes into an empty file without a leading blank line", () => {
    expect(upsertEnvVar("", "COMPOSIO_API_KEY", "ck_x")).toBe("COMPOSIO_API_KEY=ck_x\n");
  });

  it("adds the comment only when creating the line", () => {
    const first = upsertEnvVar("A=1\n", "COMPOSIO_API_KEY", "ck_x", "why this exists");
    expect(first).toContain("# why this exists");
    const second = upsertEnvVar(first, "COMPOSIO_API_KEY", "ck_y", "why this exists");
    expect(second.match(/# why this exists/g)).toHaveLength(1);
  });

  /** A variable whose name is a prefix of another must not be confused with it. */
  it("does not match a longer variable that starts with the same name", () => {
    const out = upsertEnvVar("COMPOSIO_API_KEY_OLD=stale\n", "COMPOSIO_API_KEY", "ck_new");
    expect(out).toContain("COMPOSIO_API_KEY_OLD=stale");
    expect(out).toMatch(/^COMPOSIO_API_KEY=ck_new$/m);
  });
});
