import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

/**
 * Password and session-token primitives (spec 15.1). Deliberately dependency-
 * free: Node's own scrypt is a memory-hard KDF, so there is no reason to pull
 * in bcrypt/argon2 and a native build step for it.
 *
 * This module imports nothing but `node:crypto` on purpose — it must stay
 * unit-testable without opening the SQLite file or a request context. The
 * database- and cookie-bound half lives in `lib/session.ts`.
 */

export { SESSION_COOKIE } from "./sessionCookie";

/** 8 hours. A finance control tool, not a consumer app — re-auth daily. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

/**
 * Constant-time comparison. Returns false rather than throwing on a malformed
 * stored hash so a corrupted row denies access instead of 500-ing the route.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expectedBuf = Buffer.from(expected, "hex");
  if (expectedBuf.length !== derived.length) return false;

  return timingSafeEqual(derived, expectedBuf);
}

/**
 * The single definition of how an email is stored and looked up.
 *
 * The login route lowercases before querying, so anything that WRITES a user
 * must lowercase too or the account simply cannot sign in. That rule was
 * previously implicit in each caller, and a mixed-case address inserted
 * directly produced a user who existed and could never authenticate.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Sessions are stored by token hash, never by token. A dump of the sessions
 * table is not a set of usable cookies.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiryFrom(nowMs: number): string {
  return new Date(nowMs + SESSION_TTL_MS).toISOString();
}

export function isExpired(expiresAtIso: string, nowMs: number): boolean {
  return new Date(expiresAtIso).getTime() <= nowMs;
}
