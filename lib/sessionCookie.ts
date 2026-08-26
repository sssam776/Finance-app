/**
 * The session cookie name, in a module with zero imports.
 *
 * `middleware.ts` runs on the Edge runtime and cannot pull in `node:crypto`,
 * which `lib/auth.ts` depends on. Keeping the name here lets both runtimes
 * share one definition rather than duplicating the literal (REM-006).
 */
export const SESSION_COOKIE = "ramwall_session";
