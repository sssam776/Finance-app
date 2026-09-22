/** Prints the input schema for one or more Composio tools. Read-only. */
import { callTool } from "../lib/xero/composioMcp";

const slugs = process.argv.slice(2);
callTool("COMPOSIO_GET_TOOL_SCHEMAS", { tool_slugs: slugs })
  .then((p) => {
    const s = (p as { data?: { tool_schemas?: Record<string, { input_schema?: unknown }> } }).data?.tool_schemas ?? {};
    for (const [k, v] of Object.entries(s)) {
      console.log("=== " + k + " ===");
      console.log(JSON.stringify(v.input_schema, null, 1).slice(0, 1800));
    }
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
