import { json } from "../_lib/http";
import { buildDesk } from "./read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/desk: the Desk read model (polled every 2.5s by the page). Never 500s on empty/missing DB. */
export async function GET() {
  const desk = await buildDesk();
  // A transient DB failure on a configured Desk is a 503, so the page keeps its last good snapshot
  // (it treats non-OK as "reconnecting") instead of blanking every card for a poll cycle.
  return json(desk, desk.configured && desk.error ? 503 : 200);
}
