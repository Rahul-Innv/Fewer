import postgres from "postgres";
import type { Sql, JSONValue } from "postgres";
import type { Boundary, Decision, EvidenceClaim, Fit, Journey, ParsedAsk, Rating } from "../core";

/**
 * Neon Postgres access. `sql` is created lazily (and cached on globalThis so Next dev
 * hot-reload does not leak pools), so importing this module never throws without env.
 * The Desk (UI) reads tables directly with `sql` from "@/server/db".
 */

type Client = Sql<Record<string, unknown>>;
const g = globalThis as unknown as { __fewerSql?: Client };

/**
 * Direct (unpooled) connection string. Through Neon's pooler, reads intermittently saw other
 * connections' uncommitted, later rolled-back rows, so every app connection goes direct.
 */
export function directDatabaseUrl(): string | undefined {
  const explicit = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (explicit) return explicit;
  const pooled = process.env.DATABASE_URL?.trim();
  if (!pooled) return undefined;
  try {
    const u = new URL(pooled);
    u.hostname = u.hostname.replace("-pooler.", ".");
    return u.toString();
  } catch {
    return pooled;
  }
}

function client(): Client {
  if (!g.__fewerSql) {
    const url = directDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set");
    const local = /^postgres(?:ql)?:\/\/[^@]*@?(?:localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url);
    g.__fewerSql = postgres(url, { max: 5, prepare: false, ssl: local ? false : "require" });
  }
  return g.__fewerSql;
}

export const sql: Client = new Proxy(function lazySql() {} as unknown as Client, {
  apply(_target, _this, args) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    if (typeof prop === "symbol" || prop === "then") return undefined;
    const c = client();
    const v = (c as unknown as Record<string, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});

/** Close the pool (scripts call this before exiting). Safe if never connected. */
export async function closeDb(): Promise<void> {
  if (g.__fewerSql) {
    const c = g.__fewerSql;
    g.__fewerSql = undefined;
    await c.end({ timeout: 5 });
  }
}

/** jsonb parameter helper (porsager needs sql.json for objects/arrays). */
function j(value: unknown) {
  return sql.json(value as JSONValue);
}

// ---------- row types ----------

export type AskStatus =
  | "received"
  | "triaged"
  | "awaiting_approval"
  | "sent"
  | "ready" // approved, no address to send to: copy from the Desk
  | "declined"
  | "blocked"
  | "error";

export interface AskRow {
  id: string;
  inbox_message_id: string;
  thread_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  received_at: Date;
  raw_text: string | null;
  parsed: ParsedAsk | null;
  status: AskStatus;
}

export interface DraftRow {
  id: string;
  ask_id: string;
  to_email: string;
  /** null for asks that came in through the Desk (no email thread to reply into). */
  reply_to_message_id: string | null;
  body: string;
  kind: string;
  created_at: Date;
}

export interface ApprovalRow {
  id: string;
  code: string;
  payload_sha256: string;
  draft_ids: string[];
  status: "pending" | "approved" | "declined" | "expired";
  brief_message_id: string | null;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export interface CheckinRow {
  id: string;
  ask_id: string;
  sent_message_id: string | null;
  thread_id: string | null;
  status: string;
}

export interface DecisionRow {
  id: string;
  ask_id: string;
  verdict: Decision["verdict"];
  rule: string;
  decision: Decision;
  fits: Fit[];
}

// ---------- events ----------

/** Never throws: logging must not break the pipeline. */
/** True when Fewer started this email thread (a brief, a morning brief, a check-in). */
export async function isFewerThread(threadId: string): Promise<boolean> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from events_log where detail->>'threadId' = ${threadId}`;
  return (rows[0]?.n ?? 0) > 0;
}

export async function logEvent(kind: string, askId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await sql`insert into events_log (kind, ask_id, detail) values (${kind}, ${askId}, ${j(detail)})`;
  } catch (e) {
    console.error("[fewer] logEvent failed:", e instanceof Error ? e.message : e);
  }
}

// ---------- journeys / boundaries ----------

export async function listJourneys(): Promise<Journey[]> {
  const rows = await sql<{ id: string; rank: number; title: string; keywords: string[] }[]>`
    select id, rank, title, keywords from journeys order by rank asc`;
  return rows.map((r) => ({
    id: r.id,
    rank: r.rank as Journey["rank"],
    title: r.title,
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
  }));
}

export async function listBoundaries(): Promise<Boundary[]> {
  const rows = await sql<{ id: string; strength: string; label: string; rule: Boundary["rule"] }[]>`
    select id, strength, label, rule from boundaries order by id asc`;
  return rows.map((r) => ({ id: r.id, strength: r.strength as Boundary["strength"], label: r.label, rule: r.rule }));
}

// ---------- asks ----------

export async function insertAsk(a: {
  id: string;
  inboxMessageId: string;
  threadId: string | null;
  fromEmail: string;
  fromName?: string;
  subject: string;
  rawText: string;
  receivedAt?: string;
}): Promise<AskRow | null> {
  const rows = await sql<AskRow[]>`
    insert into asks (id, inbox_message_id, thread_id, from_email, from_name, subject, raw_text, received_at, status)
    values (${a.id}, ${a.inboxMessageId}, ${a.threadId}, ${a.fromEmail}, ${a.fromName ?? null}, ${a.subject},
            ${a.rawText}, ${a.receivedAt ? new Date(a.receivedAt) : new Date()}, 'received')
    on conflict (inbox_message_id) do nothing
    returning *`;
  return rows[0] ?? null;
}

export async function getAsk(id: string): Promise<AskRow | null> {
  const rows = await sql<AskRow[]>`select * from asks where id = ${id}`;
  return rows[0] ?? null;
}

export async function getAskByInboxMessage(messageId: string): Promise<AskRow | null> {
  const rows = await sql<AskRow[]>`select * from asks where inbox_message_id = ${messageId}`;
  return rows[0] ?? null;
}

export async function setAskStatus(id: string, status: AskStatus): Promise<void> {
  await sql`update asks set status = ${status} where id = ${id}`;
}

export async function setAskStatuses(ids: string[], status: AskStatus): Promise<void> {
  if (ids.length === 0) return;
  await sql`update asks set status = ${status} where id in ${sql(ids)}`;
}

export async function saveParsed(id: string, parsed: ParsedAsk): Promise<void> {
  await sql`update asks set parsed = ${j(parsed)} where id = ${id}`;
}

export async function receivedAsks(): Promise<{ id: string }[]> {
  return sql<{ id: string }[]>`select id from asks where status = 'received' order by received_at asc`;
}

// ---------- evidence / decisions ----------

export async function saveEvidence(askId: string, claims: EvidenceClaim[]): Promise<void> {
  await sql`insert into evidence (ask_id, claims) values (${askId}, ${j(claims)})`;
}

export async function saveDecision(askId: string, decision: Decision, fits: Fit[]): Promise<void> {
  await sql`
    insert into decisions (ask_id, verdict, rule, decision, fits)
    values (${askId}, ${decision.verdict}, ${decision.rule}, ${j(decision)}, ${j(fits)})`;
}

export async function latestDecision(askId: string): Promise<DecisionRow | null> {
  const rows = await sql<DecisionRow[]>`
    select id, ask_id, verdict, rule, decision, fits from decisions where ask_id = ${askId} order by id desc limit 1`;
  return rows[0] ?? null;
}

/** Asks (other than `excludeAskId`) whose latest decision is one of `verdicts`, in a live status. */
export async function committedAsks(
  verdicts: string[],
  excludeAskId: string,
): Promise<{ id: string; parsed: ParsedAsk | null; received_at: Date; verdict: string }[]> {
  return sql<{ id: string; parsed: ParsedAsk | null; received_at: Date; verdict: string }[]>`
    select a.id, a.parsed, a.received_at, d.verdict
    from asks a
    join lateral (
      select verdict from decisions x where x.ask_id = a.id order by x.id desc limit 1
    ) d on true
    where a.status in ('received', 'triaged', 'awaiting_approval', 'sent', 'ready')
      and d.verdict in ${sql(verdicts)}
      and a.id <> ${excludeAskId}`;
  // 'received' + a decision = decided but still drafting: it already holds its evening / wildcard.
}

/**
 * Runs fn while holding a Postgres session advisory lock, so decisions are made one at a time
 * across every process that shares the database.
 */
export async function withDecisionLock<T>(fn: () => Promise<T>): Promise<T> {
  const conn = await sql.reserve();
  try {
    await conn`select pg_advisory_lock(hashtext('fewer:decide'))`;
    try {
      return await fn();
    } finally {
      await conn`select pg_advisory_unlock(hashtext('fewer:decide'))`;
    }
  } finally {
    conn.release();
  }
}

export async function listRatings(): Promise<Rating[]> {
  const rows = await sql<{ tag: string; rating: number; at: Date }[]>`
    select tag, rating, at from outcomes where rating between 1 and 5 and tag is not null order by at asc`;
  return rows.map((r) => ({ tag: r.tag, rating: r.rating as Rating["rating"], at: new Date(r.at).toISOString() }));
}

// ---------- drafts ----------

/** Replaces any not-yet-approved draft for the ask (re-triage), then inserts the new one. */
export async function saveDraft(d: {
  id: string;
  askId: string;
  toEmail: string;
  replyToMessageId: string | null;
  body: string;
  kind: "reply" | "question";
}): Promise<void> {
  await sql`
    delete from drafts
    where ask_id = ${d.askId}
      and not exists (select 1 from actions a where a.draft_id = drafts.id)
      and not exists (select 1 from approvals ap where ap.status = 'approved' and ap.draft_ids @> to_jsonb(drafts.id))`;
  await sql`
    insert into drafts (id, ask_id, to_email, reply_to_message_id, body, kind)
    values (${d.id}, ${d.askId}, ${d.toEmail}, ${d.replyToMessageId}, ${d.body}, ${d.kind})`;
}

export async function getDraftsByIds(ids: string[]): Promise<DraftRow[]> {
  if (ids.length === 0) return [];
  return sql<DraftRow[]>`select * from drafts where id in ${sql(ids)} order by id asc`;
}

/**
 * Latest draft per ask that is not already part of a live approval (pending+unexpired, or approved)
 * and has not been sent. Without askIds, only asks still waiting for a brief are considered.
 */
export async function draftsAwaitingBrief(askIds?: string[]): Promise<DraftRow[]> {
  const scoped = askIds && askIds.length > 0;
  return sql<DraftRow[]>`
    select d.* from (
      select distinct on (x.ask_id) x.* from drafts x order by x.ask_id, x.created_at desc, x.id desc
    ) d
    join asks a on a.id = d.ask_id
    where ${scoped ? sql`d.ask_id in ${sql(askIds!)}` : sql`a.status in ('triaged', 'awaiting_approval')`}
      and not exists (select 1 from actions ac where ac.draft_id = d.id and ac.status in ('sending', 'sent'))
      and not exists (
        select 1 from approvals ap
        where ap.draft_ids @> to_jsonb(d.id)
          and (ap.status = 'approved' or (ap.status = 'pending' and ap.expires_at > now()))
      )
    order by d.created_at asc, d.id asc`;
}

/** Blocked asks that no brief has listed yet. */
export async function unlistedBlockedAsks(): Promise<{ ask: AskRow; decision: Decision | null }[]> {
  const rows = await sql<(AskRow & { decision: Decision | null })[]>`
    select a.*, (select d.decision from decisions d where d.ask_id = a.id order by d.id desc limit 1) as decision
    from asks a
    where a.status = 'blocked'
      and not exists (select 1 from events_log e where e.kind = 'blocked_listed' and e.ask_id = a.id)
    order by a.received_at asc`;
  return rows.map(({ decision, ...ask }) => ({ ask: ask as AskRow, decision }));
}

// ---------- approvals ----------

export async function insertApproval(a: {
  id: string;
  code: string;
  payloadSha256: string;
  draftIds: string[];
  expiresAt: Date;
}): Promise<void> {
  await sql`
    insert into approvals (id, code, payload_sha256, draft_ids, status, expires_at)
    values (${a.id}, ${a.code}, ${a.payloadSha256}, ${j(a.draftIds)}, 'pending', ${a.expiresAt})`;
}

export async function codeInUse(code: string): Promise<boolean> {
  const rows = await sql`select 1 from approvals where code = ${code} and status = 'pending' and expires_at > now() limit 1`;
  return rows.length > 0;
}

export async function setApprovalBriefMessage(id: string, messageId: string): Promise<void> {
  await sql`update approvals set brief_message_id = ${messageId} where id = ${id}`;
}

export async function setApprovalStatus(id: string, status: ApprovalRow["status"]): Promise<void> {
  await sql`update approvals set status = ${status} where id = ${id} and status = 'pending'`;
}

export async function getApproval(id: string): Promise<ApprovalRow | null> {
  const rows = await sql<ApprovalRow[]>`select * from approvals where id = ${id}`;
  return rows[0] ?? null;
}

export async function findPendingApprovalByCode(code: string): Promise<ApprovalRow | null> {
  const rows = await sql<ApprovalRow[]>`
    select * from approvals where code = ${code} and status = 'pending' order by created_at desc limit 1`;
  return rows[0] ?? null;
}

/** Brief thread -> approval, via the events_log 'brief' mapping {threadId, approvalId}. */
export async function getApprovalByThread(threadId: string): Promise<ApprovalRow | null> {
  const rows = await sql<ApprovalRow[]>`
    select ap.* from approvals ap
    join events_log e on e.kind = 'brief' and e.detail->>'approvalId' = ap.id
    where e.detail->>'threadId' = ${threadId}
    order by ap.created_at desc limit 1`;
  return rows[0] ?? null;
}

/** Single-use claim: pending -> approved (or declined) atomically. Null if someone else got there first. */
export async function claimApproval(id: string, to: "approved" | "declined"): Promise<ApprovalRow | null> {
  const rows = await sql<ApprovalRow[]>`
    update approvals set status = ${to}, used_at = now()
    where id = ${id} and status = 'pending' and expires_at > now()
    returning *`;
  return rows[0] ?? null;
}

export async function expireStaleApprovals(): Promise<number> {
  const rows = await sql`update approvals set status = 'expired' where status = 'pending' and expires_at <= now() returning id`;
  return rows.length;
}

// ---------- actions (exactly-once send ledger) ----------

/** Inserts the 'sending' row BEFORE the send. Returns false if (approval, draft) already has a row. */
export async function claimAction(approvalId: string, draftId: string): Promise<boolean> {
  const rows = await sql`
    insert into actions (approval_id, draft_id, status) values (${approvalId}, ${draftId}, 'sending')
    on conflict do nothing
    returning id`;
  // No target: also yields to actions_one_live_per_draft, so a draft with a live (sending/sent/ready)
  // action under ANY approval is never claimed again, even across processes (Desk + Fly worker).
  return rows.length > 0;
}

export async function finishAction(
  approvalId: string,
  draftId: string,
  r: { status: "sent"; sentMessageId: string } | { status: "failed"; error: string } | { status: "ready" },
): Promise<void> {
  if (r.status === "ready") {
    // Approved, but there is no address to send to: the owner copies the reply from the Desk.
    await sql`update actions set status = 'ready' where approval_id = ${approvalId} and draft_id = ${draftId}`;
    return;
  }
  if (r.status === "sent") {
    await sql`update actions set status = 'sent', sent_message_id = ${r.sentMessageId}
              where approval_id = ${approvalId} and draft_id = ${draftId}`;
  } else {
    await sql`update actions set status = 'failed', error = ${r.error.slice(0, 500)}
              where approval_id = ${approvalId} and draft_id = ${draftId}`;
  }
}

// ---------- check-ins / outcomes ----------

export async function insertCheckin(c: { askId: string; sentMessageId: string; threadId: string }): Promise<void> {
  await sql`
    insert into checkins (ask_id, sent_message_id, thread_id, status)
    values (${c.askId}, ${c.sentMessageId}, ${c.threadId}, 'sent')`;
}

export async function getCheckinByThread(threadId: string): Promise<CheckinRow | null> {
  const rows = await sql<CheckinRow[]>`
    select * from checkins where thread_id = ${threadId} order by id desc limit 1`;
  return rows[0] ?? null;
}

export async function setCheckinStatus(id: string, status: string): Promise<void> {
  await sql`update checkins set status = ${status} where id = ${id}`;
}

/** Sent YES/WILDCARD asks with no check-in yet. */
export async function asksNeedingCheckin(): Promise<{ id: string; parsed: ParsedAsk | null; subject: string | null }[]> {
  return sql<{ id: string; parsed: ParsedAsk | null; subject: string | null }[]>`
    select a.id, a.parsed, a.subject
    from asks a
    join lateral (
      select verdict from decisions x where x.ask_id = a.id order by x.id desc limit 1
    ) d on true
    where a.status in ('sent', 'ready')
      and d.verdict in ('YES', 'WILDCARD')
      and not exists (select 1 from checkins c where c.ask_id = a.id)
    order by a.received_at asc`;
}

export async function insertOutcome(o: {
  askId: string;
  tag: string | null;
  rating: number | null;
  result: "completed" | "changed" | "abandoned" | "unknown";
  note: string | null;
}): Promise<void> {
  await sql`
    insert into outcomes (ask_id, tag, rating, result, note)
    values (${o.askId}, ${o.tag}, ${o.rating}, ${o.result}, ${o.note})`;
}

// ---------- proactive mode (read helpers + one atomic insert) ----------

/**
 * Like insertCheckin, but atomic and idempotent: no row is written if the ask already has a check-in
 * (the worker and the Desk's proactive button can race). Returns true when this call inserted the row.
 */
export async function insertCheckinIfAbsent(c: { askId: string; sentMessageId: string; threadId: string }): Promise<boolean> {
  const rows = await sql`
    insert into checkins (ask_id, sent_message_id, thread_id, status)
    select ${c.askId}::text, ${c.sentMessageId}::text, ${c.threadId}::text, 'sent'
    where not exists (select 1 from checkins x where x.ask_id = ${c.askId}::text)
    returning id`;
  return rows.length > 0;
}

/** Asks currently waiting for the owner's yes (the Desk's "Awaiting your yes"). */
export async function awaitingApprovalAsks(): Promise<{ id: string; parsed: ParsedAsk | null; subject: string | null }[]> {
  return sql<{ id: string; parsed: ParsedAsk | null; subject: string | null }[]>`
    select id, parsed, subject from asks where status = 'awaiting_approval' order by received_at asc, id asc`;
}

/** Asks whose latest verdict is YES/WILDCARD and that are still live, with their status. */
export async function liveCommitments(): Promise<
  { id: string; parsed: ParsedAsk | null; subject: string | null; status: string; verdict: string }[]
> {
  return sql<{ id: string; parsed: ParsedAsk | null; subject: string | null; status: string; verdict: string }[]>`
    select a.id, a.parsed, a.subject, a.status, d.verdict
    from asks a
    join lateral (
      select verdict from decisions x where x.ask_id = a.id order by x.id desc limit 1
    ) d on true
    where a.status in ('triaged', 'awaiting_approval', 'sent', 'ready')
      and d.verdict in ('YES', 'WILDCARD')
    order by a.received_at asc, a.id asc`;
}

/** The Desk read model only looks at this many most-recent asks; hours-protected must use the same window. */
const DESK_ASK_WINDOW = 40;

/**
 * Latest decision per ask made this week, over the same asks and the same week boundary the Desk
 * ledger uses (read-model.ts: 40 newest asks; Monday 00:00 in `tz`), so both show the same numbers.
 */
export async function weekDecisionRows(
  tz: string,
): Promise<{ verdict: string; costHours: number | null; smallerOffer: string | null }[]> {
  let weekStart: Date;
  try {
    const [w] = await sql<{ week_start: Date }[]>`
      select (date_trunc('week', now() at time zone ${tz}::text) at time zone ${tz}::text) as week_start`;
    weekStart = w.week_start;
  } catch {
    weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  }
  const rows = await sql<{ verdict: string; decision: Decision | null; created_at: Date }[]>`
    select distinct on (d.ask_id) d.verdict, d.decision, d.created_at
    from decisions d
    where d.ask_id in (select id from asks order by received_at desc, id desc limit ${DESK_ASK_WINDOW})
    order by d.ask_id, d.created_at desc, d.id desc`;
  return rows
    .filter((r) => new Date(r.created_at) >= weekStart)
    .map((r) => {
      const hours = r.decision?.cost?.hours;
      return {
        verdict: r.verdict ?? r.decision?.verdict ?? "",
        costHours: typeof hours === "number" ? hours : null,
        smallerOffer: r.decision?.smallerOffer ?? null,
      };
    });
}

/** Has the real (non-demo) morning brief already been sent for this local date (YYYY-MM-DD)? */
export async function morningBriefLogged(date: string): Promise<boolean> {
  const rows = await sql`
    select 1 from events_log
    where kind = 'morning_brief' and detail->>'date' = ${date}::text and coalesce(detail->>'demo', 'false') <> 'true'
    limit 1`;
  return rows.length > 0;
}

/** The most recent morning brief event (summary + facts as logged), or null. */
export async function latestMorningBrief(): Promise<{ at: Date; detail: Record<string, unknown> } | null> {
  const rows = await sql<{ at: Date; detail: Record<string, unknown> | null }[]>`
    select at, detail from events_log where kind = 'morning_brief' order by id desc limit 1`;
  const r = rows[0];
  return r ? { at: r.at, detail: r.detail ?? {} } : null;
}
