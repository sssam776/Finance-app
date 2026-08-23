import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { users, auditEvents } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { createSession, setSessionCookie } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso } from "@/lib/dates";
import { throttleDecision, WINDOW_MS } from "@/lib/loginThrottle";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Verified against a throwaway hash when the email is unknown, so a missing
 * user costs the same scrypt work as a wrong password. Without this, response
 * timing tells an attacker which addresses are real.
 */
let dummyHash: string | null = null;
function decoyHash(): string {
  if (!dummyHash) dummyHash = hashPassword("not-a-real-password");
  return dummyHash;
}

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();

  // Counted from the audit trail itself, so throttling and the recorded
  // history can never disagree. ISO-8601 strings sort lexicographically, so a
  // string comparison is a valid time comparison here.
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const recentFailures = db
    .select({ createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, "auth.login_failed"), eq(auditEvents.actorEmail, email), gte(auditEvents.createdAt, since)))
    .all();

  const throttle = throttleDecision(
    recentFailures.map((r) => r.createdAt),
    Date.now()
  );

  if (throttle.blocked) {
    await recordAuditEvent({
      actorEmail: email,
      action: "auth.login_throttled",
      detail: { recentFailures: throttle.recentFailures },
    });
    return NextResponse.json(
      { error: "Too many failed attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
    );
  }

  const user = db.select().from(users).where(eq(users.email, email)).get();
  const passwordOk = verifyPassword(parsed.data.password, user?.passwordHash ?? decoyHash());

  if (!user || !passwordOk || user.status !== "active") {
    await recordAuditEvent({
      actorEmail: email,
      action: "auth.login_failed",
      resourceType: "user",
      resourceId: user?.id,
      detail: { reason: !user ? "unknown_email" : !passwordOk ? "bad_password" : "disabled" },
    });
    // One message for every failure mode — never confirm which part was wrong.
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { token } = createSession(user.id);

  db.update(users)
    .set({ lastLoginAt: nowUtcIso(), updatedAt: nowUtcIso() })
    .where(eq(users.id, user.id))
    .run();

  await recordAuditEvent({
    actorEmail: user.email,
    action: "auth.login",
    resourceType: "user",
    resourceId: user.id,
  });

  const response = NextResponse.json({
    user: { email: user.email, displayName: user.displayName, role: user.role },
  });
  setSessionCookie(response, token);
  return response;
}
