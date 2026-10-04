import { after } from "next/server";
import { json, jsonError, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/live/import-week {} -> 202 { ok: true, total }
 *   Inserts the owner's week (private/calendar/week-events.json) as copy-only "[Calendar] " asks, one
 *   per second, each triaged as it lands (at most 6 at once). Nothing is ever emailed.
 *   409 while an import is running; 412 if the file is missing; 403 in production / on Fly.
 * GET /api/live/import-week -> { ok: true, inserted, total, running }
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;
  try {
    const { localOnly, startImportWeek, runImportWeek } = await import("@/server/live");
    const refused = localOnly();
    if (refused) return jsonError(refused.status, refused.error);
    const r = await startImportWeek();
    if (!r.ok) return jsonError(r.status, r.error);
    after(() => runImportWeek().catch((e) => console.error("[fewer/api/live/import-week]", e)));
    return json({ ok: true, total: r.total }, 202);
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not start the import right now."));
  }
}

export async function GET() {
  try {
    const { localOnly, importProgress } = await import("@/server/live");
    const refused = localOnly();
    if (refused) return jsonError(refused.status, refused.error);
    return json({ ok: true, ...(await importProgress()) });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not read the import progress."));
  }
}
