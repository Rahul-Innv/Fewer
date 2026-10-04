/** Small helpers shared by the Desk API routes. Folder is underscore-prefixed, so it is not routable. */

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error, ...extra }, status);
}

/**
 * Cheap CSRF guard for state-changing routes: a cross-site HTML form cannot send
 * `Content-Type: application/json` without a CORS preflight, which we never answer.
 */
export function requireJson(req: Request): Response | null {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return jsonError(415, "Send application/json.");
  }
  return null;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Log the real error server-side; return a message that is safe to show in the UI. */
export function safeMessage(e: unknown, fallback: string): string {
  console.error("[fewer/api]", e instanceof Error ? e.message : e);
  const msg = e instanceof Error ? e.message : "";
  // Missing-env errors list variable NAMES only, which is fine and useful for the demo operator.
  if (/is not set|missing|required/i.test(msg) && msg.length < 240 && !/postgres(ql)?:\/\//i.test(msg)) return msg;
  return fallback;
}
