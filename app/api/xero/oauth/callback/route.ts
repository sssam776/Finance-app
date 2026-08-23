import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { xeroOauthStates, xeroAuthorizations, xeroConnections } from "@/db/schema";
import { resolveXeroAppById, buildXeroClient } from "@/lib/xero/appRegistry";
import { encryptTokenSet, serializeEncryptedPayload, CURRENT_KEY_VERSION } from "@/lib/xero/crypto";
import { nowUtcIso } from "@/lib/dates";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession } from "@/lib/session";

/**
 * The callback resolves the Xero app from the one-time state record created
 * at /oauth/start — never from a free-form query parameter (spec 8.7).
 */

export async function GET(request: Request) {
  // Xero redirects the browser here as a top-level navigation, so the
  // SameSite=lax session cookie is sent and this stays enforceable. The
  // one-time state record is the primary defence; this is the second lock.
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const stateRow = db.select().from(xeroOauthStates).where(eq(xeroOauthStates.state, state)).get();
  if (!stateRow) {
    return NextResponse.json({ error: "Unknown or already-consumed state" }, { status: 400 });
  }
  if (stateRow.consumedAt) {
    return NextResponse.json({ error: "State already consumed" }, { status: 400 });
  }
  if (new Date(stateRow.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: "State expired — restart the connection" }, { status: 400 });
  }

  db.update(xeroOauthStates)
    .set({ consumedAt: nowUtcIso(), updatedAt: nowUtcIso() })
    .where(eq(xeroOauthStates.id, stateRow.id))
    .run();

  const app = await resolveXeroAppById(stateRow.xeroAppId);
  const client = buildXeroClient(app);

  const tokenSet = await client.apiCallback(request.url);
  const tenants = await client.updateTenants(false);

  const now = nowUtcIso();
  const encrypted = encryptTokenSet(JSON.stringify(tokenSet), CURRENT_KEY_VERSION);
  const authorizationId = nanoid();

  db.insert(xeroAuthorizations)
    .values({
      id: authorizationId,
      xeroAppId: app.id,
      encryptedTokenSet: serializeEncryptedPayload(encrypted),
      encryptionKeyVersion: CURRENT_KEY_VERSION,
      tokenExpiresAt: new Date((tokenSet.expires_at ?? 0) * 1000).toISOString(),
      grantedScopes: (tokenSet.scope as string) ?? "",
      status: "active",
      lastRefreshAt: now,
      authorisingUserEmail: stateRow.initiatingUserEmail,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  for (const tenant of tenants) {
    const existing = db
      .select()
      .from(xeroConnections)
      .where(and(eq(xeroConnections.xeroAppId, app.id), eq(xeroConnections.xeroTenantId, tenant.tenantId)))
      .get();

    if (existing) {
      db.update(xeroConnections)
        .set({
          authorizationId,
          xeroOrganisationName: tenant.tenantName,
          xeroTenantType: tenant.tenantType,
          status: "healthy",
          lastConnectedAt: now,
          updatedAt: now,
        })
        .where(eq(xeroConnections.id, existing.id))
        .run();
    } else {
      db.insert(xeroConnections)
        .values({
          id: nanoid(),
          xeroAppId: app.id,
          authorizationId,
          xeroTenantId: tenant.tenantId,
          xeroTenantType: tenant.tenantType,
          xeroOrganisationName: tenant.tenantName,
          status: "healthy",
          firstConnectedAt: now,
          lastConnectedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  await recordAuditEvent({
    actorEmail: stateRow.initiatingUserEmail,
    action: "xero_oauth.callback_completed",
    resourceType: "xero_app",
    resourceId: app.id,
    detail: { tenantsConnected: tenants.length },
  });

  return NextResponse.redirect(new URL("/xero", request.url));
}
