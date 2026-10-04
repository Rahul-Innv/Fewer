import { after } from "next/server";
import { json, jsonError, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/demo/run {} -> 202 { ok: true, startedAt, asks: 4 }
 *   Clears the demo data (journeys and boundaries stay) and records the four seed asks directly. NO
 *   email is sent: triage runs after the response (real model + Exa + rules), then the approval is
 *   created on the Desk only; approving demo drafts records "simulated" sends. Progress shows through
 *   the normal GET /api/desk polling (cards carry demo: true).
 *   409 { ok: false, error, lastRunAt } when a run started less than 60 s ago.
 *   412 { ok: false, error } when the database looks like a non-demo one.
 * GET /api/demo/run -> { ok: true, lastRunAt } (ISO string or null) for "Demo started 12 s ago".
 * On Fly this sits behind the DESK_PASSWORD gate like every other route.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;
  try {
    const { startDemoRun, runDemoTriage } = await import("@/server/demo");
    const r = await startDemoRun();
    if (!r.ok) return jsonError(r.status, r.error, r.lastRunAt !== undefined ? { lastRunAt: r.lastRunAt } : {});
    after(() => runDemoTriage(r.askIds).catch((e) => console.error("[fewer/api/demo/run]", e)));
    return json({ ok: true, startedAt: r.startedAt, asks: r.askIds.length }, 202);
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not start the demo right now."));
  }
}

export async function GET() {
  try {
    const { lastDemoRunAt } = await import("@/server/demo");
    return json({ ok: true, lastRunAt: await lastDemoRunAt() });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not read the demo state."));
  }
}
