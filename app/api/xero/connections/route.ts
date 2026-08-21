import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { xeroConnections, xeroApps } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const rows = db
    .select({
      id: xeroConnections.id,
      xeroAppId: xeroConnections.xeroAppId,
      appDisplayName: xeroApps.displayName,
      appEnvironment: xeroApps.environment,
      xeroTenantId: xeroConnections.xeroTenantId,
      xeroOrganisationName: xeroConnections.xeroOrganisationName,
      status: xeroConnections.status,
      lastConnectedAt: xeroConnections.lastConnectedAt,
      lastSuccessfulCallAt: xeroConnections.lastSuccessfulCallAt,
    })
    .from(xeroConnections)
    .innerJoin(xeroApps, eq(xeroConnections.xeroAppId, xeroApps.id))
    .all();

  return NextResponse.json({ connections: rows });
}
