import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { varianceThresholds, GLOBAL_THRESHOLD_SCOPE, THRESHOLD_CONTEXTS } from "@/db/schema";
import { nowUtcIso } from "@/lib/dates";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession } from "@/lib/session";

/**
 * CASH-005 — read and configure variance exception thresholds. `entityId` is
 * the literal "*" for the group-wide default, otherwise an entity id.
 *
 * Changing a threshold changes which variances the Financial Controller is
 * asked to explain, so every write is audited with the old and new values.
 */

const DECIMAL = /^\d+(\.\d{1,4})?$/;

const upsertSchema = z.object({
  entityId: z.string().min(1),
  // Defaults to 'cash' so existing CASH-005 callers are unchanged.
  context: z.enum(THRESHOLD_CONTEXTS).default("cash"),
  absoluteAmount: z.string().regex(DECIMAL, "Must be a non-negative decimal, e.g. 1000.00"),
  percent: z.string().regex(DECIMAL, "Must be a non-negative decimal, e.g. 1.00").nullable().default(null),
});

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const rows = db.select().from(varianceThresholds).all();
  return NextResponse.json({ thresholds: rows, groupScope: GLOBAL_THRESHOLD_SCOPE });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = upsertSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { entityId, context, absoluteAmount, percent } = parsed.data;

  const previous = db
    .select()
    .from(varianceThresholds)
    .where(and(eq(varianceThresholds.entityId, entityId), eq(varianceThresholds.context, context)))
    .get();

  const now = nowUtcIso();

  db.insert(varianceThresholds)
    .values({
      id: nanoid(),
      entityId,
      context,
      absoluteAmount,
      percent,
      updatedByEmail: actor.email,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      // Must name both columns: the unique index is on the pair, and targeting
      // entityId alone would not match it.
      target: [varianceThresholds.entityId, varianceThresholds.context],
      set: { absoluteAmount, percent, updatedByEmail: actor.email, updatedAt: now },
    })
    .run();

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "variance_threshold.updated",
    entityId: entityId === GLOBAL_THRESHOLD_SCOPE ? undefined : entityId,
    resourceType: "variance_threshold",
    resourceId: `${entityId}:${context}`,
    detail: {
      context,
      from: previous ? { absoluteAmount: previous.absoluteAmount, percent: previous.percent } : null,
      to: { absoluteAmount, percent },
    },
  });

  return NextResponse.json({ ok: true });
}
