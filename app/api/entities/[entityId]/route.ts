import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { entities } from "@/db/schema";
import { requireSession, entityAccessFor } from "@/lib/session";
import { canAccessEntity } from "@/lib/entityAccess";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso } from "@/lib/dates";

/**
 * Records the Phase 0 confirmation that an entity's Xero position is known.
 *
 * Every entity seeds as `unverified` because spec 7.1 requires someone to
 * confirm which legal entities have their own Xero organisation before any
 * figure is treated as live. Until now there was no way to record that
 * confirmation, so the label could never come off — including for entities
 * that had demonstrably been connected. A status nobody can change is not a
 * control, it is decoration.
 *
 * Admin only, and written against the signed-in user. Confirming an entity is
 * an assertion someone is making about the client's corporate structure, so it
 * carries a name and a timestamp.
 */

const ENTITY_STATUSES = ["active", "dormant", "excluded", "unverified"] as const;

const bodySchema = z.object({
  status: z.enum(ENTITY_STATUSES),
  /**
   * Required when moving away from `unverified`. Confirming is a judgement
   * about the client's structure, and an audit row saying only "someone set
   * this to active" answers none of the questions asked later.
   */
  note: z.string().trim().min(1).max(500).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ entityId: string }> }) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const { entityId } = await params;

  const entity = db.select().from(entities).where(eq(entities.id, entityId)).get();
  if (!entity) {
    return NextResponse.json({ error: "Unknown entity" }, { status: 404 });
  }

  // A scoped admin is restricted to their granted entities here exactly as
  // everywhere else; role alone is not authority over every entity.
  if (!canAccessEntity(entityAccessFor(actor), entity.id)) {
    return NextResponse.json({ error: "No access to this entity" }, { status: 403 });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  const { status, note } = parsed.data;

  if (status === entity.status) {
    return NextResponse.json({ entity, changed: false });
  }

  if (entity.status === "unverified" && !note) {
    return NextResponse.json(
      {
        error:
          "A note is required when confirming an entity. Record what confirms it — the Xero organisation it was matched to, or who confirmed the structure.",
      },
      { status: 400 }
    );
  }

  db.update(entities)
    .set({ status, updatedAt: nowUtcIso() })
    .where(eq(entities.id, entity.id))
    .run();

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "entity.status_changed",
    entityId: entity.id,
    resourceType: "entity",
    resourceId: entity.id,
    detail: { from: entity.status, to: status, note: note ?? null },
  });

  return NextResponse.json({
    entity: { ...entity, status },
    changed: true,
  });
}
