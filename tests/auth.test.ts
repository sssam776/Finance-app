import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  hashSessionToken,
  newSessionToken,
  isExpired,
  sessionExpiryFrom,
  SESSION_TTL_MS,
} from "../lib/auth";

describe("password hashing", () => {
  it("verifies a correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("Correct horse battery staple", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("returns false rather than throwing on a malformed stored hash", () => {
    // A corrupted row must deny access, not 500 the login route.
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", "bcrypt$salt$hash")).toBe(false);
    expect(verifyPassword("anything", "scrypt$onlytwo")).toBe(false);
    expect(verifyPassword("anything", "scrypt$abc$00")).toBe(false);
  });
});

describe("session tokens", () => {
  it("never stores the raw token", () => {
    const token = newSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it("hashes deterministically so lookup works", () => {
    const token = newSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("gives distinct tokens distinct hashes", () => {
    expect(hashSessionToken(newSessionToken())).not.toBe(hashSessionToken(newSessionToken()));
  });

  it("treats an elapsed expiry as expired, and a future one as live", () => {
    const now = 1_700_000_000_000;
    const expiry = sessionExpiryFrom(now);

    expect(isExpired(expiry, now)).toBe(false);
    expect(isExpired(expiry, now + SESSION_TTL_MS - 1)).toBe(false);
    // Exactly at the expiry instant the session is over, not still valid.
    expect(isExpired(expiry, now + SESSION_TTL_MS)).toBe(true);
    expect(isExpired(expiry, now + SESSION_TTL_MS + 1)).toBe(true);
  });
});
