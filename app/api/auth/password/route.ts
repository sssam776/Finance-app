import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { users, sessions } from "@/db/schema";
import { hashPassword, verifyPassword, hashSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { passwordProblem } from "@/lib/passwordPolicy";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso } from "@/lib/dates";

/**
 * Password rotation (spec 15.1). Without this, changing the seeded admin
 * credential meant re-seeding against a fresh email.
 *
 * Requires the current password even though the caller already holds a valid
 * session: it stops a borrowed logged-in browser from locking the real owner
 * out of their own account.
 */

const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function POST(request: Request) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const parsed = changeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Current and new password are required" }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = db.select().from(users).where(eq(users.id, actor.id)).get();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    await recordAuditEvent({
      actorEmail: user.email,
      action: "auth.password_change_failed",
      resourceType: "user",
      resourceId: user.id,
      detail: { reason: "current_password_incorrect" },
    });
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }

  const problem = passwordProblem(newPassword, user.email);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  if (verifyPassword(newPassword, user.passwordHash)) {
    return NextResponse.json({ error: "New password must differ from the current one" }, { status: 400 });
  }

  const now = nowUtcIso();
  db.update(users)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: now })
    .where(eq(users.id, user.id))
    .run();

  // Every other session for this user dies. If the password was changed
  // because someone else had access, leaving their session alive would defeat
  // the point. The current browser keeps working.
  const currentToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const currentSessionId = currentToken ? hashSessionToken(currentToken) : "";

  const revoked = db
    .delete(sessions)
    .where(and(eq(sessions.userId, user.id), ne(sessions.id, currentSessionId)))
    .run();

  await recordAuditEvent({
    actorEmail: user.email,
    action: "auth.password_changed",
    resourceType: "user",
    resourceId: user.id,
    detail: { otherSessionsRevoked: revoked.changes },
  });

  return NextResponse.json({ ok: true, otherSessionsRevoked: revoked.changes });
}
