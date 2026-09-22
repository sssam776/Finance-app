/**
 * Stores a Composio API key in .env.local, after checking it actually works.
 *
 * Written as a script rather than an instruction to edit the file by hand for
 * two reasons. The key never has to be pasted anywhere it would be recorded —
 * not into a chat, not into a command line that lands in shell history — and a
 * key that does not work is rejected here rather than becoming a 401 later from
 * somewhere that looks like a bug in the app.
 *
 * It also reports how many Xero organisations the key can see, which is the
 * thing actually worth knowing: a valid key pointed at the wrong Composio
 * project authenticates perfectly and returns nothing.
 *
 * .env.local is gitignored. Nothing here is ever committed.
 *
 * Run with:
 *   npx tsx scripts/set-composio-key.ts
 */
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { upsertEnvVar } from "../lib/envFile";

const ENV_PATH = join(process.cwd(), ".env.local");
const VAR = "COMPOSIO_API_KEY";
const BASE = "https://backend.composio.dev";

/** Reads one line without echoing it, so the key never appears on screen. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // readline writes each keystroke back to the terminal. Suppressing that is
    // the whole point: a key echoed into a scrollback buffer is a key on screen
    // for everyone behind you and in every screen recording afterwards.
    const target = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = target._writeToOutput.bind(rl);
    target._writeToOutput = (s: string) => {
      if (s.includes(question)) original(s);
    };
    process.stdout.write(question);
    rl.question("", (answer) => {
      process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function check(key: string): Promise<{ ok: true; xeroConnections: number } | { ok: false; why: string }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v3/connected_accounts?toolkit_slugs=xero&limit=50`, {
      headers: { "x-api-key": key },
    });
  } catch (err) {
    return { ok: false, why: `Could not reach Composio: ${err instanceof Error ? err.message : err}` };
  }

  if (res.status === 401) {
    // Composio echoes the key back masked, which is a useful check that what
    // arrived is what was typed. Shown as-is; it is already redacted.
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, why: body?.error?.message ?? "Composio rejected the key." };
  }
  if (!res.ok) {
    return { ok: false, why: `Composio returned ${res.status}.` };
  }

  const body = (await res.json()) as { items?: unknown[]; data?: unknown[] };
  const items = body.items ?? body.data ?? [];
  return { ok: true, xeroConnections: Array.isArray(items) ? items.length : 0 };
}

function writeKey(key: string): "updated" | "added" {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const already = /^s*COMPOSIO_API_KEY=/m.test(existing);
  writeFileSync(
    ENV_PATH,
    upsertEnvVar(existing, VAR, key, "Composio holds the Xero connections for every entity.")
  );
  return already ? "updated" : "added";
}

async function main() {
  console.log("\nComposio API key");
  console.log("Dashboard -> Settings -> API Keys. Input is hidden.\n");

  const key = await promptHidden("Paste the key: ");
  if (!key) {
    console.error("Nothing entered. No change made.");
    process.exit(1);
  }

  process.stdout.write("Checking it with Composio... ");
  const result = await check(key);

  if (!result.ok) {
    console.error(`rejected.\n\n${result.why}\n`);
    console.error(".env.local was not touched.");
    process.exit(1);
  }

  console.log("accepted.");
  const what = writeKey(key);
  console.log(`\n${VAR} ${what} in .env.local`);
  console.log(`Xero organisations visible to this key: ${result.xeroConnections}`);

  if (result.xeroConnections === 0) {
    // Authenticating and seeing nothing is the quiet failure worth naming: the
    // key is fine, it just belongs to a project with no Xero connections in it.
    console.log("\nThe key works but this project has no Xero connections.");
    console.log("Check you copied it from the same Composio project the organisations are connected in.");
  }

  console.log("\nRestart the dev server to pick it up.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
