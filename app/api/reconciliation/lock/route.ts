import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reconciliationPeriods, reconciliationWorkpapers } from "@/db/schema";
import { nowUtcIso } from "@/lib/dates";
import { periodReadiness } from "@/lib/reconciliation/status";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";

/**
 * BS-001: lock or reopen a reconciliation period.
 *
 * Locking over unsettled material accounts is possible but never silent. It
 * requires an explicit acknowledgement and is recorded on the period, so a
 * close that skipped its own gate is visible afterwards rather than
 * indistinguishable from a clean one.
 */

const lockSchema = z.object({
  periodId: z.string().min(1),
  action: z.enum(["lock", "reopen"]),
  /** Required to lock over material accounts that are not settled. */
  acknowledgeUnresolved: z.boolean().default(false),
  /** Required to reopen: a locked period reopening without a reason is not auditable. */
  reason: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = lockSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { periodId, action, acknowledgeUnresolved, reason } = parsed.data;

  const period = db
    .select()
    .from(reconciliationPeriods)
    .where(eq(reconciliationPeriods.id, periodId))
    .get();
  if (!period) return NextResponse.json({ error: "Unknown periodId" }, { status: 404 });

  if (!canAccessEntity(entityAccessFor(actor), period.entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  const now = nowUtcIso();

  if (action === "reopen") {
    if (!reason || reason === "") {
      return NextResponse.json(
        { error: "Reopening a locked period requires a reason." },
        { status: 400 }
      );
    }

    db.transaction((tx) => {
      tx.update(reconciliationPeriods)
        .set({
          status: "open",
          reopenedByEmail: actor.email,
          reopenedAt: now,
          reopenReason: reason,
          lockedByEmail: null,
          lockedAt: null,
          updatedAt: now,
        })
        .where(eq(reconciliationPeriods.id, periodId))
        .run();

      // Workpapers locked by the close return to reviewed, not to unreviewed:
      // the review happened, only the lock is being lifted.
      tx.update(reconciliationWorkpapers)
        .set({ status: "reviewed", updatedAt: now })
        .where(
          and(
            eq(reconciliationWorkpapers.periodId, periodId),
            eq(reconciliationWorkpapers.status, "locked")
          )
        )
        .run();
    });

    await recordAuditEvent({
      actorEmail: actor.email,
      action: "reconciliation.reopened",
      entityId: period.entityId,
      resourceType: "reconciliation_period",
      resourceId: periodId,
      detail: { periodEnd: period.periodEnd, reason },
    });

    return NextResponse.json({ ok: true, status: "open" });
  }

  if (period.status === "locked") {
    return NextResponse.json({ error: "This period is already locked." }, { status: 409 });
  }

  const workpapers = db
    .select()
    .from(reconciliationWorkpapers)
    .where(eq(reconciliationWorkpapers.periodId, periodId))
    .all();

  const readiness = periodReadiness(
    workpapers.map((w) => ({
      accountCode: w.accountCode,
      status: w.status,
      isMaterial: w.isMaterial,
    }))
  );

  if (!readiness.ready && !acknowledgeUnresolved) {
    return NextResponse.json(
      {
        error: `${readiness.blocking.length} material account(s) are not substantiated. Resolve them, or lock again acknowledging that they remain unresolved.`,
        blocking: readiness.blocking,
      },
      { status: 409 }
    );
  }

  db.transaction((tx) => {
    tx.update(reconciliationPeriods)
      .set({
        status: "locked",
        lockedByEmail: actor.email,
        lockedAt: now,
        lockAcknowledgedUnresolved: !readiness.ready,
        updatedAt: now,
      })
      .where(eq(reconciliationPeriods.id, periodId))
      .run();

    // Only settled workpapers become locked. An unresolved one keeps its own
    // status so the record still says which accounts were outstanding at close.
    for (const w of workpapers) {
      if (w.status === "reconciled" || w.status === "reconciled_with_timing_difference" || w.status === "reviewed") {
        tx.update(reconciliationWorkpapers)
          .set({ status: "locked", updatedAt: now })
          .where(eq(reconciliationWorkpapers.id, w.id))
          .run();
      }
    }
  });

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "reconciliation.locked",
    entityId: period.entityId,
    resourceType: "reconciliation_period",
    resourceId: periodId,
    detail: {
      periodEnd: period.periodEnd,
      acknowledgedUnresolved: !readiness.ready,
      blocking: readiness.blocking,
    },
  });

  return NextResponse.json({
    ok: true,
    status: "locked",
    acknowledgedUnresolved: !readiness.ready,
    blocking: readiness.blocking,
  });
}
