import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Model access through the operator's own Codex CLI session.
 *
 * Ramwall Finance Control is a single-operator tool: one controller, running it
 * on their own machine, already signed in to Codex. It can borrow that session
 * rather than carry an API key, so there is no key to store, rotate or leak and
 * no per-token billing — usage counts against the subscription that is already
 * paid for.
 *
 * That is also the limit of it. This path needs the CLI installed and signed in
 * as the person sitting at the machine, so it stops working the moment the app
 * is deployed somewhere shared. That is the correct failure: a server answering
 * several people through one person's personal subscription is a different
 * arrangement from the one this borrows, and it should have to be built
 * deliberately rather than inherited by accident.
 *
 * Off unless AI_PROVIDER=codex. Drafting is never on by default.
 */

/** Long enough for a report-sized prompt, short enough that a hung CLI cannot hold a request open. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** A runaway process must not be able to exhaust memory through stdout. */
const MAX_OUTPUT_BYTES = 2_000_000;

/** npm installs a .cmd shim on Windows; spawn without a shell will not find the bare name. */
const CODEX_BIN = process.platform === "win32" ? "codex.cmd" : "codex";

export type CodexStatus = { available: true } | { available: false; reason: string };

export function codexStatus(): CodexStatus {
  if (process.env.AI_PROVIDER !== "codex") {
    return {
      available: false,
      reason: "Drafting is off. Set AI_PROVIDER=codex in .env.local and sign in with `codex login`.",
    };
  }
  return { available: true };
}

/**
 * Codex prints a readable transcript and then repeats the final message, so the
 * answer appears twice when an output schema is set. The last parseable object
 * is the one to trust: anything earlier may be the transcript's copy, and the
 * transcript itself can contain braces that are prose rather than JSON.
 */
export function extractLastJsonObject(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Prose that merely looks like an object. Keep walking backwards.
    }
  }
  throw new Error(
    "Codex returned no JSON object. Check the CLI is signed in by running `codex login`."
  );
}

function run(prompt: string, schemaPath: string, workRoot: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CODEX_BIN,
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        // The operator's personal Codex configuration and rules are not this
        // app's to inherit; a model-selection or hook setting made for their
        // own work should not silently change what the finance tool does.
        "--ignore-user-config",
        "--ignore-rules",
        "-s",
        "read-only",
        "-C",
        workRoot,
        "--output-schema",
        schemaPath,
        // Prompt arrives on stdin, never as argv: it carries account names and
        // invoice descriptions of arbitrary length and content.
        "-",
      ],
      { cwd: workRoot, shell: false, windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`Codex did not answer within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    const finish = (err: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value!);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("Codex produced more output than a commentary draft should need."));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, 4000);
    });

    child.on("error", (err) =>
      finish(
        new Error(
          `Could not start the Codex CLI (${err.message}). Install it with \`npm i -g @openai/codex\`.`
        )
      )
    );

    child.on("close", (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(`Codex exited with code ${code}. ${stderr.trim()}`.trim()));
    });

    child.stdin.end(prompt);
  });
}

/**
 * Runs one prompt and returns the object matching `schema`.
 *
 * The working root is an empty temporary directory. Account names and invoice
 * descriptions in the prompt were typed by outside parties and reach here
 * through Xero, and Codex executes model-generated shell commands without
 * asking. Read-only sandboxing already limits that to reads; pointing it at an
 * empty directory means there is nothing there worth reading.
 */
export async function draftJson(
  prompt: string,
  schema: object,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const status = codexStatus();
  if (!status.available) throw new Error(status.reason);

  const workRoot = mkdtempSync(join(tmpdir(), "ramwall-ai-"));
  const schemaPath = join(workRoot, "schema.json");
  writeFileSync(schemaPath, JSON.stringify(schema));

  try {
    return extractLastJsonObject(await run(prompt, schemaPath, workRoot, timeoutMs));
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}
