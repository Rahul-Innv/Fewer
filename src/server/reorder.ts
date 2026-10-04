import { decide } from "../core";
import type { Decision, EvidenceClaim, Fit, Journey, ParsedAsk } from "../core";
import * as db from "./db";
import { buildContext } from "./pipeline";

/**
 * Reorder the owner's journeys (rank 1..N) and re-decide the asks that are still open, from STORED data
 * only: asks.parsed, the latest decision's fits, the latest evidence claims, the boundaries and the new
 * ranks. No model call, no research, no email: deterministic, so the same order always gives the same result.
 *
 * Re-deciding changes a verdict only through rank-dependent rules (R3 top-two fits, R4/R5/R6). When a verdict
 * changes, a pending approval holding that ask's draft is expired (a stale draft can never be approved) and the
 * draft text may no longer match the new verdict: it is flagged in events_log ("redecided", draftStale: true)
 * and left for the caller to re-draft (e.g. by running triage).
 */

export interface ChangedAsk {
  askId: string;
  title: string;
  from: string;
  to: string;
  rule: string;
}

export type ReorderResult =
  | {
      ok: true;
      order: { id: string; rank: number; title: string }[];
      changed: ChangedAsk[];
      /** Re-decided with the same verdict: nothing written. */
      unchanged: number;
      /** Open asks with no usable stored decision yet (triage still running): not re-decided. */
      skipped: number;
      /** Ask ids whose re-decision threw; safe to retry the same order. */
      failed: string[];
    }
  | { ok: false; error: string };

/** The ids must list every current journey exactly once. Pure. */
export function validateOrder(
  ids: unknown,
  currentIds: readonly string[],
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.length === 0)) {
    return { ok: false, error: "ids must be an array of journey ids." };
  }
  const list = ids as string[];
  if (new Set(list).size !== list.length) {
    return { ok: false, error: "ids must not repeat a journey." };
  }
  if (list.length !== currentIds.length) {
    return { ok: false, error: `ids must list all ${currentIds.length} journeys exactly once.` };
  }
  const known = new Set(currentIds);
  if (list.some((id) => !known.has(id))) {
    return { ok: false, error: "ids contains an unknown journey id." };
  }
  return { ok: true, ids: list };
}

interface OpenAsk {
  id: string;
  subject: string | null;
  parsed: ParsedAsk | null;
  status: string;
}

/** Asks that can still change: everything except these final statuses. */
async function openAsks(): Promise<OpenAsk[]> {
  return db.sql<OpenAsk[]>`
    select id, subject, parsed, status from asks
    where status not in ('sent', 'ready', 'simulated', 'blocked', 'declined', 'error')
      and parsed is not null
    order by received_at asc, id asc`;
}

async function latestClaims(askId: string): Promise<EvidenceClaim[]> {
  const rows = await db.sql<{ claims: EvidenceClaim[] | null }[]>`
    select claims from evidence where ask_id = ${askId} order by id desc limit 1`;
  const claims = rows[0]?.claims;
  return Array.isArray(claims) ? claims : [];
}

/** Pending approvals holding any of this ask's drafts become 'expired': they can no longer be approved. */
async function expirePendingApprovals(askId: string): Promise<number> {
  const rows = await db.sql<{ id: string }[]>`
    update approvals set status = 'expired'
    where status = 'pending'
      and exists (select 1 from drafts d where d.ask_id = ${askId} and approvals.draft_ids @> to_jsonb(d.id))
    returning id`;
  return rows.length;
}

/**
 * Applies `ids` (best first) as ranks 1..N and re-decides open asks. Everything runs under the decision lock,
 * so a concurrent triage cannot interleave and the evening / wildcard caps are read consistently. Asks are
 * re-decided one at a time in the order they arrived, each seeing the verdicts already re-saved before it.
 */
export async function reorderJourneys(ids: unknown): Promise<ReorderResult> {
  const tz = (process.env.FEWER_TZ ?? "").trim() || "America/Los_Angeles";

  return db.withDecisionLock(async (): Promise<ReorderResult> => {
    const current = await db.listJourneys();
    const valid = validateOrder(
      ids,
      current.map((j) => j.id),
    );
    if (!valid.ok) return valid;

    // One transaction: either every rank moves or none does.
    await db.sql.begin(async (tx) => {
      for (const [i, id] of valid.ids.entries()) {
        await tx`update journeys set rank = ${i + 1} where id = ${id}`;
      }
    });

    const [journeys, boundaries, asks] = await Promise.all([db.listJourneys(), db.listBoundaries(), openAsks()]);

    const changed: ChangedAsk[] = [];
    let unchanged = 0;
    let skipped = 0;
    const failed: string[] = [];

    for (const ask of asks) {
      const parsed = ask.parsed;
      if (!parsed || typeof parsed !== "object") {
        skipped += 1;
        continue;
      }
      try {
        const stored = await db.latestDecision(ask.id);
        if (!stored || !Array.isArray(stored.fits)) {
          skipped += 1; // not decided yet: triage will decide it (and reads the new ranks)
          continue;
        }
        const fits: Fit[] = stored.fits;
        const claims = await latestClaims(ask.id);
        const ctx = await buildContext(ask.id, parsed, tz);
        const next: Decision = decide(parsed, fits, claims, journeys, boundaries, ctx);
        const from = stored.verdict ?? stored.decision?.verdict ?? "?";

        if (next.verdict === from) {
          unchanged += 1;
          continue;
        }

        // Safety first, decision last: if a step fails, a retry still sees the old verdict and redoes them all.
        await expirePendingApprovals(ask.id);
        await db.setAskStatus(ask.id, next.verdict === "BLOCKED" ? "blocked" : "triaged");
        await db.saveDecision(ask.id, next, fits);
        await db.logEvent("redecided", ask.id, { from, to: next.verdict, draftStale: true });
        changed.push({
          askId: ask.id,
          title: parsed.title || ask.subject || "(untitled)",
          from,
          to: next.verdict,
          rule: next.rule,
        });
      } catch (e) {
        failed.push(ask.id);
        await db.logEvent("error", ask.id, { stage: "redecide", error: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      ok: true,
      order: journeys.map((j: Journey) => ({ id: j.id, rank: j.rank, title: j.title })),
      changed,
      unchanged,
      skipped,
      failed,
    };
  });
}
