import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { createSession, setSessionCookie } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { nowUtcIso } from "@/lib/dates";

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
