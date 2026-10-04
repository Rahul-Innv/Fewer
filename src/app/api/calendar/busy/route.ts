import { json, jsonError, readJson, requireJson, safeMessage } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/calendar/busy {blocks:[{start,end}], source?:"google"} -> {ok:true, stored:N}
 * Replaces this source's busy blocks starting in [now - 1 day, now + 14 days]. TIMES ONLY: any other
 * block field (title, location, attendees) is dropped, never stored.
 * GET /api/calendar/busy -> {ok:true, blocks:[{start,end,source}]} from Monday of this week (FEWER_TZ)
 * through the next 7 days.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  const { parseBusyPayload, replaceBusyBlocks } = await import("@/server/calendar");
  const payload = parseBusyPayload(await readJson(req));
  if (!payload.ok) return jsonError(400, payload.error);

  try {
    const stored = await replaceBusyBlocks(payload.source, payload.blocks);
    return json({ ok: true, stored });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not store the calendar blocks. Nothing changed."));
  }
}

export async function GET() {
  try {
    const { calendarWindow, fewerTz, listBusyBlocks } = await import("@/server/calendar");
    const blocks = await listBusyBlocks(calendarWindow(new Date(), fewerTz()));
    return json({ ok: true, blocks });
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not read the calendar blocks."));
  }
}
