import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { entities } from "@/db/schema";
import { requireSession } from "@/lib/session";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const rows = db.select().from(entities).all();
  return NextResponse.json({ entities: rows });
}
