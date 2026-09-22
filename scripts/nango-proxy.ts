/**
 * Calls the Xero API through Nango, reached through Composio.
 *
 * Nango stores the OAuth tokens and injects them; Composio exposes Nango as a
 * toolkit. So the app holds no Xero credentials for these organisations at all
 * — only a Composio consumer key — and the request arrives at Xero authorised.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/nango-proxy.ts <connection_id> [path]
 */
import { executeXero } from "../lib/xero/composioMcp";

const connectionId = process.argv[2];
const path = process.argv[3] ?? "connections";

if (!connectionId) {
  console.error("Usage: nango-proxy.ts <connection_id> [path]");
  console.error("Get connection ids from: npx tsx --env-file=.env.local scripts/nango-inventory.ts");
  process.exit(1);
}

executeXero(
  [
    {
      tool_slug: "NANGO_GET_PROXY",
      arguments: {
        connection_id: connectionId,
        provider_config_key: "xero",
        // No leading slash: the schema is explicit about that, and a leading
        // slash is the kind of thing that returns a 404 which reads like a
        // missing organisation rather than a malformed path.
        any_path: path,
      },
    },
  ],
  "Read Xero through a Nango-held connection."
)
  .then(([r]) => {
    if (!r) return console.error("No response.");
    if (r.error) return console.error("Failed: " + String(r.error).slice(0, 400));
    const body = JSON.stringify(r, null, 1);
    console.log(body.slice(0, 2500));
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
