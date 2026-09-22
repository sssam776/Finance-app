/**
 * Searches Composio's tool catalogue.
 *
 * Read-only. Unlike COMPOSIO_MANAGE_CONNECTIONS, which initiates a pending
 * connection as a side effect of being asked what exists, this only looks.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/composio-search.ts "nango"
 */
import { callTool } from "../lib/xero/composioMcp";

const query = process.argv.slice(2).join(" ") || "xero";

callTool("COMPOSIO_SEARCH_TOOLS", { query })
  .then((payload) => {
    const text = JSON.stringify(payload);
    const toolkits = [...new Set(text.match(/"toolkit"\s*:\s*"([^"]+)"/g) ?? [])];
    const slugs = [...new Set(text.match(/[A-Z][A-Z0-9_]{3,}_[A-Z0-9_]+/g) ?? [])];
    console.log(`query: ${query}`);
    console.log(`toolkits mentioned: ${toolkits.join(", ") || "(none)"}`);
    console.log(`tool slugs: ${slugs.length}`);
    console.log(slugs.slice(0, 40).join("\n"));
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
