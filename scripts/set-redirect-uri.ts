/**
 * Points the registered Xero apps at a new redirect URI.
 *
 * The URI is stored per app in `xero_apps.redirect_uri`, copied from
 * XERO_REDIRECT_URI when the row was first seeded. The seed uses
 * onConflictDoNothing, so it never updates an existing row — which means
 * changing the environment variable on a host has no effect at all, and the
 * consent URL keeps pointing wherever it pointed on the machine that seeded
 * the database. Xero then refuses the request with `invalid_redirect_uri`,
 * naming a URL nobody set on this deployment.
 *
 * This is the supported way to change it. Unlike the verify-* scripts it does
 * not refuse to run outside development, because changing it after a deploy is
 * the entire reason it exists.
 *
 * Run with:
 *   npx tsx scripts/set-redirect-uri.ts https://your-app.fly.dev
 *   npx tsx scripts/set-redirect-uri.ts https://your-app.fly.dev --app ramwall_read_core_dev
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { xeroApps } from "../db/schema";
import { nowUtcIso } from "../lib/dates";

const CALLBACK_PATH = "/api/xero/oauth/callback";

function usage(message: string): never {
  console.error(`${message}\n`);
  console.error("Usage: npx tsx scripts/set-redirect-uri.ts <base-url> [--app <appKey>]");
  console.error("  e.g. npx tsx scripts/set-redirect-uri.ts https://ramwall-finance.fly.dev");
  process.exit(1);
}

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const appIndex = args.indexOf("--app");
const appKey = appIndex >= 0 ? args[appIndex + 1] : undefined;

if (!target) usage("No URL given.");
if (appIndex >= 0 && !appKey) usage("--app needs an app key.");

/**
 * Accepts either a bare origin or a full callback URL, and always stores the
 * full one. Letting a caller type the path by hand is how a single character
 * ends up differing from what is registered on Xero, which fails with an error
 * that points at the URL rather than at the typo.
 */
let redirectUri: string;
try {
  const parsed = new URL(target);

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    usage(`Expected an http or https URL, got "${parsed.protocol}".`);
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol === "http:" && !isLocal) {
    usage(
      `Refusing to store an insecure URL for ${parsed.hostname}.\n` +
        "Xero only permits plain http for localhost, and session cookies are " +
        "secure-only in production, so http would also break sign-in."
    );
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  redirectUri = parsed.origin + CALLBACK_PATH;

  if (path !== "" && path !== CALLBACK_PATH) {
    console.warn(`note: ignoring path "${parsed.pathname}" and using ${CALLBACK_PATH}\n`);
  }
} catch {
  usage(`"${target}" is not a valid URL.`);
}

const apps = appKey
  ? db.select().from(xeroApps).where(eq(xeroApps.appKey, appKey)).all()
  : db.select().from(xeroApps).all();

if (apps.length === 0) {
  console.error(
    appKey ? `No Xero app with key "${appKey}".` : "No Xero apps registered. Run the seed first."
  );
  process.exit(1);
}

let changed = 0;
for (const app of apps) {
  if (app.redirectUri === redirectUri) {
    console.log(`unchanged  ${app.appKey}`);
    continue;
  }
  db.update(xeroApps)
    .set({ redirectUri, updatedAt: nowUtcIso() })
    .where(eq(xeroApps.id, app.id))
    .run();
  console.log(`updated    ${app.appKey}`);
  console.log(`             was: ${app.redirectUri}`);
  console.log(`             now: ${redirectUri}`);
  changed += 1;
}

console.log(`\n${changed} of ${apps.length} app(s) updated.`);
if (changed > 0) {
  console.log(
    `\nRegister this exact URI on each app at https://developer.xero.com/app/manage:\n  ${redirectUri}\n` +
      "Xero compares it character for character, including the scheme and any trailing slash."
  );
}
