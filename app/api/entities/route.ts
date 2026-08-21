import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { entities } from "@/db/schema";

export async function GET() {
  const rows = db.select().from(entities).all();
  return NextResponse.json({ entities: rows });
}
