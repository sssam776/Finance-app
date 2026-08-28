import { eq, and } from "drizzle-orm";
import { XeroClient, TokenSet } from "xero-node";
import { db } from "@/db/client";
import { entityXeroAppAssignments, xeroConnections, xeroAuthorizations } from "@/db/schema";
import { resolveXeroAppById, buildXeroClient, type XeroAppRow } from "./appRegistry";
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

/** Refresh this far ahead of expiry so an in-flight call cannot age out mid-request. */
const REFRESH_SKEW_MS = 60_000;

/** Bounded wait for a peer's refresh: 10 × 200ms. Longer than a refresh, shorter than a user's patience. */
const PEER_REFRESH_ATTEMPTS = 10;
const PEER_REFRESH_INTERVAL_MS = 200;

type AuthorizationRow = typeof xeroAuthorizations.$inferSelect;

function loadAuthorization(authorizationId: string): AuthorizationRow {
  const row = db
    .select()
    .from(xeroAuthorizations)
    .where(eq(xeroAuthorizations.id, authorizationId))
    .get();
  if (!row) {
    throw new Error(`Authorization ${authorizationId} not found`);
  }
  return row;
}

function clientWithStoredTokens(app: XeroAppRow, authorization: AuthorizationRow) {
  const payload = deserializeEncryptedPayload(authorization.encryptedTokenSet);
  const tokenSet = new TokenSet(JSON.parse(decryptTokenSet(payload)));
  const client = buildXeroClient(app);
  client.setTokenSet(tokenSet);
  return { client, tokenSet };
}

function needsRefresh(tokenSet: TokenSet): boolean {
  return (tokenSet.expires_at ?? 0) * 1000 < Date.now() + REFRESH_SKEW_MS;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Another request won the refresh claim. Poll for the token set it writes
 * rather than refreshing in parallel — Xero invalidates the previous refresh
 * token when it issues a new one, so a second concurrent refresh would leave
 * one of the two callers holding a token that is already dead.
 */
async function awaitPeerRefresh(app: XeroAppRow, authorizationId: string): Promise<XeroClient> {
  for (let attempt = 0; attempt < PEER_REFRESH_ATTEMPTS; attempt += 1) {
    await sleep(PEER_REFRESH_INTERVAL_MS);

    const fresh = loadAuthorization(authorizationId);
    if (fresh.lastRefreshError) {
      throw new Error(`Concurrent token refresh failed: ${fresh.lastRefreshError}`);
    }

    const { client, tokenSet } = clientWithStoredTokens(app, fresh);
    if (!needsRefresh(tokenSet)) return client;
  }

  throw new Error(
    `Timed out waiting for a concurrent refresh of authorization ${authorizationId} to complete`
  );
}

/**
 * Hydrates a XeroClient with the decrypted, refreshed-if-needed token set for
 * a resolved route.
 *
 * Spec 8.5 concurrency control is a compare-and-swap on `refresh_version`
 * rather than a Durable Object: exactly one caller can move the version from
 * N to N+1, so exactly one caller refreshes. The losers wait for that result.
 * On Cloudflare this becomes the same CAS against D1 — see ADR-002.
 */
export async function getAuthenticatedClient(
  route: ResolvedXeroRoute
): Promise<{ client: XeroClient; tenantId: string }> {
  const app = await resolveXeroAppById(route.xeroAppId);
  const authorization = loadAuthorization(route.authorizationId);
  const { client, tokenSet } = clientWithStoredTokens(app, authorization);

  if (!needsRefresh(tokenSet)) {
    return { client, tenantId: route.tenantId };
  }

  const claim = db
    .update(xeroAuthorizations)
    .set({
      refreshVersion: authorization.refreshVersion + 1,
      // Cleared as part of the claim so a waiter cannot mistake an error from
      // an earlier, already-superseded refresh for this attempt's outcome.
      lastRefreshError: null,
      updatedAt: nowUtcIso(),
    })
    .where(
      and(
        eq(xeroAuthorizations.id, authorization.id),
        eq(xeroAuthorizations.refreshVersion, authorization.refreshVersion)
      )
    )
    .run();

  if (claim.changes === 0) {
    return { client: await awaitPeerRefresh(app, authorization.id), tenantId: route.tenantId };
  }

  try {
    /**
     * `refreshToken()` reaches straight for `this.openIdClient` with no guard,
     * unlike `buildConsentUrl()` and `apiCallback()`, which both lazily call
     * `initialize()` first (XeroClient.js:83, :99, :133). A client built here
     * has never been through either of those paths, so its `openIdClient` is
     * undefined and the refresh throws a TypeError rather than failing as an
     * auth error.
     *
     * Initialised only on the refresh branch. It performs OIDC discovery
     * against identity.xero.com, and ordinary API calls authenticate with the
     * stored access token and never touch it.
     */
    await client.initialize();

    const refreshed = await client.refreshToken();
    const now = nowUtcIso();
    const encrypted = encryptTokenSet(JSON.stringify(refreshed), CURRENT_KEY_VERSION);

    db.update(xeroAuthorizations)
      .set({
        encryptedTokenSet: serializeEncryptedPayload(encrypted),
        encryptionKeyVersion: CURRENT_KEY_VERSION,
        tokenExpiresAt: new Date((refreshed.expires_at ?? 0) * 1000).toISOString(),
        // refreshVersion was already advanced by the claim above.
        lastRefreshAt: now,
        lastRefreshError: null,
        status: "active",
        updatedAt: now,
      })
      .where(eq(xeroAuthorizations.id, authorization.id))
      .run();

    return { client, tenantId: route.tenantId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown refresh error";
    // Record the failure so waiters fail fast instead of polling to timeout.
    db.update(xeroAuthorizations)
      .set({ lastRefreshError: message, status: "error", updatedAt: nowUtcIso() })
      .where(eq(xeroAuthorizations.id, authorization.id))
      .run();
    throw err;
  }
}
