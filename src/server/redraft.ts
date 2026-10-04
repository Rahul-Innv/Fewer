import { randomUUID } from "node:crypto";
import * as db from "./db";

/**
 * Background step after a re-decide pass (POST /api/journeys/order, POST /api/redecide): DRAFTS ONLY.
 * For each changed ask with a deliverable sender and a non-BLOCKED verdict, write a fresh draft for the
 * already-saved decision, then brief live and demo asks separately. It never re-parses, never researches
 * and never re-decides, so the verdicts the pass just made stay exactly as they are.
 * Copy-only asks (no deliverable sender) are skipped: they keep their draft, flagged stale by the
 * 'redecided' event.
 */

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const CONCURRENCY = 3;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function redraftChanged(askIds: string[]): Promise<{ drafted: string[] }> {
  if (askIds.length === 0) return { drafted: [] };
  const [{ draftReply }, { sendBrief, isDemoAsk, isWebAsk }] = await Promise.all([import("./llm"), import("./pipeline")]);
  const ownerName = (process.env.FEWER_OWNER_NAME ?? "").trim() || "Rahul";

  const drafted: { id: string; demo: boolean }[] = [];
  await mapLimit(askIds, CONCURRENCY, async (askId) => {
    try {
      const [ask, stored] = await Promise.all([db.getAsk(askId), db.latestDecision(askId)]);
      const decision = stored?.decision;
      if (!ask || !ask.parsed || !decision || decision.verdict === "BLOCKED") return;
      if (ask.status !== "triaged") return; // something else moved it on meanwhile
      const to = (ask.from_email ?? "").trim();
      if (!EMAIL_RE.test(to)) return; // copy-only: keeps its (stale-flagged) draft
      const draft = await draftReply({ ask: ask.parsed, decision, ownerName });
      const web = isWebAsk(ask.inbox_message_id) || isDemoAsk(ask.inbox_message_id);
      await db.saveDraft({
        id: `drf_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        askId,
        toEmail: ask.from_email,
        replyToMessageId: web ? null : ask.inbox_message_id,
        body: draft.body,
        kind: decision.verdict === "ASK_ONE" ? "question" : "reply",
      });
      await db.logEvent("redrafted", askId, { verdict: decision.verdict, rule: decision.rule });
      drafted.push({ id: askId, demo: isDemoAsk(ask.inbox_message_id) });
    } catch (e) {
      await db.logEvent("error", askId, { stage: "redraft", error: e instanceof Error ? e.message : String(e) });
    }
  });

  const live = drafted.filter((d) => !d.demo).map((d) => d.id);
  const demo = drafted.filter((d) => d.demo).map((d) => d.id);
  if (live.length) await sendBrief(live);
  if (demo.length) await sendBrief(demo);
  return { drafted: drafted.map((d) => d.id) };
}
