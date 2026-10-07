import { after } from "next/server";
import { json, jsonError, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/demo/run {} -> 202 { ok: true, startedAt, total: 5 }
 *   Clears demo rows only (live data untouched). The demo asks then ARRIVE one every 3 s, each triaged
 *   as it lands (real model + Exa + rules); then one Desk-only approval. NO email to the senders.
 *   409 { ok: false, error, lastRunAt } within 60 s of the last run; 412 on a non-demo database.
 * GET /api/demo/run -> { ok: true, lastRunAt, inserted, total, running } for "2 of 5 asks arrived".
 * On Fly this sits behind the DESK_PASSWORD gate like every other route.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;
  try {
    const { startDemoRun, runDemoStaggered } = await import("@/server/demo");
    const r = await startDemoRun();
    if (!r.ok) return jsonError(r.status, r.error, r.lastRunAt !== undefined ? { lastRunAt: r.lastRunAt } : {});
    after(() => runDemoStaggered().catch((e) => console.error("[fewer/api/demo/run]", e)));
    return json({ ok: true, startedAt: r.startedAt, total: r.total }, 202);
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not start the demo right now."));
  }
}

export async function GET() {
  try {
    const { lastDemoRunAt, demoProgress } = await import("@/server/demo");
    const [lastRunAt, progress] = await Promise.all([lastDemoRunAt(), demoProgress()]);
    return json({ ok: true, lastRunAt, ...progress });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not read the demo state."));
  }
}
