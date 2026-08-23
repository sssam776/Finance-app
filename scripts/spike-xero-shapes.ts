/**
 * Demo Company spike.
 *
 * Answers the two assumptions that sit directly under the only number the
 * client has seen, both documented as guesses in the code:
 *
 *   1. lib/xero/reports.ts:30 reads the LAST cell of each Bank Summary row as
 *      the closing balance. Is the column order actually
 *      (Account, Opening, Cash Received, Cash Spent, Closing)?
 *
 *   2. app/api/xero/sync/route.ts matches Xero accounts to Bank Summary rows
 *      by account NAME. Do the names in the report match the names on the
 *      accounts, exactly, always?
 *
 * Prints the raw report structure and the match result, then says plainly
 * whether each assumption held. Read-only: it fetches and prints, and writes
 * nothing to the database or to Xero.
 *
 * Prerequisites: a Xero organisation connected through /xero and assigned to
 * an entity for the read_core purpose.
 *
 * Run with: npx tsx scripts/spike-xero-shapes.ts [entityShortCode]
 */
import { RowType } from "xero-node";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { entities } from "../db/schema";
import { resolveXeroRoute, getAuthenticatedClient } from "../lib/xero/gateway";
import { parseBankSummaryClosingBalances } from "../lib/xero/reports";

const wanted = process.argv[2];

function heading(text: string) {
  console.log(`\n${"=".repeat(72)}\n${text}\n${"=".repeat(72)}`);
}

async function main() {
  const allEntities = db.select().from(entities).all();
  const entity = wanted
    ? db.select().from(entities).where(eq(entities.shortCode, wanted)).get()
    : allEntities.find((e) => e.xeroTenantId) ?? allEntities[0];

  if (!entity) {
    console.error("No entities found. Run db/seed.ts first.");
    process.exit(1);
  }

  console.log(`Entity: ${entity.shortCode} (${entity.legalName})`);

  let route;
  try {
    route = await resolveXeroRoute(entity.id, "read_core");
  } catch (err) {
    console.error(`\nNo usable Xero route for ${entity.shortCode}:`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      "\nConnect a Xero organisation at /xero and assign it to this entity for the read_core purpose, then re-run."
    );
    process.exit(1);
  }

  const { client, tenantId } = await getAuthenticatedClient(route);
  console.log(`Tenant: ${tenantId}`);

  // ---------------------------------------------------------------------
  heading("QUESTION 1 — is the closing balance the last cell in the row?");

  const bankSummary = await client.accountingApi.getReportBankSummary(tenantId);
  const report = bankSummary.body.reports?.[0];

  if (!report) {
    console.error("Bank Summary returned no report body. Nothing to check.");
    process.exit(1);
  }

  console.log(`Report name : ${report.reportName ?? report.reportTitle ?? "(none)"}`);
  console.log(`Report date : ${report.reportDate ?? "(none)"}`);

  // The header row names the columns. This is the actual answer.
  const header = report.rows?.find((r) => r.rowType === RowType.Header);
  const headerCells = header?.cells?.map((c) => c.value ?? "") ?? [];

  console.log(`\nColumn headers as returned (${headerCells.length} columns):`);
  headerCells.forEach((h, i) => {
    const isLast = i === headerCells.length - 1;
    console.log(`  [${i}]${isLast ? " <- last" : "    "} ${h}`);
  });

  const lastHeader = String(headerCells[headerCells.length - 1] ?? "");
  const lastIsClosing = /clos/i.test(lastHeader);

  console.log(
    `\nASSUMPTION 1: ${lastIsClosing ? "HOLDS" : "DOES NOT HOLD"} — the last column is "${lastHeader}".`
  );
  if (!lastIsClosing) {
    const closingIndex = headerCells.findIndex((h) => /clos/i.test(String(h)));
    console.log(
      closingIndex >= 0
        ? `  The closing balance is at index ${closingIndex}, not the last cell. lib/xero/reports.ts must select by header, not by position.`
        : `  No column matched /clos/i at all. Inspect the headers above before trusting any variance figure.`
    );
  }

  // ---------------------------------------------------------------------
  heading("QUESTION 2 — do Bank Summary row names match account names?");

  const parsed = parseBankSummaryClosingBalances(bankSummary.body);
  console.log(`Rows parsed by the current parser: ${parsed.length}`);
  for (const row of parsed) {
    console.log(`  ${row.accountName.padEnd(44)} ${row.closingBalance}`);
  }

  const accountsResponse = await client.accountingApi.getAccounts(
    tenantId,
    undefined,
    'Type=="BANK"'
  );
  const bankAccounts = accountsResponse.body.accounts ?? [];
  console.log(`\nBank accounts returned by /Accounts: ${bankAccounts.length}`);
  for (const account of bankAccounts) {
    console.log(
      `  ${(account.name ?? "(unnamed)").padEnd(44)} code=${account.code ?? "-"}  id=${account.accountID}`
    );
  }

  // Exactly what app/api/xero/sync/route.ts does today.
  const balanceByName = new Map(parsed.map((b) => [b.accountName, b.closingBalance]));

  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const account of bankAccounts) {
    if (!account.name) continue;
    (balanceByName.has(account.name) ? matched : unmatched).push(account.name);
  }

  const orphanRows = parsed.map((p) => p.accountName).filter((n) => !bankAccounts.some((a) => a.name === n));

  console.log(`\nMatched by exact name : ${matched.length}/${bankAccounts.length}`);
  if (unmatched.length) {
    console.log(`Accounts with NO Bank Summary row:`);
    unmatched.forEach((n) => console.log(`  - ${n}`));
  }
  if (orphanRows.length) {
    console.log(`Bank Summary rows matching NO account:`);
    orphanRows.forEach((n) => console.log(`  - ${n}`));
  }

  const allMatched = unmatched.length === 0 && orphanRows.length === 0 && bankAccounts.length > 0;
  console.log(
    `\nASSUMPTION 2: ${allMatched ? "HOLDS" : "DOES NOT HOLD"} — name matching covered ${matched.length} of ${bankAccounts.length} accounts.`
  );
  if (!allMatched) {
    console.log(
      "  Matching on a display name is fragile: it is user-editable in Xero and breaks silently.\n" +
        "  Prefer the account code or accountID, which the Bank Summary rows carry in their\n" +
        "  attributes when present. Inspect the raw section dump below."
    );
  }

  // ---------------------------------------------------------------------
  heading("RAW STRUCTURE (first section, for reference)");

  const firstSection = report.rows?.find((r) => r.rowType === RowType.Section);
  if (firstSection) {
    console.log(`Section title: ${firstSection.title ?? "(none)"}`);
    for (const row of firstSection.rows?.slice(0, 3) ?? []) {
      console.log(`  rowType=${row.rowType}`);
      row.cells?.forEach((cell, i) => {
        const attrs = cell.attributes?.map((a) => `${a.id}=${a.value}`).join(", ");
        console.log(`    cell[${i}] value=${JSON.stringify(cell.value)}${attrs ? `  attrs: ${attrs}` : ""}`);
      });
    }
  } else {
    console.log("No section rows found.");
  }

  heading("SUMMARY");
  console.log(`Assumption 1 (closing balance is the last cell): ${lastIsClosing ? "HOLDS" : "BROKEN"}`);
  console.log(`Assumption 2 (account names match report rows) : ${allMatched ? "HOLDS" : "BROKEN"}`);
  console.log(
    "\nIf either is broken, fix it before the client sees another variance figure.\n" +
      "Both feed app/api/cash-position/route.ts directly."
  );
}

main().catch((err) => {
  console.error("\nSpike failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
