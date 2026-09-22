/**
 * Stores the Composio Connect consumer key in .env.local, after checking it works.
 *
 * Written as a script rather than an instruction to edit the file by hand for
 * two reasons. The key never has to be pasted anywhere it would be recorded —
 * not into a chat, not into a command line that lands in shell history — and a
 * key that does not work is rejected here rather than becoming a 401 later from
 * somewhere that looks like a bug in the app.
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
const VAR = "COMPOSIO_CONSUMER_KEY";
const MCP_URL = "https://connect.composio.dev/mcp";

/** Reads one line without echoing it, so the key never appears on screen. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
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

type Check = { ok: true; tools: number } | { ok: false; why: string };

/**
 * Composio Connect authenticates consumer keys on x-consumer-api-key against
 * the MCP endpoint. The project REST API uses x-api-key and a different key
 * type entirely; sending a ck_ key there answers "Invalid API key", which reads
 * as a bad key rather than as the wrong door. That cost an hour once.
 */
async function check(key: string): Promise<Check> {
  let res: Response;
  try {
    res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "x-consumer-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, why: "Could not reach Composio: " + detail };
  }

  if (!res.ok) return { ok: false, why: "Composio returned " + res.status + ". Check the key is current." };

  const text = await res.text();
  const frame = text.split(/\r?\n/).filter((l) => l.startsWith("data: ")).pop()?.slice(6);
  if (!frame) return { ok: false, why: "Composio returned no data frame." };

  const reply = JSON.parse(frame) as { result?: { tools?: unknown[] }; error?: { message?: string } };
  if (reply.error) return { ok: false, why: reply.error.message ?? "Composio rejected the key." };
  return { ok: true, tools: reply.result?.tools?.length ?? 0 };
}

function writeKey(key: string): "updated" | "added" {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const already = new RegExp("^\s*" + VAR + "=", "m").test(existing);
  writeFileSync(
    ENV_PATH,
    upsertEnvVar(existing, VAR, key, "Composio Connect holds the client's Xero organisations.")
  );
  return already ? "updated" : "added";
}

async function main() {
  console.log("\nComposio Connect consumer key");
  console.log("Composio -> Connect -> Sessions & API Key (the ck_ one). Input is hidden.\n");

  const key = await promptHidden("Paste the key: ");
  if (!key) {
    console.error("Nothing entered. No change made.");
    process.exit(1);
  }

  process.stdout.write("Checking it with Composio... ");
  const result = await check(key);

  if (!result.ok) {
    console.error("rejected.\n\n" + result.why + "\n");
    console.error(".env.local was not touched.");
    process.exit(1);
  }

  console.log("accepted.");
  const what = writeKey(key);
  console.log("\n" + VAR + " " + what + " in .env.local");
  console.log("Tools exposed to this key: " + result.tools);
  console.log("\nNext: npx tsx scripts/composio-inventory.ts\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
