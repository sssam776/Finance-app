import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq, and, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { xeroOauthStates, xeroAuthorizations, xeroConnections } from "@/db/schema";
import { resolveXeroAppById, buildXeroClient } from "@/lib/xero/appRegistry";
import { capacityFailureReason } from "@/lib/xero/compliance";
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

  /**
   * Everything past this point can fail, and until now none of it was caught:
   * the route threw, Next returned a bare 500, and the only description of
   * what went wrong was in the server's own console. The person it happened to
   * saw an empty error page after handing their accounting credentials over.
   *
   * The state is deliberately still consumed above rather than here. It is a
   * one-time value and replay protection has to hold even when the exchange
   * fails, so a failure means restarting the connection — which the message
   * below says, instead of leaving someone to retry a URL that cannot work.
   */
  let tokenSet;
  let tenants;
  try {
    /**
     * The state has to be handed back to the client, not just checked above.
     * `apiCallback` verifies the state on the callback URL against
     * `config.state` (XeroClient.js:103), so a client built without it rejects
     * every callback with "checks.state argument is missing" — the exchange
     * never even reaches Xero.
     *
     * The value comes from the stored one-time record rather than from the
     * query string, so the check compares Xero's parameter against what this
     * server issued rather than against itself.
     */
    const client = buildXeroClient(app, stateRow.state);
    tokenSet = await client.apiCallback(request.url);
    tenants = await client.updateTenants(false);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    await recordAuditEvent({
      actorEmail: stateRow.initiatingUserEmail,
      action: "xero_oauth.callback_failed",
      resourceType: "xero_app",
      resourceId: app.id,
      detail: { message },
    });

    return NextResponse.json(
      {
        error: `Xero authorisation could not be completed: ${message}`,
        appKey: app.appKey,
        hint: "The one-time state has been consumed, so this link cannot be retried. Start the connection again from /xero.",
      },
      { status: 502 }
    );
  }

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

  // The start route checks capacity before sending anyone to Xero, but two
  // flows begun while four of five slots were used would both have passed.
  // Re-checked here, immediately before each insert, because this is the point
  // where a slot is actually consumed. Reconnecting an organisation that
  // already has a row occupies no new slot, so it is never blocked.
  const skippedForCapacity: string[] = [];

  for (const tenant of tenants) {
    const existing = db
      .select()
      .from(xeroConnections)
      .where(and(eq(xeroConnections.xeroAppId, app.id), eq(xeroConnections.xeroTenantId, tenant.tenantId)))
      .get();

    if (!existing) {
      const occupied = db
        .select({ id: xeroConnections.id })
        .from(xeroConnections)
        .where(
          and(
            eq(xeroConnections.xeroAppId, app.id),
            notInArray(xeroConnections.status, ["disconnected", "disabled"])
          )
        )
        .all();

      if (capacityFailureReason(app, occupied.length)) {
        skippedForCapacity.push(tenant.tenantName ?? tenant.tenantId);
        continue;
      }
    }

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
    detail: {
      tenantsConnected: tenants.length - skippedForCapacity.length,
      skippedForCapacity,
    },
  });

  const target = new URL("/xero", request.url);
  if (skippedForCapacity.length) {
    // Surfaced rather than silent: the user authorised these organisations in
    // Xero and would otherwise be left wondering why they never appeared.
    target.searchParams.set("capacityBlocked", skippedForCapacity.join(", "));
  }
  return NextResponse.redirect(target);
}
