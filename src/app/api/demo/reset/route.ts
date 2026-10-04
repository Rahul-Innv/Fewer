import { json, jsonError, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/demo/reset {} -> { ok: true }
 *   Clears demo rows only (asks with inbox ids "demo-%" and everything linked to them), no re-seed.
 *   Live data is untouched. 412 on a non-demo database. Behind the DESK_PASSWORD gate on Fly.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;
  try {
    const { resetDemo } = await import("@/server/demo");
    const r = await resetDemo();
    if (!r.ok) return jsonError(r.status, r.error);
    return json({ ok: true });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not reset the demo right now."));
  }
}
