import { json, jsonError, readJson, requireJson, safeMessage } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/decline { approvalId } -> declineApproval(approvalId). Holds the brief; nothing is sent. */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  const body = await readJson(req);
  const approvalId = typeof body.approvalId === "string" ? body.approvalId.trim() : "";
  if (!approvalId || approvalId.length > 128) {
    return jsonError(400, "Missing approvalId.");
  }

  try {
    const { declineApproval } = await import("@/server/pipeline");
    await declineApproval(approvalId);
    return json({ ok: true });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not hold the brief right now."));
  }
}
