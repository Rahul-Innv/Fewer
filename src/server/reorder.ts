import { decide } from "../core";
import type { Decision, DecisionContext, EvidenceClaim, Fit, Journey, ParsedAsk, TakenBlock } from "../core";
import { acceptedTakenBlocks, listBusyBlocks } from "./calendar";
import * as db from "./db";
import { isEveningOut, weekKey } from "./pipeline";

/**
 * Reorder the owner's journeys (rank 1..N) and re-decide the asks that are still open, from STORED data
 * only: asks.parsed, the latest decision's fits, the latest evidence claims, the boundaries and the new
 * ranks. No model call, no research, no email: deterministic, so the same order always gives the same result.
 *
 * Re-deciding changes a verdict only through rank-dependent rules (R3 top-two fits, R4/R5/R6). When a verdict
 * changes, a pending approval holding that ask's draft is expired (a stale draft can never be approved) and the
 * draft text may no longer match the new verdict: it is flagged in events_log ("redecided", draftStale: true)
 * and left for the caller to re-draft (redraft.ts: drafts only, never a re-parse or re-decide).
 *
 * BATCHED for speed (one Neon round trip is ~80 ms): one wave of parallel reads, every decide() in memory,
 * then ONE write transaction for all changed asks, all under the decision lock.
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
      /** Wall time of the whole reorder (lock, ranks, reads, decisions, write), in ms. */
      ms: number;
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

const FINAL_STATUSES = ["sent", "ready", "simulated", "blocked", "declined", "error"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

interface OpenAsk {
  id: string;
  subject: string | null;
  parsed: ParsedAsk | null;
  status: string;
  received_at: Date | string;
  verdict: string | null;
  decision: Decision | null;
  fits: Fit[] | null;
}

/** An ask holding time and caps: approved before this pass, or YES/WILDCARD earlier in this pass. */
interface Holder {
  id: string;
  title: string;
  parsed: ParsedAsk | null;
  received_at: Date | string;
  verdict: string;
}

interface PassData {
  journeys: Journey[];
  boundaries: Awaited<ReturnType<typeof db.listBoundaries>>;
  ratings: Awaited<ReturnType<typeof db.listRatings>>;
  open: OpenAsk[];
  claimsByAsk: Map<string, EvidenceClaim[]>;
  approved: Holder[];
  calendar: TakenBlock[];
}

/** Every read the pass needs, in parallel: one wave of round trips. */
async function loadPassData(): Promise<PassData> {
  const now = Date.now();
  const [journeys, boundaries, ratings, open, evidence, approved, busy] = await Promise.all([
    db.listJourneys(),
    db.listBoundaries(),
    db.listRatings(),
    db.sql<OpenAsk[]>`
      select a.id, a.subject, a.parsed, a.status, a.received_at, d.verdict, d.decision, d.fits
      from asks a
      left join lateral (
        select verdict, decision, fits from decisions x where x.ask_id = a.id order by x.id desc limit 1
      ) d on true
      where a.status not in ${db.sql(FINAL_STATUSES)} and a.parsed is not null
      order by a.received_at asc, a.id asc`,
    db.sql<{ ask_id: string; claims: EvidenceClaim[] | null }[]>`
      select distinct on (e.ask_id) e.ask_id, e.claims
      from evidence e join asks a on a.id = e.ask_id
      where a.status not in ${db.sql(FINAL_STATUSES)} and a.parsed is not null
      order by e.ask_id, e.id desc`,
    db.sql<Holder[]>`
      select a.id, coalesce(a.parsed->>'title', a.subject, '') as title, a.parsed, a.received_at, d.verdict
      from asks a
      join lateral (select verdict from decisions x where x.ask_id = a.id order by x.id desc limit 1) d on true
      where a.status in ('sent', 'ready', 'simulated') and d.verdict in ('YES', 'WILDCARD')`,
    listBusyBlocks({ start: new Date(now - 30 * DAY_MS), end: new Date(now + 365 * DAY_MS) }),
  ]);
  return {
    journeys,
    boundaries,
    ratings,
    open,
    claimsByAsk: new Map(evidence.map((e) => [e.ask_id, Array.isArray(e.claims) ? e.claims : []])),
    approved,
    calendar: busy.map((b) => ({ start: b.start, end: b.end, label: "your calendar", kind: "calendar" as const })),
  };
}

function holderBlocks(h: Holder): TakenBlock[] {
  return acceptedTakenBlocks(
    [{ id: h.id, title: h.title, starts_at: h.parsed?.startsAt ?? null, duration_min: h.parsed?.durationMin ?? null }],
    "",
  );
}

/** Mirrors buildContext's caps, computed in memory from the holders (never the ask itself). */
function contextFor(
  ask: OpenAsk,
  parsed: ParsedAsk,
  holders: Holder[],
  taken: TakenBlock[],
  d: PassData,
  tz: string,
  nowIso: string,
): DecisionContext {
  const targetKey = weekKey(parsed.startsAt ?? nowIso, tz) ?? weekKey(nowIso, tz);
  let evenings = 0;
  let wildcard = false;
  for (const h of holders) {
    if (h.id === ask.id) continue;
    const when = h.parsed?.startsAt ?? new Date(h.received_at).toISOString();
    if (weekKey(when, tz) !== targetKey) continue;
    if (h.verdict === "WILDCARD") wildcard = true;
    if (isEveningOut(h.parsed, tz)) evenings += 1;
  }
  return {
    now: nowIso,
    timeZone: tz,
    eveningsOutThisWeek: evenings,
    wildcardUsedThisWeek: wildcard,
    ratings: d.ratings,
    ...(taken.length > 0 ? { takenBlocks: taken } : {}),
  };
}

interface Change {
  ask: OpenAsk;
  title: string;
  from: string;
  next: Decision;
  fits: Fit[];
}

/** ONE transaction for every changed ask: expire approvals, set statuses, insert decisions, log events. */
async function writeChanges(changes: Change[]): Promise<void> {
  if (changes.length === 0) return;
  const ids = JSON.stringify(changes.map((c) => c.ask.id));
  const blocked = JSON.stringify(changes.filter((c) => c.next.verdict === "BLOCKED").map((c) => c.ask.id));
  const decisions = JSON.stringify(
    changes.map((c) => ({ ask_id: c.ask.id, verdict: c.next.verdict, rule: c.next.rule, decision: c.next, fits: c.fits })),
  );
  const events = JSON.stringify(
    changes.map((c) => ({ ask_id: c.ask.id, detail: { from: c.from, to: c.next.verdict, draftStale: true } })),
  );
  await db.sql.begin(async (tx) => {
    // Safety first: a stale draft can never be approved.
    await tx`
      update approvals set status = 'expired'
      where status = 'pending'
        and exists (
          select 1 from drafts d
          where d.ask_id in (select jsonb_array_elements_text(${ids}::jsonb))
            and approvals.draft_ids @> to_jsonb(d.id)
        )`;
    await tx`
      update asks
      set status = case when id in (select jsonb_array_elements_text(${blocked}::jsonb)) then 'blocked' else 'triaged' end
      where id in (select jsonb_array_elements_text(${ids}::jsonb))`;
    await tx`
      insert into decisions (ask_id, verdict, rule, decision, fits)
      select t.x->>'ask_id', t.x->>'verdict', t.x->>'rule', t.x->'decision', t.x->'fits'
      from jsonb_array_elements(${decisions}::jsonb) with ordinality as t(x, n) order by t.n`;
    await tx`
      insert into events_log (kind, ask_id, detail)
      select 'redecided', t.x->>'ask_id', t.x->'detail'
      from jsonb_array_elements(${events}::jsonb) with ordinality as t(x, n) order by t.n`;
  });
}

/**
 * Applies `ids` (best first) as ranks 1..N and re-decides open asks (see redecidePass). Everything runs under
 * the decision lock, so a concurrent triage cannot interleave and the caps are read consistently.
 */
export async function reorderJourneys(ids: unknown): Promise<ReorderResult> {
  const t0 = Date.now();
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

    const pass = await redecidePass(tz);
    return {
      ok: true,
      order: pass.journeys.map((j: Journey) => ({ id: j.id, rank: j.rank, title: j.title })),
      changed: pass.changed,
      unchanged: pass.unchanged,
      skipped: pass.skipped,
      failed: pass.failed,
      ms: Date.now() - t0,
    };
  });
}

export type RedecideResult = {
  ok: true;
  changed: ChangedAsk[];
  unchanged: number;
  skipped: number;
  failed: string[];
  ms: number;
};

/**
 * POST /api/redecide: re-decide every open ask with the CURRENT ranks (same pass as a reorder), so overlapping
 * yeses resolve to the best one. Stored data only: no model call, no research, no email.
 */
export async function redecideAll(): Promise<RedecideResult> {
  const t0 = Date.now();
  const tz = (process.env.FEWER_TZ ?? "").trim() || "America/Los_Angeles";
  return db.withDecisionLock(async (): Promise<RedecideResult> => {
    const { changed, unchanged, skipped, failed } = await redecidePass(tz);
    return { ok: true, changed, unchanged, skipped, failed, ms: Date.now() - t0 };
  });
}

/**
 * The re-decide pass. Caller holds the decision lock. Open asks are walked best first: max effective fit desc,
 * then earliest startsAt (undated last), then arrival. Taken time and the evening / wildcard caps for each ask
 * come ONLY from asks already approved (sent/ready/simulated with YES/WILDCARD), calendar busy blocks, and asks
 * that came out YES/WILDCARD EARLIER in this pass. Open asks not visited yet never count, so the best ask in a
 * slot keeps it. Every decide() runs in memory; changed asks are written in one transaction.
 */
async function redecidePass(tz: string): Promise<{
  journeys: Journey[];
  changed: ChangedAsk[];
  unchanged: number;
  skipped: number;
  failed: string[];
}> {
  const d = await loadPassData();
  const nowIso = new Date().toISOString();

  const maxFit = (a: OpenAsk) =>
    (a.decision?.effectiveFit ?? a.fits ?? []).reduce((m, f) => Math.max(m, Number(f?.score) || 0), 0);
  const startMs = (a: OpenAsk) => {
    const t = a.parsed?.startsAt ? Date.parse(a.parsed.startsAt) : NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  const ordered = d.open
    .map((a, i) => ({ a, i }))
    .sort((x, y) => maxFit(y.a) - maxFit(x.a) || startMs(x.a) - startMs(y.a) || x.i - y.i)
    .map((x) => x.a);

  const holders: Holder[] = [...d.approved];
  const taken: TakenBlock[] = [...d.approved.flatMap(holderBlocks), ...d.calendar];
  const changes: Change[] = [];
  let unchanged = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const ask of ordered) {
    const parsed = ask.parsed;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(ask.fits)) {
      skipped += 1; // not decided yet: triage will decide it (and reads the new ranks)
      continue;
    }
    try {
      const fits: Fit[] = ask.fits;
      const ctx = contextFor(ask, parsed, holders, taken, d, tz, nowIso);
      const next = decide(parsed, fits, d.claimsByAsk.get(ask.id) ?? [], d.journeys, d.boundaries, ctx);
      const title = parsed.title || ask.subject || "(untitled)";
      if (next.verdict === "YES" || next.verdict === "WILDCARD") {
        const h: Holder = { id: ask.id, title, parsed, received_at: ask.received_at, verdict: next.verdict };
        holders.push(h);
        taken.push(...holderBlocks(h));
      }
      const from = ask.verdict ?? ask.decision?.verdict ?? "?";
      if (next.verdict === from) unchanged += 1;
      else changes.push({ ask, title, from, next, fits });
    } catch (e) {
      failed.push(ask.id);
      await db.logEvent("error", ask.id, { stage: "redecide", error: e instanceof Error ? e.message : String(e) });
    }
  }

  await writeChanges(changes);

  return {
    journeys: d.journeys,
    changed: changes.map((c) => ({ askId: c.ask.id, title: c.title, from: c.from, to: c.next.verdict, rule: c.next.rule })),
    unchanged,
    skipped,
    failed,
  };
}
