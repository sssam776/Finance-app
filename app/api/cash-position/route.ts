import { NextResponse } from "next/server";
import { computeCashPosition } from "@/lib/cashPosition";
import { requireSession, entityAccessFor } from "@/lib/session";

/**
 * CASH-001..006. The computation lives in lib/cashPosition.ts so that
 * accounting policy stays out of the route layer (REM-001) and later modules
 * can reuse it: they cannot import a route handler.
 *
 * This route is now the session check and the JSON envelope, nothing else.
 */

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  return NextResponse.json(computeCashPosition(entityAccessFor(actor)));
}
