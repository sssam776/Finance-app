/**
 * Client for Composio Connect's MCP endpoint.
 *
 * The client's Xero organisations are connected through Composio rather than
 * through this app's own OAuth, so their tokens never reach us. What reaches us
 * is one consumer key, and Composio injects the Xero credentials on its side.
 *
 * Two things about this transport are worth knowing before reading the code.
 * It speaks JSON-RPC but answers as an SSE stream, so a reply arrives as a
 * "data:" line rather than as the response body. And the useful payload is
 * JSON encoded inside a text content block, so every call unwraps twice.
 */

const MCP_URL = "https://connect.composio.dev/mcp";

/** Composio's own calls to Xero can be slow; this is well past the app's own patience. */
const TIMEOUT_MS = 120_000;

export type McpStatus = { available: true; key: string } | { available: false; reason: string };

export function mcpStatus(): McpStatus {
  const key = process.env.COMPOSIO_CONSUMER_KEY?.trim();
  if (!key) {
    return {
      available: false,
      reason: "COMPOSIO_CONSUMER_KEY is not set. Run: npx tsx scripts/set-composio-key.ts",
    };
  }
  return { available: true, key };
}

/**
 * Composio answers as Server-Sent Events even for a single reply. Each frame is
 * a "data: " line; the last one carries the result.
 */
export function parseSseJson(body: string): unknown {
  const frames = body
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6));
  if (frames.length === 0) {
    throw new Error(`Composio returned no data frame. Body began: ${body.slice(0, 200)}`);
  }
  return JSON.parse(frames[frames.length - 1]!);
}

interface JsonRpcReply {
  result?: { content?: { type: string; text?: string }[] };
  error?: { message?: string };
}

/**
 * Calls one MCP tool and returns the decoded payload.
 *
 * Errors are raised rather than returned because every caller here needs the
 * data: a half-populated dashboard that silently dropped one entity is the
 * failure this whole integration exists to avoid.
 */
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const status = mcpStatus();
  if (!status.available) throw new Error(status.reason);

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      // Composio Connect authenticates consumers on this header, not x-api-key.
      // The project REST API uses the other one, and the two key types are not
      // interchangeable.
      "x-consumer-api-key": status.key,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Composio MCP returned ${res.status}`);

  const reply = parseSseJson(await res.text()) as JsonRpcReply;
  if (reply.error) throw new Error(`Composio MCP error: ${reply.error.message ?? "unknown"}`);

  const blocks = (reply.result?.content ?? []).map((c) => c.text ?? "").filter(Boolean);
  if (blocks.length === 0) throw new Error("Composio MCP returned an empty content block.");

  // Small replies arrive as one JSON block. Larger ones are split across
  // several, and each is valid JSON on its own while their concatenation is
  // not — so parse the join first, then fall back to the blocks individually
  // rather than failing on a response that did arrive intact.
  const joined = blocks.join("");
  try {
    return JSON.parse(joined);
  } catch {
    const parsed = blocks.flatMap((b) => {
      try {
        return [JSON.parse(b)];
      } catch {
        return [];
      }
    });
    if (parsed.length === 1) return parsed[0];
    if (parsed.length > 1) return parsed;
    // Not JSON at all. Hand back the text so the caller can report what came
    // back instead of a parser error that hides it.
    return { raw: joined };
  }
}

export interface XeroAccount {
  id: string;
  alias?: string;
  status: string;
  is_default?: boolean;
}

/**
 * The connected Xero accounts, as Composio knows them.
 *
 * `alias` is what a person named the connection; `id` is Composio's generated
 * handle. Either is accepted as the `account` argument, and the alias is the
 * one worth showing.
 */
export async function listXeroAccounts(): Promise<XeroAccount[]> {
  const payload = (await callTool("COMPOSIO_MANAGE_CONNECTIONS", {
    toolkits: ["xero"],
    // Never true. True forces reconnection and replaces working connections
    // with fresh auth-link flows, which would take the client's live
    // organisations offline until somebody re-authorised each one by hand.
    reinitiate_all: false,
  })) as { data?: { results?: { xero?: { accounts?: XeroAccount[] } } } };

  return payload.data?.results?.xero?.accounts ?? [];
}

/** Accounts that can actually be queried. An "initiated" connection was never finished. */
export function activeAccounts(accounts: XeroAccount[]): XeroAccount[] {
  return accounts.filter((a) => a.status === "active");
}

/** What to pass as the `account` argument: the alias when there is one, else the id. */
export function accountHandle(account: XeroAccount): string {
  return account.alias ?? account.id;
}

export interface XeroToolCall {
  tool_slug: string;
  arguments: Record<string, unknown>;
  /**
   * Which connected account to run against, as a sibling of tool_slug rather
   * than inside arguments. Nested it is silently ignored and the router answers
   * "Multiple xero accounts connected" instead, which reads like a missing
   * argument rather than a misplaced one.
   */
  account?: string;
}

export interface XeroToolResult {
  index: number;
  tool_slug: string;
  error?: string;
  data?: unknown;
}

/**
 * Runs several Xero tools in one round trip.
 *
 * Every call must carry both `account` and, where the tool accepts one,
 * `tenant_id`. Composio selects the connection from `account`; Xero selects the
 * organisation from `tenant_id`, and omitting it silently falls back to
 * whichever tenant happens to be first. In a group of eight legal entities that
 * does not fail — it returns one entity's figures under another's name.
 */
export async function executeXero(calls: XeroToolCall[], thought: string): Promise<XeroToolResult[]> {
  const payload = (await callTool("COMPOSIO_MULTI_EXECUTE_TOOL", {
    thought,
    tools: calls,
  })) as { data?: { results?: XeroToolResult[] } };
  return payload.data?.results ?? [];
}
