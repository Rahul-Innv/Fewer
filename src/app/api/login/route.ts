import { isJsonRequest } from "../_lib/http";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, deskPassword, issueSession, passwordMatches } from "../../login/gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_PASSWORD_LENGTH = 512;
/** Slows online guessing a little; a strong random DESK_PASSWORD is the real defence. */
const WRONG_PASSWORD_DELAY_MS = 750;

function reply(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * POST /api/login { password } -> sets the signed `fewer_desk` cookie (HttpOnly, SameSite=Lax, 12h,
 * Secure in production). When DESK_PASSWORD is unset the gate is off: answers ok and sets nothing.
 */
export async function POST(req: Request) {
  const secret = deskPassword();
  if (!secret) return reply({ ok: true, gate: "off" });

  // Same cheap CSRF guard as the Desk routes: a cross-site HTML form cannot send application/json.
  if (!isJsonRequest(req)) {
    return reply({ ok: false, error: "Send application/json." }, 415);
  }

  let typed = "";
  try {
    const body: unknown = await req.json();
    const candidate = body && typeof body === "object" ? (body as Record<string, unknown>).password : undefined;
    if (typeof candidate === "string") typed = candidate.trim();
  } catch {
    // fall through: treated as a wrong password
  }

  if (typed.length === 0 || typed.length > MAX_PASSWORD_LENGTH || !(await passwordMatches(typed, secret))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return reply({ ok: false, error: "That password did not match." }, 401);
  }

  const res = reply({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: await issueSession(secret),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
