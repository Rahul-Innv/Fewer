import { json, jsonError, requireJson, safeMessage } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/timeskip: DEMO ONLY. Pretends it is tomorrow and sends the
 * "Was it worth it? 1-5" check-in for every sent YES/WILDCARD ask.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  try {
    const { timeSkipCheckins } = await import("@/server/pipeline");
    const sent = await timeSkipCheckins();
    return json({ ok: true, sent, demo: true });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Time-skip failed. No check-ins were sent."));
  }
}
