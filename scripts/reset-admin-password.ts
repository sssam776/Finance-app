/**
 * Sets a new password for an administrator and prints it once.
 *
 * `db:seed` deliberately leaves an existing admin's password alone, so that a
 * routine re-seed can never quietly replace a working credential. That is the
 * right default, and it leaves no way back in once the password printed at
 * first seed has scrolled away. This is that way back in.
 *
 * Local development databases only — the same guard the verification scripts
 * use. Recovering access to a real deployment is an operator task, not a
 * script committed to the repository.
 *
 * Run with: npx tsx scripts/reset-admin-password.ts [email]
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users, sessions } from "../db/schema";
import { hashPassword, normaliseEmail } from "../lib/auth";
import { nowUtcIso } from "../lib/dates";

import { assertLocalDevDatabase } from "./guardTestDb";

assertLocalDevDatabase();

const requested = process.argv[2] ?? process.env.ADMIN_EMAIL ?? "admin@ramwall.local";
const email = normaliseEmail(requested);

const user = db.select().from(users).where(eq(users.email, email)).get();
if (!user) {
  console.error(`No user ${email}. Run "npm run db:seed" to create the first administrator.`);
  process.exit(1);
}

// Generated rather than accepted as an argument: a password passed on the
// command line is visible in shell history and in the local process list.
const password = randomBytes(12).toString("base64url");

db.update(users)
  .set({ passwordHash: hashPassword(password), updatedAt: nowUtcIso() })
  .where(eq(users.id, user.id))
  .run();

// Every existing session for this user is dropped. A password reset that left
// old sessions alive would not actually revoke access, which is the main
// reason to reset one.
const revoked = db.delete(sessions).where(eq(sessions.userId, user.id)).run();

console.log(`\nPassword reset for ${email}`);
console.log(`New password:  ${password}`);
console.log(`Sessions revoked: ${revoked.changes}`);
console.log(`\nShown once. It is stored only as a hash.\n`);
