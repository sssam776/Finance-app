import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { entities } from "@/db/schema";
import { requireSession, entityAccessFor } from "@/lib/session";
import { filterByEntityAccess } from "@/lib/entityAccess";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  // `entities.id` is the entity id here, so the shared filter needs it named
  // as `entityId` to apply the same rule every other route uses.
  const rows = filterByEntityAccess(
    entityAccessFor(actor),
    db
      .select()
      .from(entities)
      .all()
      .map((e) => ({ ...e, entityId: e.id }))
  ).map(({ entityId: _ignored, ...entity }) => entity);
  return NextResponse.json({ entities: rows });
}
