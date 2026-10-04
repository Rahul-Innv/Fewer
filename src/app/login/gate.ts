/**
 * Desk password gate: shared by src/proxy.ts (verify) and src/app/api/login/route.ts (issue).
 *
 * Dependency-free: Web Crypto only (identical in Node and Edge). The gate is ON only while the
 * DESK_PASSWORD env var is set and non-blank; with it unset (local dev) every helper reports "off".
 *
 * Cookie value:  `<expiresAtUnixSeconds>.<hex HMAC-SHA256(DESK_PASSWORD, "fewer-desk-session-v1.<expiresAt>")>`
 * The expiry is signed, so the 12h lifetime is enforced server-side, not just by the browser.
 * Changing DESK_PASSWORD invalidates every outstanding cookie.
 */

export const SESSION_COOKIE = "fewer_desk";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const SESSION_CONSTANT = "fewer-desk-session-v1";
const encoder = new TextEncoder();

/** The configured password, or null when the gate is off (unset or blank). */
export function deskPassword(): string | null {
  const value = process.env.DESK_PASSWORD?.trim();
  return value ? value : null;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Constant-time string compare. Only ever called on equal-length digests, but safe if they differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Constant-time password check. Both sides are hashed first, so the compare is over two fixed-length
 * digests and the length of the real password is not observable through timing.
 */
export async function passwordMatches(typed: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(typed)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ]);
  return timingSafeEqual(toHex(a), toHex(b));
}

/** A fresh signed session value that expires SESSION_TTL_SECONDS from `nowMs`. */
export async function issueSession(secret: string, nowMs: number = Date.now()): Promise<string> {
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  return `${expiresAt}.${await hmacHex(secret, `${SESSION_CONSTANT}.${expiresAt}`)}`;
}

/** True only for an unexpired value signed with the current secret. Never throws. */
export async function verifySession(secret: string, value: string | undefined, nowMs: number = Date.now()): Promise<boolean> {
  if (!value) return false;
  const match = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt <= Math.floor(nowMs / 1000)) return false;
  try {
    const expected = await hmacHex(secret, `${SESSION_CONSTANT}.${expiresAt}`);
    return timingSafeEqual(expected, match[2]);
  } catch {
    return false;
  }
}
