import { json } from "../_lib/http";
import { buildDesk } from "./read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/desk: the Desk read model (polled every 2.5s by the page). Never 500s on empty/missing DB. */
export async function GET() {
  const desk = await buildDesk();
  return json(desk);
}
