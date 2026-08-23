import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { users, auditEvents } from "@/db/schema";
import { hashPassword, verifyPassword, normaliseEmail } from "@/lib/auth";
import { createSession, setSessionCookie } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso } from "@/lib/dates";
import { combinedThrottleDecision, WINDOW_MS } from "@/lib/loginThrottle";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Verified against a throwaway hash when the email is unknown, so a missing
 * user costs the same scrypt work as a wrong password. Without this, response
 * timing tells an attacker which addresses are real.
 *
 * Built at module load, not on first use. Building it lazily meant the first
 * unknown-email request after a cold start paid for a hash AND a verify, while
 * a known address paid for one verify: roughly double the KDF work, which is
 * exactly the signal the decoy exists to remove.
 */
const DECOY_HASH = hashPassword("not-a-real-password");

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const email = normaliseEmail(parsed.data.email);

  // Counted from the audit trail itself, so throttling and the recorded
  // history can never disagree. ISO-8601 strings sort lexicographically, so a
  // string comparison is a valid time comparison here. Both queries are served
  // by the indexes on audit_events; without them this would be a full scan of
  // a table an unauthenticated caller can grow.
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const emailFailures = db
    .select({ createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, "auth.login_failed"), eq(auditEvents.actorEmail, email), gte(auditEvents.createdAt, since)))
    .all();

  // Counted across every address: per-email limits alone are bypassed by
  // varying the address, which otherwise leaves scrypt reachable on every
  // request and writes an audit row each time.
  const globalFailures = db
    .select({ createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, "auth.login_failed"), gte(auditEvents.createdAt, since)))
    .all();

  const throttle = combinedThrottleDecision(
    emailFailures.map((r) => r.createdAt),
    globalFailures.map((r) => r.createdAt),
    Date.now()
  );

  if (throttle.blocked) {
    // Recorded under a different action so a throttled request cannot itself
    // extend the block: only auth.login_failed rows are counted.
    await recordAuditEvent({
      actorEmail: email,
      action: "auth.login_throttled",
      detail: { recentFailures: throttle.recentFailures, scope: throttle.scope },
    });
    return NextResponse.json(
      { error: "Too many failed attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
    );
  }

  const user = db.select().from(users).where(eq(users.email, email)).get();
  const passwordOk = verifyPassword(parsed.data.password, user?.passwordHash ?? DECOY_HASH);

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
