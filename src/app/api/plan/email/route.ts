import { json, jsonError, readJson, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/plan/email { scope?: "live" | "demo" }  (default "live")
 * Emails the owner (DEMO_RECIPIENT, never anyone else) one plain-text plan of what Fewer decided.
 *   200 { ok, sentTo, going, smaller, askOne, declined }
 *   400 bad scope | 409 nothing decided yet | 412 DEMO_RECIPIENT / FEWER_INBOX not set | 415 not JSON | 500
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  const body = await readJson(req);
  const raw = body.scope;
  if (raw !== undefined && raw !== "live" && raw !== "demo") {
    return jsonError(400, 'scope must be "live" or "demo".');
  }
  const scope: "live" | "demo" = raw === "demo" ? "demo" : "live";

  try {
    const { emailPlan } = await import("@/server/plan");
    const r = await emailPlan(scope);
    if (!r.ok) return jsonError(r.status, r.error);
    return json({ ok: true, sentTo: r.sentTo, going: r.going, smaller: r.smaller, askOne: r.askOne, declined: r.declined });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not email the plan right now. Nothing was sent."));
  }
}
