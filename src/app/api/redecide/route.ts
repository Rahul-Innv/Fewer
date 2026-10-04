import { after } from "next/server";
import { json, jsonError, requireJson, safeMessage } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/redecide {} -> {ok, changed:[{askId,title,from,to,rule}], unchanged, skipped, failed, ms}
 * Re-decides every open ask with the current goal ranks, best ask first, so overlapping yeses resolve:
 * the better ask keeps the slot, the other becomes NO (event) or SMALLER (meeting/request/other).
 * The pass itself uses stored data only (no model call, no research, no email). A changed verdict expires its
 * pending approval; after the response, changed asks with a deliverable sender get a fresh draft + brief.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  try {
    const { redecideAll } = await import("@/server/reorder");
    const result = await redecideAll();
    const changedIds = result.changed.map((c) => c.askId);
    if (changedIds.length) {
      after(async () => {
        try {
          const { redraftChanged } = await import("@/server/redraft");
          await redraftChanged(changedIds);
        } catch (e) {
          console.error("[fewer/api/redecide]", e instanceof Error ? e.message : e);
        }
      });
    }
    return json(result);
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not re-decide the open asks right now."));
  }
}
