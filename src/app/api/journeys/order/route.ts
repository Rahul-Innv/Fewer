import { after } from "next/server";
import { json, jsonError, readJson, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/journeys/order { ids: [id, id, id] } (best first).
 * Re-ranks the journeys 1..N, then re-decides open asks from stored data only (no model call):
 * -> 200 { ok, order: [{id, rank, title}], changed: [{askId, title, from, to, rule}], unchanged, skipped, failed }
 * A changed verdict expires any pending approval holding that ask's draft; the draft text is flagged stale.
 * After the response, changed asks are re-drafted (triage) and get fresh briefs, demo and live kept apart.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  const body = await readJson(req);

  try {
    const { reorderJourneys } = await import("@/server/reorder");
    const result = await reorderJourneys(body.ids);
    if (!result.ok) return jsonError(400, result.error);
    const changedIds = result.changed.map((c) => c.askId);
    if (changedIds.length) after(() => redraft(changedIds).catch((e) => console.error("[fewer/api/journeys/order]", e)));
    return json(result);
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not reorder your goals right now."));
  }
}

/** Re-draft asks whose verdict flipped, then brief them; demo and live asks never share an approval. */
async function redraft(askIds: string[]): Promise<void> {
  const { triage, sendBrief, isDemoAsk } = await import("@/server/pipeline");
  const { getAsk } = await import("@/server/db");
  await Promise.all(askIds.map((id) => triage(id)));
  const rows = await Promise.all(askIds.map((id) => getAsk(id)));
  const ready = rows.filter((a) => a && a.status === "triaged");
  const demo = ready.filter((a) => isDemoAsk(a!.inbox_message_id)).map((a) => a!.id);
  const live = ready.filter((a) => !isDemoAsk(a!.inbox_message_id)).map((a) => a!.id);
  if (demo.length) await sendBrief(demo);
  if (live.length) await sendBrief(live);
}
