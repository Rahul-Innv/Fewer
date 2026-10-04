import { json, jsonError, readJson, requireJson, safeMessage } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/approve { code } -> approveByCode(code, "desk"). Sends exactly the approved drafts, once. */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  const body = await readJson(req);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^[A-Za-z0-9-]{3,32}$/.test(code)) {
    return jsonError(400, "Missing or malformed approval code.");
  }

  try {
    const { approveByCode } = await import("@/server/pipeline");
    const result = await approveByCode(code, "desk");
    return json(result, result.ok ? 200 : 409);
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not approve right now. Nothing was sent."));
  }
}
