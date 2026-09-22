import { describe, it, expect, afterEach } from "vitest";
import { extractLastJsonObject, codexStatus } from "../lib/ai/codex";

/**
 * A real `codex exec --output-schema` transcript, trimmed. The answer appears
 * twice — once inside the transcript and once as the final message — and the
 * banner above it contains prose, a session id and a token count.
 */
const REAL_TRANSCRIPT = [
  "OpenAI Codex v0.153.4",
  "--------",
  "workdir: C:\dev\Finance-app",
  "model: gpt-5.6-sol",
  "sandbox: read-only",
  "session id: 01a0cb43-3819-7c73-8228-2f3c909169de",
  "--------",
  "user",
  "Repairs & Maintenance was 12,400 against a budget of 4,000.",
  "codex",
  '{"commentary":"Repairs & Maintenance was $8,400 adverse to budget.","drivers":["Roof repair: $6,900"]}',
  "tokens used",
  "16,613",
  '{"commentary":"Repairs & Maintenance was $8,400 adverse to budget.","drivers":["Roof repair: $6,900"]}',
  "",
].join("\n");

describe("extractLastJsonObject", () => {
  it("reads the final message out of a real transcript", () => {
    const result = extractLastJsonObject(REAL_TRANSCRIPT) as {
      commentary: string;
      drivers: string[];
    };
    expect(result.commentary).toMatch(/8,400 adverse/);
    expect(result.drivers).toEqual(["Roof repair: $6,900"]);
  });

  /**
   * The transcript echoes the prompt, and a prompt carrying account names can
   * contain braces. Taking the first match would return the echo rather than
   * the answer.
   */
  it("takes the last object, not the first", () => {
    const out = ['{"commentary":"echoed prompt","drivers":[]}', '{"commentary":"the answer","drivers":[]}'].join(
      "\n"
    );
    expect((extractLastJsonObject(out) as { commentary: string }).commentary).toBe("the answer");
  });

  it("walks past prose that only looks like an object", () => {
    const out = ["{ this is not json }", '{"commentary":"real","drivers":[]}', "{ nor is this }"].join("\n");
    expect((extractLastJsonObject(out) as { commentary: string }).commentary).toBe("real");
  });

  it("survives CRLF output", () => {
    expect(extractLastJsonObject(REAL_TRANSCRIPT.replace(/\n/g, "\r\n"))).toBeTruthy();
  });

  /**
   * A signed-out CLI prints a sign-in notice and exits without JSON. The error
   * has to name the fix, because this is the failure an operator will actually
   * hit after their session expires.
   */
  it("explains how to recover when nothing parseable came back", () => {
    expect(() => extractLastJsonObject("Not signed in.\nRun codex login.")).toThrow(/codex login/);
  });

  it("rejects empty output rather than returning undefined", () => {
    expect(() => extractLastJsonObject("")).toThrow();
  });
});

describe("codexStatus", () => {
  const original = process.env.AI_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = original;
  });

  /** Drafting reaches an external model, so it is opt-in rather than opt-out. */
  it("is off unless switched on explicitly", () => {
    delete process.env.AI_PROVIDER;
    const status = codexStatus();
    expect(status.available).toBe(false);
    if (!status.available) expect(status.reason).toMatch(/AI_PROVIDER=codex/);
  });

  it("stays off for any other provider value", () => {
    process.env.AI_PROVIDER = "openai";
    expect(codexStatus().available).toBe(false);
  });

  it("is available once switched on", () => {
    process.env.AI_PROVIDER = "codex";
    expect(codexStatus().available).toBe(true);
  });
});
