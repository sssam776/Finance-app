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

/** Newest snapshot covering this entity's P&L, whatever period end it was fetched for. */
function latestSnapshot(entityId: string) {
  return db
    .select()
    .from(reportSnapshots)
    .where(
      and(
        eq(reportSnapshots.entityId, entityId),
        eq(reportSnapshots.reportType, "profit_and_loss")
      )
    )
    .orderBy(desc(reportSnapshots.periodEnd), desc(reportSnapshots.createdAt))
    .limit(1)
    .get();
}

function rowsForPeriod(snapshotId: string, period: PeriodKey): PlRow[] {
  return db
    .select()
    .from(reportRows)
    .where(and(eq(reportRows.snapshotId, snapshotId), eq(reportRows.periodKey, period)))
    .all()
    .filter((r) => !r.isSubtotal) // subtotals would double-count against their own accounts
    .map((r) => ({
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

  const snapshot = latestSnapshot(entityId);
  if (!snapshot) {
    return NextResponse.json({
      entityId,
      period,
      comparison,
      available: false,
      reason: "No profit and loss has been synced for this entity yet.",
      rows: [],
      exceptionCount: 0,
    });
  }

  const comparePeriod = comparison === "prior_month" ? priorPeriod(period) : priorYear(period);

  const actualRows = rowsForPeriod(snapshot.id, period);
  const comparativeRows = rowsForPeriod(snapshot.id, comparePeriod);

  if (actualRows.length === 0 && comparativeRows.length === 0) {
    return NextResponse.json({
      entityId,
      period,
      comparison,
      comparePeriod,
      available: false,
      reason: `The latest snapshot holds no rows for ${formatPeriod(period)} or ${formatPeriod(comparePeriod)}. Sync a wider period range.`,
      rows: [],
      exceptionCount: 0,
    });
  }

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
