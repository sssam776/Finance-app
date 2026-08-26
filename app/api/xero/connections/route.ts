import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { xeroConnections, xeroApps, syncRuns } from "@/db/schema";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { requireSession } from "@/lib/session";
import { connectionHealth } from "@/lib/xero/connectionHealth";

/**
 * Spec 17.6: connection status, capacity used/remaining, last successful and
 * last attempted sync, records read, and a stale-data warning. Without these
 * a connection that quietly stopped syncing is indistinguishable from a
 * healthy one, and the Cash Position looks current when it is not.
 */

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const rows = db
    .select({
      id: xeroConnections.id,
      xeroAppId: xeroConnections.xeroAppId,
      appDisplayName: xeroApps.displayName,
      appEnvironment: xeroApps.environment,
      appTier: xeroApps.tier,
      appConnectionLimit: xeroApps.connectionLimit,
      appComplianceStatus: xeroApps.complianceStatus,
      xeroTenantId: xeroConnections.xeroTenantId,
      xeroOrganisationName: xeroConnections.xeroOrganisationName,
      status: xeroConnections.status,
      lastConnectedAt: xeroConnections.lastConnectedAt,
      lastSuccessfulCallAt: xeroConnections.lastSuccessfulCallAt,
    })
    .from(xeroConnections)
    .innerJoin(xeroApps, eq(xeroConnections.xeroAppId, xeroApps.id))
    .all();

  const now = Date.now();

  // Capacity is per app, so count once per app rather than per row. Matches the
  // OAuth start route: disconnected and disabled connections free their slot.
  const occupiedByApp = new Map<string, number>();
  for (const appId of new Set(rows.map((r) => r.xeroAppId))) {
    const occupied = db
      .select({ id: xeroConnections.id })
      .from(xeroConnections)
      .where(
        and(
          eq(xeroConnections.xeroAppId, appId),
          notInArray(xeroConnections.status, ["disconnected", "disabled"])
        )
      )
      .all();
    occupiedByApp.set(appId, occupied.length);
  }

  const connections = rows.map((row) => {
    const lastRun = db
      .select({
        id: syncRuns.id,
        status: syncRuns.status,
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
        recordsRead: syncRuns.recordsRead,
        error: syncRuns.error,
      })
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, row.id))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1)
      .get();

    const used = occupiedByApp.get(row.xeroAppId) ?? 0;

    return {
      ...row,
      health: connectionHealth(row, now),
      capacity: {
        used,
        limit: row.appConnectionLimit,
        remaining: Math.max(0, row.appConnectionLimit - used),
      },
      lastSyncRun: lastRun ?? null,
    };
  });

  return NextResponse.json({
    connections,
    needsAttentionCount: connections.filter((c) => c.health.needsAttention).length,
  });
}
