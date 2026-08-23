import { describe, it, expect } from "vitest";
import { passwordProblem, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "../lib/passwordPolicy";

const EMAIL = "controller@ramwall.local";

describe("passwordProblem", () => {
  it("accepts a reasonable password", () => {
    expect(passwordProblem("correct horse battery staple", EMAIL)).toBeNull();
  });

  it("rejects anything under the minimum length", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1), EMAIL)).toMatch(/at least/);
  });

  it("accepts exactly the minimum length", () => {
    expect(passwordProblem("abcdefghijkl", EMAIL)).toBeNull();
  });

  it("rejects absurdly long input, which would burn scrypt CPU on every login", () => {
    expect(passwordProblem("a".repeat(MAX_PASSWORD_LENGTH + 1), EMAIL)).toMatch(/at most/);
  });

  it("rejects a password containing the email local part", () => {
    expect(passwordProblem("my-controller-password", EMAIL)).toMatch(/email address/);
    // Case-insensitively too.
    expect(passwordProblem("MY-CONTROLLER-PASSWORD", EMAIL)).toMatch(/email address/);
  });

  it("does not reject on a very short local part that would match everything", () => {
    // A two-character local part must not veto every password containing it.
    expect(passwordProblem("a longer passphrase here", "ab@ramwall.local")).toBeNull();
  });

  it("rejects a long but repetitive password", () => {
    expect(passwordProblem("aaaaaaaaaaaaaaaa", EMAIL)).toMatch(/repetitive/);
    expect(passwordProblem("abababababababab", EMAIL)).toMatch(/repetitive/);
  });

  it("rejects whitespace-only input that clears the length rule", () => {
    expect(passwordProblem(" ".repeat(MIN_PASSWORD_LENGTH + 2), EMAIL)).not.toBeNull();
  });

  it("does not impose composition rules that push people towards Password1!", () => {
    // All-lowercase with no digits or symbols is fine if it is long enough.
    expect(passwordProblem("velvet marmalade window", EMAIL)).toBeNull();
  });

  it("handles a malformed email without throwing", () => {
    expect(() => passwordProblem("a reasonable passphrase", "not-an-email")).not.toThrow();
  });
});
