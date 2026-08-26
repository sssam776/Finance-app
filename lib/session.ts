import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions, entityPermissions } from "@/db/schema";
import { nowUtcIso } from "./dates";
import { resolveEntityAccess, type EntityAccess } from "./entityAccess";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashSessionToken,
  isExpired,
  newSessionToken,
  sessionExpiryFrom,
} from "./auth";

/**
 * Request-bound half of authentication (spec 15.1). Every mutating route
 * resolves its actor through `getSessionUser()` — no route may take an actor
 * identity from a request body or form field, because an audit trail the
 * caller can write is not an audit trail.
 *
 * `middleware.ts` only redirects on a missing cookie; it runs on the Edge
 * runtime and cannot reach SQLite. This module is the actual security
 * boundary.
 */

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "viewer";
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = newSessionToken();
  const expiresAt = sessionExpiryFrom(Date.now());

  db.insert(sessions)
    .values({
      id: hashSessionToken(token),
      userId,
      expiresAt,
      createdAt: nowUtcIso(),
    })
    .run();

  return { token, expiresAt };
}

export function destroySession(token: string): void {
  db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).run();
}

export function resolveSessionToken(token: string): SessionUser | null {
  const row = db
    .select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, hashSessionToken(token)))
    .get();

  if (!row) return null;

  if (isExpired(row.expiresAt, Date.now())) {
    destroySession(token);
    return null;
  }
  // A user disabled mid-session loses access on their next request, not at
  // their next login.
  if (row.status !== "active") return null;

  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSessionToken(token);
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // "lax" not "strict": the Xero OAuth callback is a cross-site redirect back into the app
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "Requires the admin role" }, { status: 403 });
}

/**
 * The one call every route makes before doing anything else:
 *
 *   const actor = await requireSession("admin");
 *   if (actor instanceof NextResponse) return actor;
 *
 * Returns the resolved user, or the 401/403 to return as-is. Reads take
 * "viewer"; anything that writes takes "admin", so a read-only account cannot
 * import statements, rewire an entity's Xero assignment, or start an OAuth
 * consent flow.
 */
export async function requireSession(
  minimumRole: "admin" | "viewer" = "viewer"
): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (minimumRole === "admin" && user.role !== "admin") return forbidden();
  return user;
}

/**
 * Which entities this user may see (spec 14.1). Resolved here rather than in
 * each route so every caller applies the same rule; see lib/entityAccess.ts
 * for what that rule is and why.
 */
export function entityAccessFor(user: SessionUser): EntityAccess {
  const granted = db
    .select({ entityId: entityPermissions.entityId })
    .from(entityPermissions)
    .where(eq(entityPermissions.userId, user.id))
    .all();

  return resolveEntityAccess(
    user.role,
    granted.map((g) => g.entityId)
  );
}
