import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/sessionCookie";

/**
 * Presence check only — NOT the security boundary.
 *
 * Middleware runs on the Edge runtime, which cannot reach SQLite, so it can
 * see that a cookie exists but not that it names a live session. Its job is
 * to redirect signed-out browsers to /login instead of showing them an empty
 * dashboard. Every API route independently resolves the real session through
 * `getSessionUser()` (lib/session.ts) and rejects a forged or expired cookie
 * there. Do not move an authorisation decision into this file.
 */

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
