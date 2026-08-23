import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db/client";
import { xeroOauthStates } from "@/db/schema";
import { resolveXeroApp, buildXeroClient } from "@/lib/xero/appRegistry";
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

  return NextResponse.redirect(consentUrl, 303);
}
