/**
 * Password rules, kept pure and in one place so the seed, the change-password
 * route and any future admin user-creation route cannot drift apart.
 *
 * Length is the rule that actually matters against offline guessing, so it is
 * the one enforced hardest. Composition rules (one upper, one digit, one
 * symbol) are deliberately absent: they push people towards Password1! and
 * measurably reduce entropy. NIST SP 800-63B dropped them for that reason.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Returns a message describing why the password is unacceptable, or null if it
 * is fine. The message is shown to the user, so it says what to fix.
 */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  // scrypt hashes the whole input, so a very long password is a cheap way to
  // burn CPU on every login attempt. Cap it.
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }

  const normalised = password.trim().toLowerCase();
  if (normalised === "") {
    return "Password cannot be only whitespace.";
  }

  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (localPart.length >= 3 && normalised.includes(localPart)) {
    return "Password must not contain your email address.";
  }

  // "aaaaaaaaaaaa" clears the length rule while carrying almost no entropy.
  if (new Set(normalised).size < 5) {
    return "Password is too repetitive. Use a longer mix of characters.";
  }

  return null;
}
