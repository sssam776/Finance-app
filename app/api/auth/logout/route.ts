import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { clearSessionCookie, destroySession, resolveSessionToken } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (token) {
    const user = resolveSessionToken(token);
    // Delete the row, not just the cookie — a copied cookie must die too.
    destroySession(token);
    if (user) {
      await recordAuditEvent({
        actorEmail: user.email,
        action: "auth.logout",
        resourceType: "user",
        resourceId: user.id,
      });
    }
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
