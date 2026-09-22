/**
 * Prints every Xero organisation reachable through Composio.
 *
 * Run before wiring entities to connections, and again whenever the client adds
 * or removes one. Two numbers matter and they are not the same: how many
 * Composio connections exist, and how many Xero organisations those connections
 * can actually see. A single connection can carry several organisations, and a
 * connection left half-authorised carries none while still looking present.
 *
 * Read-only. It lists and reads; it never creates or replaces a connection.
 *
 * Run with:
 *   COMPOSIO_CONSUMER_KEY=ck_... npx tsx scripts/composio-inventory.ts
 */
import {
  listXeroAccounts,
  activeAccounts,
  accountHandle,
  executeXero,
  mcpStatus,
  type XeroAccount,
} from "../lib/xero/composioMcp";

interface Tenant {
  tenantId?: string;
  tenant_id?: string;
  tenantName?: string;
  tenant_name?: string;
}

function tenantsFrom(result: unknown): Tenant[] {
  // results[].response.data.connections — one level deeper than the wrapper the
  // multi-executor uses for its own bookkeeping, and named "response" rather
  // than "data" at the top, which is easy to read past.
  const r = result as { response?: { data?: { connections?: Tenant[] } } } | null;
  return r?.response?.data?.connections ?? [];
}

async function main() {
  const status = mcpStatus();
  if (!status.available) {
    console.error(status.reason);
    process.exit(1);
  }

  const named = process.argv.slice(2);
  const accounts = named.length
    ? named.map((id) => ({ id, status: "active" }) as XeroAccount)
    : await listXeroAccounts();
  const usable = named.length ? accounts : activeAccounts(accounts);

  if (!named.length) {
    // COMPOSIO_MANAGE_CONNECTIONS is the only listing tool available, and it
    // creates a pending connection stub as a side effect of being called. Pass
    // account handles as arguments to skip it once they are known.
    console.log("Discovering accounts (this leaves a pending connection stub in Composio).");
  }

  console.log(`\nComposio Xero connections: ${accounts.length} (${usable.length} active)\n`);
  for (const a of accounts) {
    const mark = a.status === "active" ? " " : "!";
    console.log(`${mark} ${accountHandle(a)}  [${a.status}]${a.is_default ? "  (default)" : ""}`);
  }

  const stalled = accounts.filter((a: XeroAccount) => a.status !== "active");
  if (stalled.length) {
    console.log(
      `\n${stalled.length} connection(s) never finished authorising and can return no data.`
    );
  }

  if (usable.length === 0) {
    console.log("\nNothing to query.");
    return;
  }

  console.log("\nReading organisations from each active connection...\n");
  const results = await executeXero(
    usable.map((a) => ({ tool_slug: "XERO_GET_CONNECTIONS", account: accountHandle(a), arguments: {} })),
    "Enumerate Xero organisations per connected account."
  );

  let total = 0;
  for (const r of results) {
    const handle = accountHandle(usable[r.index]!);
    if (r.error) {
      console.log(`[${handle}] failed: ${String(r.error).slice(0, 160)}`);
      continue;
    }
    const tenants = tenantsFrom(r);
    console.log(`[${handle}] ${tenants.length} organisation(s)`);
    for (const t of tenants) {
      total += 1;
      console.log(`    ${t.tenantName ?? t.tenant_name ?? "(unnamed)"}`);
      console.log(`      tenant_id: ${t.tenantId ?? t.tenant_id ?? "(none)"}`);
    }
  }

  console.log(`\nTotal Xero organisations reachable: ${total}`);
  // The number to check against the entity register. Eight entities with seven
  // organisations reachable means one entity's figures would silently be absent
  // from every consolidated total rather than reported as missing.
  console.log("Compare this against the entities the app expects to report on.\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
