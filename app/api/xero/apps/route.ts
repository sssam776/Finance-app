import { NextResponse } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { xeroApps, xeroConnections } from "@/db/schema";
import { requireSession } from "@/lib/session";

/**
 * The Xero app registrations available to connect through.
 *
 * The connect button previously targeted one hard-coded app key, which made a
 * second registration unreachable from the interface even though the OAuth
 * start route has always been keyed by app. This is the list that button needs.
 *
 * Capacity is reported per app and counted the same way the start route and the
 * connections view count it — disconnected and disabled connections release
 * their slot. Spec 7.6.2 forbids the router choosing an app because it happens
 * to have room, so this endpoint reports capacity for a person to decide with
 * and never picks on their behalf.
 */
export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const apps = db.select().from(xeroApps).where(eq(xeroApps.enabled, true)).all();

  const rows = apps.map((app) => {
    const occupied = db
      .select({ id: xeroConnections.id })
      .from(xeroConnections)
      .where(
        and(
          eq(xeroConnections.xeroAppId, app.id),
          notInArray(xeroConnections.status, ["disconnected", "disabled"])
        )
      )
      .all().length;

    return {
      appKey: app.appKey,
      displayName: app.displayName,
      environment: app.environment,
      purpose: app.purpose,
      tier: app.tier,
      connectionLimit: app.connectionLimit,
      complianceStatus: app.complianceStatus,
      connectionsUsed: occupied,
      connectionsRemaining: Math.max(0, app.connectionLimit - occupied),
      atCapacity: occupied >= app.connectionLimit,
      /**
       * Whether both credentials are present in the environment — never their
       * values. An app registered in the database but missing its secret fails
       * only at the moment someone tries to connect, which is a confusing place
       * to discover a configuration gap.
       */
      configured:
        Boolean(process.env[app.clientIdSecretRef]) &&
        Boolean(process.env[app.clientSecretSecretRef]),
      /** The variable names to set, so a missing secret says which one. */
      clientIdEnvVar: app.clientIdSecretRef,
      clientSecretEnvVar: app.clientSecretSecretRef,
    };
  });

  return NextResponse.json({
    apps: rows,
    multiAppEnabled: process.env.XERO_MULTI_APP_ENABLED === "true",
    totalCapacityRemaining: rows.reduce((sum, r) => sum + r.connectionsRemaining, 0),
  });
}
