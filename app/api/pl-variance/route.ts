import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { entities, reportSnapshots, reportRows, syncRuns, varianceThresholds } from "@/db/schema";
import { resolveThreshold } from "@/lib/thresholds";
import { summariseMovements, type PlRow, type SectionKind } from "@/lib/variance/plMovement";
import {
  isValidPeriodKey,
  priorPeriod,
  priorYear,
  formatPeriod,
  type PeriodKey,
} from "@/lib/periods";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";

/**
 * VAR-001 and VAR-003: what moved between two periods, ranked by materiality.
 *
 * Every figure returned comes from a stored snapshot, and the evidence block
 * names the snapshot and sync run it came from, so a number on screen can be
 * traced back to the exact Xero read that produced it.
 *
 * Budget comparison (VAR-002) is deliberately absent. It needs the client's
 * approved budget workbook, which does not exist yet; the route reports the
 * comparison as unavailable rather than pretending to a figure.
 */

const COMPARISONS = ["prior_month", "prior_year_month", "budget"] as const;
type Comparison = (typeof COMPARISONS)[number];

/** The stored kinds are narrower than the judgement needs, so widen them back. */
function judgementKind(stored: string | null, sectionTitle: string | null): SectionKind {
  if (stored === "revenue") return "revenue";
  if (stored === "expense") {
    return /cost of (sales|goods)/i.test(sectionTitle ?? "") ? "cost_of_sales" : "operating_expense";
  }
  return "unclassified";
}

/**
 * The newest snapshot that both completed and actually holds the two periods
 * being compared.
 *
 * Two rules, each of which was a real way to publish a wrong number:
 *
 * A snapshot whose sync run failed or ended partial is not authoritative. Its
 * rows are whatever was written before the failure, and reading them produces
 * a report built from half an answer.
 *
 * A snapshot that does not span the comparative period reads that side as
 * zero, so every account shows its full actual as the movement. The percentage
 * comes back null in that case, which removes the one cue that would look odd,
 * making the fabricated comparison harder to notice rather than easier.
 */
function usableSnapshot(entityId: string, period: PeriodKey, comparePeriod: PeriodKey) {
  const candidates = db
    .select()
    .from(reportSnapshots)
    .innerJoin(syncRuns, eq(reportSnapshots.syncRunId, syncRuns.id))
    .where(
      and(
        eq(reportSnapshots.entityId, entityId),
        eq(reportSnapshots.reportType, "profit_and_loss"),
        eq(syncRuns.status, "complete")
      )
    )
    .orderBy(desc(reportSnapshots.periodEnd), desc(reportSnapshots.createdAt))
    .all();

  for (const row of candidates) {
    const snapshot = row.report_snapshots;
    const periodsPresent = db
      .selectDistinct({ periodKey: reportRows.periodKey })
      .from(reportRows)
      .where(eq(reportRows.snapshotId, snapshot.id))
      .all()
      .map((r) => r.periodKey);

    if (periodsPresent.includes(period) && periodsPresent.includes(comparePeriod)) {
      return { snapshot, coverageProblem: null as string | null };
    }
  }

  if (candidates.length === 0) {
    return { snapshot: null, coverageProblem: null };
  }
  return {
    snapshot: null,
    coverageProblem:
      "No completed snapshot holds both periods. Sync a range that covers them before comparing.",
  };
}

function rowsForPeriod(snapshotId: string, period: PeriodKey): PlRow[] {
  return db
    .select()
    .from(reportRows)
    .where(and(eq(reportRows.snapshotId, snapshotId), eq(reportRows.periodKey, period)))
    .all()
    .filter((r) => !r.isSubtotal) // subtotals would double-count against their own accounts
    .map((r) => ({
      xeroAccountId: r.xeroAccountId,
      accountCode: r.accountCode,
      accountName: r.accountName,
      sectionKind: judgementKind(r.sectionKind, r.sectionTitle),
      amount: r.amount,
      currency: r.currency,
    }));
}

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId") ?? "";
  const period = url.searchParams.get("period") ?? "";
  const comparison = (url.searchParams.get("comparison") ?? "prior_month") as Comparison;

  if (!entityId) return NextResponse.json({ error: "entityId is required" }, { status: 400 });
  if (!isValidPeriodKey(period)) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }
  if (!COMPARISONS.includes(comparison)) {
    return NextResponse.json(
      { error: `comparison must be one of ${COMPARISONS.join(", ")}` },
      { status: 400 }
    );
  }
  if (!canAccessEntity(entityAccessFor(actor), entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  const entity = db.select().from(entities).where(eq(entities.id, entityId)).get();
  if (!entity) return NextResponse.json({ error: "Unknown entityId" }, { status: 404 });

  if (comparison === "budget") {
    // Stated, not silently empty. VAR-002 needs the approved budget workbook,
    // and a zero comparative would read as "budget was nil" rather than
    // "there is no budget".
    return NextResponse.json({
      entityId,
      period,
      comparison,
      available: false,
      reason:
        "No approved budget source. VAR-002 needs either a Xero budget or the client's approved budget workbook; neither has been supplied.",
      rows: [],
      exceptionCount: 0,
    });
  }

  const comparePeriod = comparison === "prior_month" ? priorPeriod(period) : priorYear(period);
  const { snapshot, coverageProblem } = usableSnapshot(entityId, period, comparePeriod);

  if (!snapshot) {
    return NextResponse.json({
      entityId,
      period,
      comparison,
      comparePeriod,
      available: false,
      reason:
        coverageProblem ??
        "No completed profit and loss sync exists for this entity yet.",
      rows: [],
      exceptionCount: 0,
    });
  }

  const actualRows = rowsForPeriod(snapshot.id, period);
  const comparativeRows = rowsForPeriod(snapshot.id, comparePeriod);

  const thresholdRows = db.select().from(varianceThresholds).all();
  const threshold = resolveThreshold(thresholdRows, entityId, "pnl_movement");

  const summary = summariseMovements(actualRows, comparativeRows, {
    threshold,
    currency: entity.reportingCurrency,
  });

  const syncRun = db.select().from(syncRuns).where(eq(syncRuns.id, snapshot.syncRunId)).get();

  return NextResponse.json({
    entityId,
    entityShortCode: entity.shortCode,
    period,
    periodLabel: formatPeriod(period),
    comparison,
    comparePeriod,
    comparePeriodLabel: formatPeriod(comparePeriod),
    available: true,
    currency: entity.reportingCurrency,
    threshold,
    ...summary,
    // Same evidence shape as the cash position, so a reader learns it once.
    evidence: {
      reportSnapshotId: snapshot.id,
      syncRunId: snapshot.syncRunId,
      tenantId: snapshot.tenantId,
      parserVersion: snapshot.parserVersion,
      payloadHash: snapshot.payloadHash,
      fetchedAt: snapshot.fetchedAt,
      syncStatus: syncRun?.status ?? null,
    },
  });
}
