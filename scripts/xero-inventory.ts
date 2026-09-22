/**
 * Every Xero organisation the client can reach, across both routes.
 *
 * The group's organisations are authorised two ways. Some went directly into
 * Composio; the rest went into Nango, which Composio exposes as a toolkit.
 * Neither route knows about the other, and each reports only its own, so a
 * dashboard built on one silently omits the organisations held by the other —
 * and an omitted entity reads as a smaller group, not as missing data.
 *
 * Deduplicated by tenantId, because one route can hold several authorisations
 * of the same Xero user, each reporting the same organisations. Counting rows
 * instead of distinct tenants turns nine organisations into twenty.
 *
 * Read-only. Never calls COMPOSIO_MANAGE_CONNECTIONS, which creates a pending
 * connection stub as a side effect of being asked what exists.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/xero-inventory.ts [composio-account ...]
 */
import { executeXero, type XeroToolCall } from "../lib/xero/composioMcp";

/** Composio connections authorised directly, when not given on the command line. */
const DEFAULT_DIRECT_ACCOUNTS = ["Ramwall", "xero_dayfly-palate", "Kerrs", "xero_fetus-hoper"];

interface Tenant {
  tenantId?: string;
  tenant_id?: string;
  tenantName?: string;
  tenant_name?: string;
}

/** Direct Xero tools answer under response.data.connections. */
function directTenants(result: unknown): Tenant[] {
  const r = result as { response?: { data?: { connections?: Tenant[] } } } | null;
  return r?.response?.data?.connections ?? [];
}

/** The Nango proxy wraps Xero's body one level deeper, under response.data.data. */
function proxiedTenants(result: unknown): Tenant[] {
  const r = result as { response?: { data?: { data?: Tenant[] } } } | null;
  return r?.response?.data?.data ?? [];
}

interface NangoConnection {
  connection_id: string;
  provider?: string;
  provider_config_key?: string;
  end_user?: { display_name?: string };
}

async function nangoConnections(): Promise<NangoConnection[]> {
  const [r] = await executeXero(
    [{ tool_slug: "NANGO_LIST_CONNECTIONS", arguments: {} }],
    "List Nango connections."
  );
  if (!r || r.error) return [];
  const body = r as { response?: { data?: { connections?: NangoConnection[] } } };
  return (body.response?.data?.connections ?? []).filter(
    (c) => c.provider === "xero" || c.provider_config_key === "xero"
  );
}

async function main() {
  const direct = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DIRECT_ACCOUNTS;
  const nango = await nangoConnections();

  console.log(`\nRoutes: ${direct.length} Composio-direct, ${nango.length} via Nango\n`);

  const calls: XeroToolCall[] = [
    ...direct.map((account) => ({ tool_slug: "XERO_GET_CONNECTIONS", account, arguments: {} })),
    ...nango.map((c) => ({
      tool_slug: "NANGO_GET_PROXY",
      arguments: {
        connection_id: c.connection_id,
        provider_config_key: "xero",
        any_path: "connections",
      },
    })),
  ];

  const labels = [
    ...direct.map((a) => `composio:${a}`),
    ...nango.map((c) => `nango:${c.end_user?.display_name ?? c.connection_id.slice(0, 8)}`),
  ];

  const results = await executeXero(calls, "Enumerate Xero organisations across both routes.");

  const byTenant = new Map<string, { name: string; via: string[] }>();
  for (const r of results) {
    const label = labels[r.index] ?? `#${r.index}`;
    if (r.error) {
      console.log(`  ${label}: failed — ${String(r.error).slice(0, 120)}`);
      continue;
    }
    const tenants = label.startsWith("nango:") ? proxiedTenants(r) : directTenants(r);
    console.log(`  ${label}: ${tenants.length}`);
    for (const t of tenants) {
      const id = t.tenantId ?? t.tenant_id;
      if (!id) continue;
      const name = (t.tenantName ?? t.tenant_name ?? "(unnamed)").trim();
      const seen = byTenant.get(id);
      if (seen) seen.via.push(label);
      else byTenant.set(id, { name, via: [label] });
    }
  }

  console.log(`\n${byTenant.size} distinct Xero organisations:\n`);
  const sorted = [...byTenant.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  for (const [id, o] of sorted) {
    console.log(`  ${o.name}`);
    console.log(`    tenant_id: ${id}`);
    console.log(`    routes: ${o.via.length}  (${o.via[0]}${o.via.length > 1 ? ", …" : ""})`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
