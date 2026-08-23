import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { entityXeroAppAssignments, xeroConnections } from "@/db/schema";
import { nowUtcIso } from "@/lib/dates";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession } from "@/lib/session";

/**
 * Enforces spec 7.6.3: no entity may have two active same-purpose
 * assignments outside a migration window. Creating a new active assignment
 * retires whichever one it supersedes rather than allowing both to stand.
 */

// `createdBy` is deliberately absent: it comes from the session, not the body.
const createSchema = z.object({
  entityId: z.string().min(1),
  purpose: z.enum(["read_core", "controlled_write", "payroll_draft", "demo", "migration"]),
  connectionId: z.string().min(1),
});

export async function GET(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");
  const rows = entityId
    ? db.select().from(entityXeroAppAssignments).where(eq(entityXeroAppAssignments.entityId, entityId)).all()
    : db.select().from(entityXeroAppAssignments).all();
  return NextResponse.json({ assignments: rows });
}

export async function POST(request: Request) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { entityId, purpose, connectionId } = parsed.data;
  const createdBy = actor.email;

  const connection = db.select().from(xeroConnections).where(eq(xeroConnections.id, connectionId)).get();
  if (!connection) {
    return NextResponse.json({ error: "Unknown connectionId" }, { status: 404 });
  }

  const now = nowUtcIso();

  const existingActive = db
    .select()
    .from(entityXeroAppAssignments)
    .where(
      and(
        eq(entityXeroAppAssignments.entityId, entityId),
        eq(entityXeroAppAssignments.purpose, purpose),
        eq(entityXeroAppAssignments.status, "active")
      )
    )
    .all();

  for (const row of existingActive) {
    db.update(entityXeroAppAssignments)
      .set({ status: "retired", effectiveTo: now, updatedAt: now })
      .where(eq(entityXeroAppAssignments.id, row.id))
      .run();
  }

  const id = nanoid();
  db.insert(entityXeroAppAssignments)
    .values({
      id,
      entityId,
      purpose,
      xeroAppId: connection.xeroAppId,
      connectionId,
      effectiveFrom: now,
      status: "active",
      createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  await recordAuditEvent({
    actorEmail: createdBy,
    action: "entity_xero_app_assignment.created",
    entityId,
    resourceType: "entity_xero_app_assignment",
    resourceId: id,
    detail: { purpose, connectionId, retiredCount: existingActive.length },
  });

  return NextResponse.json({ id }, { status: 201 });
}
