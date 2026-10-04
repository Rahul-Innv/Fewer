import { after } from "next/server";
import { json, jsonError, readJson, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/journeys/order { ids: [id, id, id] } (best first).
 * Re-ranks the journeys 1..N, then re-decides open asks from stored data only (no model call):
 * -> 200 { ok, order: [{id, rank, title}], changed: [{askId, title, from, to, rule}], unchanged, skipped, failed }
 * A changed verdict expires any pending approval holding that ask's draft; the draft text is flagged stale.
 * After the response, changed asks with a deliverable sender get a fresh DRAFT for the saved decision (never a
 * re-parse, research or re-decide) and a brief, demo and live kept apart. Copy-only asks keep their stale draft.
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
    // Drafts only (no re-parse, no research, no re-decide), so the verdicts above stay exactly as returned.
    if (changedIds.length) after(() => redraft(changedIds));
    return json(result);
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not reorder your goals right now."));
  }
}

async function redraft(askIds: string[]): Promise<void> {
  try {
    const { redraftChanged } = await import("@/server/redraft");
    await redraftChanged(askIds);
  } catch (e) {
    console.error("[fewer/api/journeys/order]", e instanceof Error ? e.message : e);
  }
}
