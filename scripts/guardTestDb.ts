/**
 * Refuses to run a verification script against anything but a local
 * development database.
 *
 * The verify-* scripts create users, import statements and delete rows. They
 * are committed, runnable, and take a password on the command line, so the
 * cost of pointing one at a real database by accident is high. This makes that
 * mistake loud instead of destructive.
 */
import path from "node:path";

export function assertLocalDevDatabase(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run a verification script with NODE_ENV=production.");
  }

  const dbPath = process.env.SQLITE_DB_PATH ?? path.join(process.cwd(), "data", "ramwall.db");
  const resolved = path.resolve(dbPath).replace(/\\/g, "/");

  // The seeded development file, and nothing else, unless explicitly overridden.
  const looksLocal = resolved.endsWith("/data/ramwall.db");
  if (!looksLocal && process.env.ALLOW_VERIFY_AGAINST !== resolved) {
    throw new Error(
      `Refusing to run against ${resolved}.\n` +
        `Verification scripts create and delete records. If this really is a throwaway database, ` +
        `re-run with ALLOW_VERIFY_AGAINST=${resolved}`
    );
  }

  const base = process.env.BASE_URL ?? "http://localhost:3000";
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) {
    throw new Error(`Refusing to run against a non-local server: ${base}`);
  }
}

/**
 * Reads the admin password from the environment in preference to argv.
 * A command-line argument is visible in shell history and in the OS process
 * list to any other local user.
 */
export function adminPassword(): string {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;

  const fromArgv = process.argv[2];
  if (fromArgv && !fromArgv.startsWith("--")) {
    console.warn(
      "warning: passing the password as an argument exposes it in shell history and the process list. Prefer ADMIN_PASSWORD=... instead.\n"
    );
    return fromArgv;
  }

  console.error("Set ADMIN_PASSWORD, or pass the password as the first argument.");
  process.exit(1);
}
