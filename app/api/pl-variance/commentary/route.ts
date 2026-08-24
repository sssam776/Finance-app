import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { varianceCommentary, entities } from "@/db/schema";
import { nowUtcIso } from "@/lib/dates";
import { isValidPeriodKey } from "@/lib/periods";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";

/**
 * VAR-004: explanations for a movement.
 *
 * A separate route from the figures on purpose. The variance calculation never
 * reads this table, so nothing written here can change a number there, and the
 * separation is structural rather than a convention someone has to remember.
 */

const createSchema = z.object({
  entityId: z.string().min(1),
  period: z.string().refine(isValidPeriodKey, "period must be YYYY-MM"),
  comparison: z.enum(["prior_month", "prior_year_month", "prior_year_ytd", "budget", "custom"]),
  /** An account name, or "*" for a whole-entity narrative. */
  accountKey: z.string().min(1),
  body: z.string().trim().min(1, "An explanation cannot be empty"),
  origin: z.enum(["user", "ai"]).default("user"),
  citedRowIds: z.array(z.string()).default([]),
  status: z.enum(["draft", "final"]).default("draft"),
});

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId") ?? "";
  const period = url.searchParams.get("period") ?? "";

  if (!entityId || !isValidPeriodKey(period)) {
    return NextResponse.json({ error: "entityId and a YYYY-MM period are required" }, { status: 400 });
  }
  if (!canAccessEntity(entityAccessFor(actor), entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  const rows = db
    .select()
    .from(varianceCommentary)
    .where(
      and(
        eq(varianceCommentary.entityId, entityId),
        eq(varianceCommentary.period, period),
        // Superseded entries stay in the table as history but are not shown as
        // if they still described the current figures.
        eq(varianceCommentary.status, "draft")
      )
    )
    .orderBy(desc(varianceCommentary.updatedAt))
    .all();

  const finalised = db
    .select()
    .from(varianceCommentary)
    .where(
      and(
        eq(varianceCommentary.entityId, entityId),
        eq(varianceCommentary.period, period),
        eq(varianceCommentary.status, "final")
      )
    )
    .orderBy(desc(varianceCommentary.updatedAt))
    .all();

  return NextResponse.json({ commentary: [...finalised, ...rows] });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { entityId, period, comparison, accountKey, body, origin, citedRowIds, status } = parsed.data;

  if (!canAccessEntity(entityAccessFor(actor), entityId)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }
  if (!db.select().from(entities).where(eq(entities.id, entityId)).get()) {
    return NextResponse.json({ error: "Unknown entityId" }, { status: 404 });
  }

  // An AI-written explanation must name the rows it read. Without that there
  // is no way to check it against the figures, and an unverifiable narrative
  // beside real numbers reads as though it were derived from them.
  if (origin === "ai" && citedRowIds.length === 0) {
    return NextResponse.json(
      { error: "AI-authored commentary must cite the rows it was written from." },
      { status: 400 }
    );
  }

  const now = nowUtcIso();

  // A new explanation for the same account supersedes the previous one rather
  // than overwriting it, so the earlier reasoning stays auditable.
  const superseded = db
    .update(varianceCommentary)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(varianceCommentary.entityId, entityId),
        eq(varianceCommentary.period, period),
        eq(varianceCommentary.comparison, comparison),
        eq(varianceCommentary.accountKey, accountKey)
      )
    )
    .run();

  const id = nanoid();
  db.insert(varianceCommentary)
    .values({
      id,
      entityId,
      period,
      comparison,
      accountKey,
      origin,
      body,
      citedRowIds: JSON.stringify(citedRowIds),
      // Authorship comes from the session, never the request body: an audit
      // trail the caller can write is not an audit trail.
      authorEmail: actor.email,
      status,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "variance_commentary.created",
    entityId,
    resourceType: "variance_commentary",
    resourceId: id,
    detail: { period, comparison, accountKey, origin, superseded: superseded.changes },
  });

  return NextResponse.json({ id, supersededPrevious: superseded.changes }, { status: 201 });
}
