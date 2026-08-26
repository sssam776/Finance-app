/**
 * Reports which scope profile each registered Xero app is on, and migrates any
 * app still assigned to a retired profile.
 *
 * db/seed.ts uses onConflictDoNothing, so an app row created before the
 * profile was corrected keeps the old value and would fail at
 * buildXeroClient. Run with --fix to move them.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { xeroApps } from "../db/schema";
import { RETIRED_SCOPE_PROFILES } from "../lib/xero/scopeProfiles";
import { nowUtcIso } from "../lib/dates";

const FIX = process.argv.includes("--fix");
const TARGET = "read_core_v2";

const apps = db
  .select({
    id: xeroApps.id,
    appKey: xeroApps.appKey,
    environment: xeroApps.environment,
    scopeProfile: xeroApps.scopeProfile,
  })
  .from(xeroApps)
  .all();

if (apps.length === 0) {
  console.log("No Xero apps registered.");
  process.exit(0);
}

let retired = 0;
for (const app of apps) {
  const isRetired = RETIRED_SCOPE_PROFILES.has(app.scopeProfile);
  console.log(
    `${isRetired ? "RETIRED " : "ok      "} ${app.appKey.padEnd(28)} ${app.environment.padEnd(12)} ${app.scopeProfile}`
  );
  if (!isRetired) continue;
  retired++;

  if (FIX) {
    db.update(xeroApps)
      .set({ scopeProfile: TARGET, updatedAt: nowUtcIso() })
      .where(eq(xeroApps.id, app.id))
      .run();
    console.log(`         -> moved to ${TARGET}`);
  }
}

if (retired === 0) {
  console.log("\nAll apps are on a usable scope profile.");
} else if (FIX) {
  console.log(
    `\nMoved ${retired} app(s) to ${TARGET}.\n` +
      "Any existing authorisation still holds the scopes it was granted under.\n" +
      "Reconnect each organisation so the new scopes are actually issued."
  );
} else {
  console.log(`\n${retired} app(s) on a retired profile. Re-run with --fix to move them.`);
}
