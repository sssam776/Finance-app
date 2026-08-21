import { eq, and } from "drizzle-orm";
import { XeroClient, TokenSet } from "xero-node";
import { db } from "@/db/client";
import { entityXeroAppAssignments, xeroConnections, xeroAuthorizations } from "@/db/schema";
import { resolveXeroAppById, buildXeroClient } from "./appRegistry";
import {
  decryptTokenSet,
  deserializeEncryptedPayload,
  encryptTokenSet,
  serializeEncryptedPayload,
  CURRENT_KEY_VERSION,
} from "./crypto";
import { nowUtcIso } from "../dates";

export type XeroPurpose = "read_core" | "controlled_write" | "payroll_draft" | "demo" | "migration";

export interface ResolvedXeroRoute {
  entityId: string;
  purpose: XeroPurpose;
  xeroAppId: string;
  authorizationId: string;
  connectionId: string;
  tenantId: string;
}

/**
 * Resolves the single active, effective-dated assignment for an
 * entity/purpose — never a client ID chosen by a route or component
 * directly (spec 10.1). Fails closed on zero or multiple matches.
 */
export async function resolveXeroRoute(entityId: string, purpose: XeroPurpose): Promise<ResolvedXeroRoute> {
  const assignments = db
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

  if (assignments.length === 0) {
    throw new Error(`No active ${purpose} Xero app assignment for entity ${entityId}`);
  }
  if (assignments.length > 1) {
    throw new Error(
      `Multiple active ${purpose} assignments for entity ${entityId} — this must never happen outside a migration window`
    );
  }
  const assignment = assignments[0]!;

  const connection = db
    .select()
    .from(xeroConnections)
    .where(eq(xeroConnections.id, assignment.connectionId))
    .get();
  if (!connection) {
    throw new Error(`Assignment ${assignment.id} points at a missing connection`);
  }

  return {
    entityId,
    purpose,
    xeroAppId: assignment.xeroAppId,
    authorizationId: connection.authorizationId,
    connectionId: connection.id,
    tenantId: connection.xeroTenantId,
  };
}

/**
 * Hydrates a XeroClient with the decrypted, refreshed-if-needed token set
 * for a resolved route. Concurrent-refresh locking (spec 8.5) is a known
 * gap in this quick version — see docs/implementation-plan.md.
 */
export async function getAuthenticatedClient(
  route: ResolvedXeroRoute
): Promise<{ client: XeroClient; tenantId: string }> {
  const app = await resolveXeroAppById(route.xeroAppId);
  const authorization = db
    .select()
    .from(xeroAuthorizations)
    .where(eq(xeroAuthorizations.id, route.authorizationId))
    .get();
  if (!authorization) {
    throw new Error(`Authorization ${route.authorizationId} not found`);
  }

  const payload = deserializeEncryptedPayload(authorization.encryptedTokenSet);
  const tokenSetJson = decryptTokenSet(payload);
  const tokenSet = new TokenSet(JSON.parse(tokenSetJson));

  const client = buildXeroClient(app);
  client.setTokenSet(tokenSet);

  const expiresAtMs = (tokenSet.expires_at ?? 0) * 1000;
  if (expiresAtMs < Date.now() + 60_000) {
    const refreshed = await client.refreshToken();
    const now = nowUtcIso();
    const encrypted = encryptTokenSet(JSON.stringify(refreshed), CURRENT_KEY_VERSION);
    db.update(xeroAuthorizations)
      .set({
        encryptedTokenSet: serializeEncryptedPayload(encrypted),
        encryptionKeyVersion: CURRENT_KEY_VERSION,
        tokenExpiresAt: new Date((refreshed.expires_at ?? 0) * 1000).toISOString(),
        refreshVersion: authorization.refreshVersion + 1,
        lastRefreshAt: now,
        lastRefreshError: null,
        updatedAt: now,
      })
      .where(eq(xeroAuthorizations.id, authorization.id))
      .run();
  }

  return { client, tenantId: route.tenantId };
}
