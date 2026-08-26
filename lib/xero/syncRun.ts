import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { syncRuns, xeroConnections } from "@/db/schema";
import { nowUtcIso } from "../dates";
import { recordAuditEvent } from "../audit";
import type { ResolvedXeroRoute } from "./gateway";

/**
 * The start/complete/fail envelope every Xero read shares (spec 10.5): open a
 * sync run, write rows carrying its id as lineage, then close the run and
 * update the connection's health in the same breath.
 *
 * Extracted because every module that reads Xero needs it, and eight separate
 * copies would be eight places for the connection status to drift out of step
 * with the run status. A partially-updated pair is how a broken connection
 * ends up looking healthy.
 */

export type SyncRunId = string;

export function startSyncRun(input: {
  route: ResolvedXeroRoute;
  resource: string;
}): SyncRunId {
  const now = nowUtcIso();
  const id = nanoid();

  db.insert(syncRuns)
    .values({
      id,
      xeroAppId: input.route.xeroAppId,
      connectionId: input.route.connectionId,
      entityId: input.route.entityId,
      resource: input.resource,
      status: "running",
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return id;
}

export async function completeSyncRun(input: {
  syncRunId: SyncRunId;
  route: ResolvedXeroRoute;
  actorEmail: string;
  recordsRead: number;
  /**
   * A run that hit a call cap or skipped a page read `partial`, not `complete`.
   * The distinction matters downstream: a partial run must not be treated as a
   * full refresh of the resource.
   */
  partial?: boolean;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const now = nowUtcIso();

  db.update(syncRuns)
    .set({
      status: input.partial ? "partial" : "complete",
      recordsRead: input.recordsRead,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(syncRuns.id, input.syncRunId))
    .run();

  db.update(xeroConnections)
    .set({ lastSuccessfulCallAt: now, status: "healthy", updatedAt: now })
    .where(eq(xeroConnections.id, input.route.connectionId))
    .run();

  await recordAuditEvent({
    actorEmail: input.actorEmail,
    action: input.partial ? "xero_sync.partial" : "xero_sync.complete",
    entityId: input.route.entityId,
    resourceType: "sync_run",
    resourceId: input.syncRunId,
    detail: { recordsRead: input.recordsRead, ...input.detail },
  });
}

export async function failSyncRun(input: {
  syncRunId: SyncRunId;
  route: ResolvedXeroRoute;
  actorEmail: string;
  error: unknown;
}): Promise<string> {
  const message = input.error instanceof Error ? input.error.message : "Unknown sync error";
  const now = nowUtcIso();

  db.update(syncRuns)
    .set({ status: "failed", error: message, finishedAt: now, updatedAt: now })
    .where(eq(syncRuns.id, input.syncRunId))
    .run();

  db.update(xeroConnections)
    .set({ status: "sync_error", updatedAt: now })
    .where(eq(xeroConnections.id, input.route.connectionId))
    .run();

  await recordAuditEvent({
    actorEmail: input.actorEmail,
    action: "xero_sync.failed",
    entityId: input.route.entityId,
    resourceType: "sync_run",
    resourceId: input.syncRunId,
    detail: { error: message },
  });

  return message;
}
