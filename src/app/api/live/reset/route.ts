import { json, jsonError, readJson, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/live/reset { confirm: "RESET LIVE" } -> { ok: true, deleted }
 *   Deletes copy-only LIVE asks (calendar imports and pastes without a sender) and their linked rows.
 *   Keeps demo rows, goals, boundaries, calendar_busy and any live ask with a real sender address.
 *   400 without the exact confirm string. 403 in production / on Fly (local Desk only).
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;
  try {
    const { localOnly, resetLive } = await import("@/server/live");
    const refused = localOnly();
    if (refused) return jsonError(refused.status, refused.error);
    const body = await readJson(req);
    if (body.confirm !== "RESET LIVE") return jsonError(400, 'Send {"confirm":"RESET LIVE"} to reset the live desk.');
    return json(await resetLive());
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not reset the live desk right now."));
  }
}
