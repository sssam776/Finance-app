import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { xeroOauthStates, xeroConnections } from "@/db/schema";
import { resolveXeroApp, buildXeroClient } from "@/lib/xero/appRegistry";
import { capacityFailureReason } from "@/lib/xero/compliance";
import { nowUtcIso } from "@/lib/dates";
import { recordAuditEvent } from "@/lib/audit";
import { requireSession } from "@/lib/session";

const STATE_TTL_MS = 10 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ appKey: string }> }) {
  const actor = await requireSession("admin");
  if (actor instanceof NextResponse) return actor;

  const { appKey } = await params;

  let app;
  try {
    app = await resolveXeroApp(appKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  // Spec 7.6.7: capacity is checked before the consent URL is built, so a full
  // app never sends someone to Xero to approve access that cannot be stored.
  // Disconnected and disabled connections do not occupy a slot.
  const occupiedSlots = db
    .select({ id: xeroConnections.id })
    .from(xeroConnections)
    .where(
      and(
        eq(xeroConnections.xeroAppId, app.id),
        notInArray(xeroConnections.status, ["disconnected", "disabled"])
      )
    )
    .all();

  const capacityProblem = capacityFailureReason(app, occupiedSlots.length);
  if (capacityProblem) {
    await recordAuditEvent({
      actorEmail: actor.email,
      action: "xero_oauth.capacity_blocked",
      resourceType: "xero_app",
      resourceId: app.id,
      detail: { occupied: occupiedSlots.length, limit: app.connectionLimit, tier: app.tier },
    });
    return NextResponse.json({ error: capacityProblem }, { status: 409 });
  }

  // Whoever authorises a Xero organisation is recorded from their session and
  // carried through the state record into xero_authorizations, so the consent
  // trail names a real account rather than a posted string.
  const initiatingUserEmail = actor.email;

  const state = nanoid(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS).toISOString();

  db.insert(xeroOauthStates)
    .values({
      id: nanoid(),
      xeroAppId: app.id,
      state,
      initiatingUserEmail,
      intendedPurpose: app.purpose,
      expiresAt,
      createdAt: nowUtcIso(),
      updatedAt: nowUtcIso(),
    })
    .run();

  let consentUrl: string;
  try {
    const client = buildXeroClient(app, state);
    consentUrl = await client.buildConsentUrl();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await recordAuditEvent({
    actorEmail: initiatingUserEmail,
    action: "xero_oauth.start",
    resourceType: "xero_app",
    resourceId: app.id,
  });

  // Handed back as JSON for the caller to navigate to, rather than returned as
  // a 303.
  //
  // A cross-origin redirect cannot be followed by fetch(). The browser follows
  // the 303 to login.xero.com, which sends no CORS headers, so the request
  // rejects as a network error before any status or Location can be read — the
  // consent screen never opens and the caller cannot say why.
  //
  // Navigating from the client keeps the capacity 409 and the credential 500
  // readable in the page, which is the reason this is a fetch rather than a
  // plain form post in the first place.
  return NextResponse.json({ consentUrl });
}
