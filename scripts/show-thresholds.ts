/**
 * Prints the configured variance thresholds. Read-only.
 *
 * Useful after a migration to confirm existing rows kept their values, and
 * for checking which contexts an entity actually has configured.
 */
import { db } from "../db/client";
import { varianceThresholds, GLOBAL_THRESHOLD_SCOPE } from "../db/schema";

const rows = db.select().from(varianceThresholds).all();

if (rows.length === 0) {
  console.log("No thresholds configured.");
  process.exit(0);
}

console.log("scope".padEnd(26) + "context".padEnd(18) + "amount".padEnd(14) + "percent");
for (const row of rows) {
  const scope = row.entityId === GLOBAL_THRESHOLD_SCOPE ? "(group default)" : row.entityId;
  console.log(
    scope.padEnd(26) + row.context.padEnd(18) + row.absoluteAmount.padEnd(14) + (row.percent ?? "-")
  );
}
console.log(`\n${rows.length} row(s).`);
