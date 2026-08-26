import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { entityPermissions, users, entities } from "@/db/schema";
import { nowUtcIso } from "@/lib/dates";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession } from "@/lib/session";

/**
 * Grants and revokes per-entity access (spec 14.1).
 *
 * Deliberately NOT scoped by the caller's own entity access: granting rights
 * is a system-administration action, and an admin restricted to two entities
 * should not be able to hand out access to those two entities either. Only an
 * unrestricted admin can reach these routes in practice, because the first
 * grant against an admin scopes them.
 */

const grantSchema = z.object({
  userId: z.string().min(1),
  entityId: z.string().min(1),
});

export async function GET(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const userId = new URL(request.url).searchParams.get("userId");

  const rows = db
    .select({
      id: entityPermissions.id,
      userId: entityPermissions.userId,
      userEmail: users.email,
      entityId: entityPermissions.entityId,
      entityShortCode: entities.shortCode,
      grantedByEmail: entityPermissions.grantedByEmail,
      createdAt: entityPermissions.createdAt,
    })
    .from(entityPermissions)
    .innerJoin(users, eq(entityPermissions.userId, users.id))
    .innerJoin(entities, eq(entityPermissions.entityId, entities.id))
    .where(userId ? eq(entityPermissions.userId, userId) : undefined)
    .all();

  return NextResponse.json({ permissions: rows });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = grantSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "userId and entityId are required" }, { status: 400 });
  }
  const { userId, entityId } = parsed.data;

  // Both checked so a typo produces 404 rather than a foreign-key error, and
  // so the audit record names things that exist.
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return NextResponse.json({ error: "Unknown userId" }, { status: 404 });

  const entity = db.select().from(entities).where(eq(entities.id, entityId)).get();
  if (!entity) return NextResponse.json({ error: "Unknown entityId" }, { status: 404 });

  const now = nowUtcIso();
  db.insert(entityPermissions)
    .values({
      id: nanoid(),
      userId,
      entityId,
      grantedByEmail: actor.email,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "entity_permission.granted",
    entityId,
    resourceType: "entity_permission",
    resourceId: userId,
    detail: { grantedTo: user.email, entity: entity.shortCode },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const parsed = grantSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "userId and entityId are required" }, { status: 400 });
  }
  const { userId, entityId } = parsed.data;

  const removed = db
    .delete(entityPermissions)
    .where(and(eq(entityPermissions.userId, userId), eq(entityPermissions.entityId, entityId)))
    .run();

  await recordAuditEvent({
    actorEmail: actor.email,
    action: "entity_permission.revoked",
    entityId,
    resourceType: "entity_permission",
    resourceId: userId,
    detail: { removed: removed.changes },
  });

  // Revoking the last grant returns an admin to unrestricted access, per the
  // rule in lib/entityAccess.ts. Said out loud here because it surprises people.
  const remaining = db
    .select({ id: entityPermissions.id })
    .from(entityPermissions)
    .where(eq(entityPermissions.userId, userId))
    .all();

  return NextResponse.json({
    ok: true,
    removed: removed.changes,
    remainingGrants: remaining.length,
    note:
      remaining.length === 0
        ? "This user now has no explicit grants: an admin reverts to all entities, a viewer to none."
        : undefined,
  });
}
