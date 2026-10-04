import { json, jsonError, requireJson, safeMessage } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/proactive: the latest morning brief Fewer emailed (read-only; the Desk panel shows it).
 * Returns { ok: true, brief: null } before any brief has been sent.
 */
export async function GET() {
  try {
    const { latestMorningBrief } = await import("@/server/db");
    const row = await latestMorningBrief();
    const summary = typeof row?.detail.summary === "string" ? row.detail.summary : null;
    if (!row || !summary) return json({ ok: true, brief: null });
    return json({
      ok: true,
      brief: {
        summary,
        at: new Date(row.at).toISOString(),
        date: typeof row.detail.date === "string" ? row.detail.date : null,
        demo: row.detail.demo === true,
      },
    });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not read the latest morning brief."));
  }
}

/**
 * POST /api/proactive: DEMO ONLY. Runs the two proactive jobs now instead of waiting for the worker's clock:
 * follow up on any approved YES whose event has ended, then email the morning brief (marked as a demo run).
 * -> { ok, demo: true, checkins, brief, briefSent, error? }  (brief = the one-line summary)
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  let pipeline: typeof import("@/server/pipeline");
  try {
    pipeline = await import("@/server/pipeline");
  } catch (e) {
    return jsonError(500, safeMessage(e, "Proactive check failed to start. Nothing was sent."));
  }

  const errors: string[] = [];
  let checkins = 0;
  let ran = 0;
  try {
    checkins = await pipeline.runDueCheckins();
    ran += 1;
  } catch (e) {
    errors.push(safeMessage(e, "Follow-ups failed."));
  }

  let brief: string | null = null;
  let briefSent = false;
  try {
    const r = await pipeline.runMorningBrief(new Date(), { demo: true });
    ran += 1;
    brief = r.summary;
    briefSent = r.sent;
    if (r.error) errors.push("The morning brief could not be sent.");
  } catch (e) {
    errors.push(safeMessage(e, "The morning brief failed."));
  }

  if (ran === 0) return jsonError(500, errors.join(" ") || "Proactive check failed. Nothing was sent.");
  return json({
    ok: errors.length === 0,
    demo: true,
    checkins,
    brief,
    briefSent,
    ...(errors.length > 0 ? { error: errors.join(" ") } : {}),
  });
}
