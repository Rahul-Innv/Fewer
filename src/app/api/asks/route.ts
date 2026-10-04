import { after } from "next/server";
import { json, jsonError, readJson, requireJson, safeMessage } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/**
 * POST /api/asks { text, subject?, fromEmail?, fromName? } -> { askId }.
 * Records an ask pasted into the Desk and returns at once; triage and the approval brief run
 * after the response, and the Desk's polling shows the card move from "Reading..." to a verdict.
 */
export async function POST(req: Request) {
  const notJson = requireJson(req);
  if (notJson) return notJson;

  const body = await readJson(req);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return jsonError(400, "Paste an invite or request first.");
  if (text.length > 5000) return jsonError(413, "That's too long. Keep it under 5,000 characters.");

  try {
    const { submitWebAsk, runWebAsk } = await import("@/server/pipeline");
    const { askId } = await submitWebAsk({
      text,
      subject: str(body.subject, 200),
      fromEmail: str(body.fromEmail, 254),
      fromName: str(body.fromName, 120),
    });
    after(() => runWebAsk(askId).catch((e) => console.error("[fewer/api/asks]", e)));
    return json({ ok: true, askId }, 202);
  } catch (e) {
    return jsonError(500, safeMessage(e, "Could not add that ask right now."));
  }
}
