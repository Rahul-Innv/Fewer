import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, deskPassword, verifySession } from "./app/login/gate";

/**
 * Desk password gate (Next 16 "proxy", the renamed middleware).
 *
 * - DESK_PASSWORD unset (local dev, recording): complete no-op.
 * - DESK_PASSWORD set (Fly): every page and /api/* route needs the signed `fewer_desk` cookie,
 *   except /login and /api/login. Static assets are excluded by the matcher below.
 * - Gated /api/* requests get 401 JSON; gated pages get a redirect to /login.
 */

/** Exact paths only: no prefix match, so nothing like /login/../api/desk can ride on the allowance. */
const PUBLIC_PATHS = new Set(["/login", "/api/login"]);

export async function proxy(request: NextRequest) {
  const secret = deskPassword();
  if (!secret) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (PUBLIC_PATHS.has(normalized)) return NextResponse.next();

  if (await verifySession(secret, request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (normalized === "/api" || normalized.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Sign in required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Needs an absolute URL here (a bare "/login" Location throws "Invalid URL" in production). Next
  // puts it on the wire as `Location: /login`, so scheme and host stay right behind Fly's proxy.
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  const res = NextResponse.redirect(login, 307);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  // Everything except Next's build assets and the favicon (the login page needs the tab icon).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
