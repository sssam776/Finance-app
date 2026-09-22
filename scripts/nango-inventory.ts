/**
 * Lists the Xero connections Nango holds, reached through Composio.
 *
 * The client's organisations are split across two routes: some authorised
 * directly into Composio, the rest into Nango, which Composio in turn exposes
 * as a toolkit. Both have to be read to see the whole group, and neither knows
 * about the other — so this counts what Nango has and names each one.
 *
 * Read-only.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/nango-inventory.ts
 */
import { executeXero } from "../lib/xero/composioMcp";

interface NangoConnection {
  connection_id: string;
  provider: string;
  provider_config_key: string;
  created?: string;
  end_user?: { display_name?: string; id?: string; organization?: { display_name?: string } };
  tags?: Record<string, string> | null;
  errors?: unknown[];
}

function connectionsFrom(result: unknown): NangoConnection[] {
  const r = result as { response?: { data?: { connections?: NangoConnection[] } } } | null;
  return r?.response?.data?.connections ?? [];
}

async function main() {
  const [result] = await executeXero(
    [{ tool_slug: "NANGO_LIST_CONNECTIONS", arguments: {} }],
    "List Nango connections to see which Xero organisations it holds."
  );

  if (!result) {
    console.error("No response from Composio.");
    process.exit(1);
  }
  if (result.error) {
    console.error(`Failed: ${String(result.error).slice(0, 300)}`);
    process.exit(1);
  }

  const all = connectionsFrom(result);
  const xero = all.filter((c) => c.provider === "xero" || c.provider_config_key === "xero");

  console.log(`\nNango connections: ${all.length} (${xero.length} for Xero)\n`);

  for (const c of xero) {
    const org = c.end_user?.organization?.display_name ?? "(no organisation)";
    const user = c.end_user?.display_name ?? c.end_user?.id ?? "(no end user)";
    // A connection carrying errors still appears in the list and still looks
    // usable. It is not, and a dashboard built on it reports a gap as a zero.
    const broken = (c.errors?.length ?? 0) > 0 ? `  ERRORS: ${c.errors!.length}` : "";
    console.log(`  ${user} / ${org}${broken}`);
    console.log(`    connection_id: ${c.connection_id}`);
    if (c.created) console.log(`    created: ${c.created.slice(0, 10)}`);
    if (c.tags?.purpose) console.log(`    purpose: ${c.tags.purpose}`);
    console.log();
  }

  const others = all.filter((c) => !xero.includes(c));
  if (others.length) {
    console.log(`Non-Xero connections in the same Nango account: ${others.map((c) => c.provider).join(", ")}`);
  }

  console.log(
    "\nEach connection_id addresses one Xero authorisation. Reaching the",
    "\norganisations behind it uses NANGO_GET_PROXY against the Xero API.\n"
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
