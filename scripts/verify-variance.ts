/**
 * End-to-end check of Module C against a running dev server.
 *
 * The P&L sync route needs a real Xero connection, so this seeds a snapshot
 * and its rows directly and then drives GET /api/pl-variance through HTTP.
 * That is the half that has never been executed: the unit tests cover the
 * arithmetic, and nothing has yet proved the route assembles it correctly.
 *
 * Run with: ADMIN_PASSWORD=... npx tsx scripts/verify-variance.ts
 */
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { entities, reportSnapshots, reportRows, syncRuns } from "../db/schema";
import { nowUtcIso } from "../lib/dates";
import { assertLocalDevDatabase, adminPassword } from "./guardTestDb";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ramwall.local";

assertLocalDevDatabase();
const ADMIN_PASSWORD = adminPassword();

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(56)} ${actual}${ok ? "" : `  (expected ${expected})`}`);
  ok ? pass++ : fail++;
}

let cookie = "";
async function call(path: string) {
  return fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
}

const PERIOD = "2026-07";
const PRIOR = "2026-06";
const MARKER = "verify-variance";

/** (accountName, sectionKind, amount for July, amount for June) */
const FIXTURE: [string, "revenue" | "expense" | "other", string, string][] = [
  ["Verify Sales", "revenue", "120000.00", "100000.00"], // up 20k, favourable
  ["Verify Rent", "expense", "9000.00", "5000.00"], // up 4k, adverse
  ["Verify Power", "expense", "800.00", "3000.00"], // down 2.2k, favourable
  ["Verify Flat", "expense", "500.00", "500.00"], // unchanged
  ["Verify New Cost", "expense", "7000.00", "0"], // new this month
];

function seed(entityId: string) {
  const now = nowUtcIso();
  const syncRunId = nanoid();
  db.insert(syncRuns)
    .values({
      id: syncRunId,
      entityId,
      resource: MARKER,
      status: "complete",
      recordsRead: 0,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const snapshotId = nanoid();
  db.insert(reportSnapshots)
    .values({
      id: snapshotId,
      entityId,
      reportType: "profit_and_loss",
      periodEnd: "2026-07-31",
      xeroAppId: MARKER,
      connectionId: MARKER,
      tenantId: MARKER,
      syncRunId,
      payloadHash: "verify-hash",
      parserVersion: "xero-report-v1",
      rowCount: 0,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  let order = 0;
  for (const [accountName, sectionKind, july, june] of FIXTURE) {
    for (const [periodKey, amount] of [
      [PERIOD, july],
      [PRIOR, june],
    ] as const) {
      if (amount === "0") continue; // absent from that period entirely
      db.insert(reportRows)
        .values({
          id: nanoid(),
          snapshotId,
          rowOrder: order,
          sectionTitle: sectionKind === "revenue" ? "Income" : "Less Operating Expenses",
          sectionKind,
          accountCode: null,
          accountName,
          xeroAccountId: null,
          periodKey,
          amount,
          currency: "NZD",
          isSubtotal: false,
          createdAt: now,
        })
        .run();
    }
    order += 1;
  }

  // A subtotal, which the route must exclude or every total double-counts.
  db.insert(reportRows)
    .values({
      id: nanoid(),
      snapshotId,
      rowOrder: order,
      sectionTitle: "Less Operating Expenses",
      sectionKind: "expense",
      accountCode: null,
      accountName: "Verify Total Expenses",
      xeroAccountId: null,
      periodKey: PERIOD,
      amount: "17300.00",
      currency: "NZD",
      isSubtotal: true,
      createdAt: now,
    })
    .run();

  return { snapshotId, syncRunId };
}

function cleanup(entityId: string, snapshotId: string, syncRunId: string) {
  db.delete(reportRows).where(eq(reportRows.snapshotId, snapshotId)).run();
  db.delete(reportSnapshots).where(eq(reportSnapshots.id, snapshotId)).run();
  db.delete(syncRuns).where(and(eq(syncRuns.id, syncRunId), eq(syncRuns.entityId, entityId))).run();
}

interface Row {
  accountName: string;
  movement: string;
  percent: string | null;
  favourable: boolean | null;
  isException: boolean;
}

async function main() {
  const entity = db.select().from(entities).limit(1).get();
  if (!entity) throw new Error("No entities seeded");

  // Clear anything a previous run left behind, so a second run is not a
  // different test from the first.
  const stale = db
    .select()
    .from(reportSnapshots)
    .where(and(eq(reportSnapshots.entityId, entity.id), eq(reportSnapshots.tenantId, MARKER)))
    .all();
  for (const s of stale) cleanup(entity.id, s.id, s.syncRunId);

  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  check("admin login", login.status, 200);
  console.log(`      entity ${entity.shortCode}, ${PERIOD} against ${PRIOR}`);

  const { snapshotId, syncRunId } = seed(entity.id);

  console.log("\n--- validation ---");
  check("rejects a missing entityId", (await call("/api/pl-variance?period=2026-07")).status, 400);
  check(
    "rejects a malformed period",
    (await call(`/api/pl-variance?entityId=${entity.id}&period=July`)).status,
    400
  );
  check(
    "rejects an unknown comparison",
    (await call(`/api/pl-variance?entityId=${entity.id}&period=${PERIOD}&comparison=vibes`)).status,
    400
  );

  console.log("\n--- prior month movement ---");
  const res = await call(
    `/api/pl-variance?entityId=${entity.id}&period=${PERIOD}&comparison=prior_month`
  );
  const body = (await res.json()) as {
    available: boolean;
    rows: Row[];
    exceptionCount: number;
    adverseCount: number;
    favourableCount: number;
    comparePeriod: string;
    evidence?: { reportSnapshotId: string; syncRunId: string };
  };

  check("GET /api/pl-variance", res.status, 200);
  check("  available", body.available, true);
  check("  comparative period resolved", body.comparePeriod, PRIOR);

  const byName = new Map(body.rows.map((r) => [r.accountName, r]));

  check("  revenue up is favourable", byName.get("Verify Sales")?.favourable, true);
  check("  revenue movement", byName.get("Verify Sales")?.movement, "20000.00");
  check("  cost up is adverse", byName.get("Verify Rent")?.favourable, false);
  check("  cost down is favourable", byName.get("Verify Power")?.favourable, true);
  check("  unchanged is neither", byName.get("Verify Flat")?.favourable, "null");
  check("  new cost line appears", byName.get("Verify New Cost")?.movement, "7000.00");
  check("  new cost line is adverse", byName.get("Verify New Cost")?.favourable, false);

  check("  subtotal excluded", byName.has("Verify Total Expenses"), false);

  console.log("\n--- ranking and evidence ---");
  const firstException = body.rows.findIndex((r) => r.isException);
  const firstNonException = body.rows.findIndex((r) => !r.isException);
  check(
    "  exceptions rank above non-exceptions",
    firstException === -1 || firstException < firstNonException,
    true
  );
  check("  evidence names the snapshot", body.evidence?.reportSnapshotId, snapshotId);
  check("  evidence names the sync run", body.evidence?.syncRunId, syncRunId);

  console.log("\n--- unbuilt comparisons are stated, not faked ---");
  const budget = await call(
    `/api/pl-variance?entityId=${entity.id}&period=${PERIOD}&comparison=budget`
  );
  const budgetBody = (await budget.json()) as { available: boolean; reason: string; rows: Row[] };
  check("  budget returns 200", budget.status, 200);
  check("  budget marked unavailable", budgetBody.available, false);
  check("  budget gives a reason", budgetBody.reason.length > 20, true);
  // A zero comparative would read as "budget was nil" rather than "no budget".
  check("  budget returns no rows", budgetBody.rows.length, 0);

  console.log("\n--- a snapshot missing one side must not fabricate the comparison ---");
  // The snapshot holds July and June. Asking July against July last year means
  // the comparative period is absent entirely. Reading it as zero would show
  // every account moving by its full actual, with the percentage null, which
  // removes the one cue that would look wrong.
  const noCover = await call(
    `/api/pl-variance?entityId=${entity.id}&period=${PERIOD}&comparison=prior_year_month`
  );
  const noCoverBody = (await noCover.json()) as { available: boolean; reason: string; rows: Row[] };
  check("  reports unavailable", noCoverBody.available, false);
  check("  returns no rows", noCoverBody.rows.length, 0);
  check("  explains the coverage gap", /both periods|covers/i.test(noCoverBody.reason), true);

  console.log("\n--- a period with no data says so ---");
  const empty = await call(
    `/api/pl-variance?entityId=${entity.id}&period=2019-01&comparison=prior_month`
  );
  const emptyBody = (await empty.json()) as { available: boolean; reason: string };
  check("  reports unavailable", emptyBody.available, false);
  check("  explains why", emptyBody.reason.length > 20, true);

  console.log("\n--- cleanup ---");
  cleanup(entity.id, snapshotId, syncRunId);
  console.log("      fixture removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
