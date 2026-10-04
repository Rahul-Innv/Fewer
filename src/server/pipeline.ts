import { randomBytes, randomUUID } from "node:crypto";
import {
  canonicalJson,
  decide,
  firstReplyLine,
  makeApprovalCode,
  normalizeEmail,
  parseApprovalReply,
  sha256Hex,
  toLocalTime,
} from "../core";
import type { Boundary, Decision, DecisionContext, ParsedAsk } from "../core";
import { formatHours, plural, savedHoursForSmaller } from "../components/desk/format";
import { takenBlocksFor } from "./calendar";
import * as db from "./db";
import { renderDigestHtml } from "./email-html";
import * as mail from "./mail";

// Loaded lazily so Desk API routes (approve/decline/time-skip) don't pull Mastra/Exa into their bundles.
const loadLlm = () => import("./llm");
const loadResearch = () => import("./research");

/**
 * Fewer's pipeline: inbound mail -> ask -> triage (parse, research, decide, draft)
 * -> ONE brief to the approver -> YES <CODE> -> exactly-once sends -> next-day check-in.
 * Email text is untrusted DATA; only the approver's reply (or the Desk) can release a send.
 */

const APPROVAL_TTL_MIN = 30;

type InboundMessage = Awaited<ReturnType<typeof mail.getMessage>>;

function cfg() {
  const inbox = (process.env.FEWER_INBOX ?? "").trim();
  const approver = (process.env.FEWER_APPROVER ?? "").trim();
  if (!inbox) throw new Error("FEWER_INBOX is not set");
  if (!approver) throw new Error("FEWER_APPROVER is not set");
  return {
    inbox,
    approver,
    ownerName: (process.env.FEWER_OWNER_NAME ?? "").trim() || "Rahul",
    tz: (process.env.FEWER_TZ ?? "").trim() || "America/Los_Angeles",
  };
}

function log(msg: string): void {
  console.log(`[fewer] ${msg}`);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function shortId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Drops quoted history ("> ..." lines, "On ... wrote:" and below) from a reply. */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^On .+ wrote:$/.test(line) || /^-{2,}\s*Original Message/i.test(line)) break;
    if (line.startsWith(">")) continue;
    out.push(raw);
  }
  return out.join("\n").trim();
}

/** First integer 1-5 in the (unquoted) reply is the rating; the rest is the note. */
export function parseRating(text: string): { rating: number; note: string } | null {
  const body = stripQuoted(text);
  const m = /(?<![\d.])([1-5])(?![\d])/.exec(body);
  if (!m || m.index === undefined) return null;
  const rest = body.slice(0, m.index) + " " + body.slice(m.index + 1);
  const note = rest
    .replace(/^\s*(?:\/\s*5\b)?[\s:\-–—,.!]*/, "")
    .replace(/\s+/g, " ")
    .replace(/[\s:\-–—,]+$/, "")
    .trim();
  return { rating: Number(m[1]), note };
}

/** First non-empty line of a draft, skipping a bare greeting like "Hi Maya,". Truncated. */
export function draftFirstLine(body: string, max = 160): string {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const meaningful = lines.find((l) => !/^(hi|hello|hey|dear)\b[^.!?\n]{0,40},?$/i.test(l)) ?? lines[0] ?? "";
  return meaningful.length > max ? meaningful.slice(0, max - 1).trimEnd() + "…" : meaningful;
}

export interface BriefItem {
  verdict: string;
  from: string;
  title: string;
  reason: string;
  draftFirstLine: string;
}
export interface BlockedItem {
  from: string;
  title: string;
  reason: string;
}

export function formatBrief(o: { code: string; items: BriefItem[]; blocked: BlockedItem[] }): {
  subject: string;
  text: string;
} {
  const n = o.items.length + o.blocked.length;
  const subject = `Fewer brief — ${n} ask${n === 1 ? "" : "s"}`;
  const lines: string[] = [subject, ""];
  o.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.verdict} — from ${it.from}`);
    lines.push(`   ${it.title}`);
    if (it.reason) lines.push(`   Why: ${it.reason}`);
    if (it.draftFirstLine) lines.push(`   Draft: ${it.draftFirstLine}`);
    lines.push("");
  });
  if (o.blocked.length > 0) {
    lines.push("BLOCKED — no action taken");
    for (const b of o.blocked) {
      lines.push(`- from ${b.from}: ${b.title}${b.reason ? ` — ${b.reason}` : ""}`);
    }
    lines.push("");
  }
  lines.push(
    `Reply YES ${o.code} to send exactly these drafts. Reply NO to hold them. Code expires in ${APPROVAL_TTL_MIN} min.`,
  );
  return { subject, text: lines.join("\n") };
}

/** Hash binds an approval to the exact recipients and bodies; recomputed at approval time. */
export function payloadHash(drafts: { id: string; to_email: string; body: string }[]): string {
  const ordered = [...drafts]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((d) => ({ id: d.id, to: d.to_email, body: d.body }));
  return sha256Hex(canonicalJson(ordered));
}

/** Monday of the local week containing `iso`, as YYYY-MM-DD in `tz`. Null if unparseable. */
export function weekKey(iso: string, tz: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const local = toLocalTime(iso, tz);
  if (!local) return null;
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date,
  );
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  const monday = Date.UTC(y, m - 1, d) - ((local.dayIndex + 6) % 7) * 86_400_000;
  return new Date(monday).toISOString().slice(0, 10);
}

/** In-person ask starting 17:00 or later (local). Mirrors the core's evening rule. */
export function isEveningOut(ask: Pick<ParsedAsk, "startsAt" | "inPerson"> | null | undefined, tz: string): boolean {
  if (!ask?.startsAt || !ask.inPerson) return false;
  const local = toLocalTime(ask.startsAt, tz);
  return local !== null && local.minutes >= 17 * 60;
}

// ---------------------------------------------------------------------------
// Notifications to the approver
// ---------------------------------------------------------------------------

async function notifyApprover(
  text: string,
  o: { subject: string; replyToMessageId?: string; idempotencyKey?: string },
): Promise<void> {
  const c = cfg();
  try {
    if (o.replyToMessageId) {
      await mail.replyTo({ inboxId: c.inbox, messageId: o.replyToMessageId, text, idempotencyKey: o.idempotencyKey });
    } else {
      await mail.sendMail({ inboxId: c.inbox, to: [c.approver], subject: o.subject, text, idempotencyKey: o.idempotencyKey });
    }
  } catch (e) {
    await db.logEvent("notify_error", null, { error: errMsg(e) });
  }
}

// ---------------------------------------------------------------------------
// handleInbound
// ---------------------------------------------------------------------------

/**
 * Routes one inbound email. Intake (fetch, routing, approval/check-in replies, inserting the ask) is
 * awaited so a failure rejects and the inbox listener retries the message. Pass opts.background to
 * run the slow triage detached (the worker does); otherwise triage is awaited too.
 */
export async function handleInbound(
  inboxId: string,
  messageId: string,
  opts: { background?: (triageTask: Promise<void>) => void } = {},
): Promise<void> {
  const c = cfg();
  const msg = await mail.getMessage(inboxId, messageId);

  // Never process our own outbound mail.
  if (normalizeEmail(msg.from) === normalizeEmail(c.inbox)) {
    log(`ignored own message ${messageId}`);
    return;
  }

  if (normalizeEmail(msg.from) === normalizeEmail(c.approver)) {
    const approval = await db.getApprovalByThread(msg.threadId);
    if (approval) {
      await handleApprovalReply(msg, approval);
      return;
    }
    const checkin = await db.getCheckinByThread(msg.threadId);
    if (checkin) {
      await handleCheckinReply(msg, checkin);
      return;
    }
    // Threading can break (a fresh email instead of a reply): an approver-sent "YES <CODE>" that matches a
    // live pending code is still an approval reply, never an ask. Still gated by sender + single-use code.
    const line = firstReplyLine(msg.replyText);
    const m = line ? /^YES\s+([A-Z0-9]{4})\s*[.!]?$/i.exec(line) : null;
    const byCode = m ? await db.findPendingApprovalByCode(m[1]!.toUpperCase()) : null;
    if (byCode) {
      await handleApprovalReply(msg, byCode);
      return;
    }
    // A reply on any thread Fewer started (morning brief, receipts) is conversation, not a new ask.
    if (msg.threadId && (await db.isFewerThread(msg.threadId))) {
      log(`approver reply on a Fewer thread ${msg.threadId}; not an ask`);
      await db.logEvent("approver_note", null, { threadId: msg.threadId });
      return;
    }
  }

  // Otherwise: a normal ask (the owner may send asks too).
  const existing = await db.getAskByInboxMessage(msg.messageId);
  if (existing) {
    log(`duplicate delivery of ${messageId} (ask ${existing.id}); skipped`);
    return;
  }
  const askId = shortId("ask");
  const inserted = await db.insertAsk({
    id: askId,
    inboxMessageId: msg.messageId,
    threadId: msg.threadId,
    fromEmail: normalizeEmail(msg.from),
    fromName: msg.fromName,
    subject: msg.subject,
    rawText: msg.fullText || msg.replyText,
    receivedAt: msg.receivedAt,
  });
  if (!inserted) {
    log(`duplicate delivery of ${messageId}; skipped`);
    return;
  }
  await db.logEvent("received", askId, { from: normalizeEmail(msg.from), subject: msg.subject });
  log(`ask ${askId} received from ${normalizeEmail(msg.from)}`);
  if (opts.background) opts.background(triage(askId));
  else await triage(askId);
}

async function handleApprovalReply(msg: InboundMessage, approval: db.ApprovalRow): Promise<void> {
  const c = cfg();
  const parsed = parseApprovalReply({
    text: msg.replyText,
    from: msg.from,
    approverEmail: c.approver,
    expectedCode: approval.code,
  });
  await db.logEvent("approval_reply", null, { approvalId: approval.id, decision: parsed.decision, reason: parsed.reason });
  const subject = "Re: Fewer brief";

  if (parsed.decision === "approve") {
    const r = await approveByCode(approval.code, "email", { replyToMessageId: msg.messageId });
    if (!r.ok) {
      await notifyApprover(`Not sent: ${r.reason}.`, {
        subject,
        replyToMessageId: msg.messageId,
        idempotencyKey: `notsent.${msg.messageId}`,
      });
    }
    return;
  }
  if (parsed.decision === "decline") {
    if (approval.status === "pending") {
      await declineApproval(approval.id, { replyToMessageId: msg.messageId });
    } else {
      await notifyApprover(`That brief is already ${approval.status}; nothing changed.`, {
        subject,
        replyToMessageId: msg.messageId,
        idempotencyKey: `already.${msg.messageId}`,
      });
    }
    return;
  }
  // "none": never treat a brief reply as an ask. Nudge only when the code was wrong.
  if (parsed.reason === "code mismatch") {
    await notifyApprover("That code does not match this brief. Reply YES <CODE> exactly as shown at the bottom of the brief, or NO to hold.", {
      subject,
      replyToMessageId: msg.messageId,
      idempotencyKey: `mismatch.${msg.messageId}`,
    });
  }
  log(`brief reply ignored (${parsed.reason})`);
}

async function handleCheckinReply(msg: InboundMessage, checkin: db.CheckinRow): Promise<void> {
  const subject = "Re: Was it worth it?";
  if (checkin.status !== "sent") {
    log(`check-in ${checkin.id} already ${checkin.status}; reply ignored`);
    return;
  }
  const r = parseRating(msg.replyText);
  if (!r) {
    await notifyApprover("Reply with a number from 1 to 5 and a few words, e.g. \"4 — great founders, too loud\".", {
      subject,
      replyToMessageId: msg.messageId,
      idempotencyKey: `rate-hint.${msg.messageId}`,
    });
    return;
  }
  const ask = await db.getAsk(checkin.ask_id);
  await db.insertOutcome({
    askId: checkin.ask_id,
    tag: ask?.parsed?.tag ?? null,
    rating: r.rating,
    result: "completed",
    note: r.note || null,
  });
  await db.setCheckinStatus(checkin.id, "answered");
  await db.logEvent("rating", checkin.ask_id, { rating: r.rating, tag: ask?.parsed?.tag ?? null });
  log(`check-in for ${checkin.ask_id} rated ${r.rating}`);
  await notifyApprover("Thanks — noted.", {
    subject,
    replyToMessageId: msg.messageId,
    idempotencyKey: `rate-ack.${msg.messageId}`,
  });
}

// ---------------------------------------------------------------------------
// triage
// ---------------------------------------------------------------------------

/**
 * Rules context for one ask. `ignoreAskIds`: open asks a re-decide pass has not reached yet; they do not
 * count as taken time, so the best ask in a slot (re-decided first) is not blocked by a weaker one.
 */
export async function buildContext(
  askId: string,
  parsed: ParsedAsk,
  tz: string,
  opts: { ignoreAskIds?: ReadonlySet<string> } = {},
): Promise<DecisionContext> {
  const nowIso = new Date().toISOString();
  // The cap applies to the week the event happens in (falls back to the current week).
  const targetKey = weekKey(parsed.startsAt ?? nowIso, tz) ?? weekKey(nowIso, tz);
  const committed = await db.committedAsks(["YES", "WILDCARD"], askId);

  let evenings = 0;
  let wildcard = false;
  for (const a of committed) {
    const when = a.parsed?.startsAt ?? new Date(a.received_at).toISOString();
    const sameWeek = weekKey(when, tz) === targetKey;
    if (!sameWeek) continue;
    if (a.verdict === "WILDCARD") wildcard = true;
    if (isEveningOut(a.parsed, tz)) evenings += 1;
  }
  const [ratings, takenBlocks] = await Promise.all([
    db.listRatings(),
    takenBlocksFor(askId, parsed, opts.ignoreAskIds),
  ]);
  return {
    now: nowIso,
    timeZone: tz,
    eveningsOutThisWeek: evenings,
    wildcardUsedThisWeek: wildcard,
    ratings,
    ...(takenBlocks.length > 0 ? { takenBlocks } : {}),
  };
}

export async function triage(askId: string): Promise<void> {
  try {
    const c = cfg();
    const ask = await db.getAsk(askId);
    if (!ask) {
      log(`triage: ask ${askId} not found`);
      return;
    }
    const [journeys, boundaries, llm, research] = await Promise.all([
      db.listJourneys(),
      db.listBoundaries(),
      loadLlm(),
      loadResearch(),
    ]);
    const nowIso = new Date().toISOString();

    const parsedOut = await llm.parseAsk(
      {
        messageId: ask.inbox_message_id,
        from: senderForModel(ask.from_email),
        fromName: ask.from_name ?? undefined,
        subject: ask.subject ?? "",
        text: ask.raw_text ?? "",
        now: nowIso,
        timeZone: c.tz,
      },
      journeys,
    );
    // Copy-only Desk asks have no sender: give the parser a clearly non-deliverable placeholder. The
    // draft keeps the real (empty) address, so approving it stays copy-only and never sends.
    const parsed: ParsedAsk = { ...parsedOut.ask, id: askId, from: senderForModel(ask.from_email) };
    const fits = parsedOut.fits;
    await db.saveParsed(askId, parsed);
    log(`ask ${askId} parsed: ${parsed.kind} "${parsed.title}"`);

    // Instructions aimed at the agent are never researched or obeyed.
    const claims = parsed.containsInstructionsToAgent ? [] : await research.researchAsk(parsed);
    await db.saveEvidence(askId, claims);

    // Decide one ask at a time across processes (Fly worker + Desk server): parallel triages would
    // otherwise all read the same evening count / wildcard flag and could break absolute caps.
    const decision: Decision = await db.withDecisionLock(async () => {
      const ctx = await buildContext(askId, parsed, c.tz);
      const d = decide(parsed, fits, claims, journeys, boundaries, ctx);
      await db.saveDecision(askId, d, fits);
      return d;
    });
    log(`ask ${askId} decided: ${decision.verdict} (${decision.rule}), ${claims.length} claim(s)`);

    if (decision.verdict === "BLOCKED") {
      await db.setAskStatus(askId, "blocked");
      await db.logEvent("blocked", askId, { rule: decision.rule, reasons: decision.reasons });
      return;
    }

    // Copy-only Desk ask (no sender address) that Fewer declines: there is nobody to reply to.
    const copyOnly = !EMAIL_RE.test(ask.from_email ?? "") && !isDemoAsk(ask.inbox_message_id);
    if (copyOnly && decision.verdict === "NO") {
      await db.setAskStatus(askId, "ready");
      await db.logEvent("triaged", askId, { verdict: decision.verdict, rule: decision.rule, copyOnly: true, drafted: false });
      log(`ask ${askId} decided (copy-only, no draft needed)`);
      return;
    }

    const draft = await llm.draftReply({ ask: parsed, decision, ownerName: c.ownerName });
    await db.saveDraft({
      id: shortId("drf"),
      askId,
      toEmail: ask.from_email,
      replyToMessageId: isWebAsk(ask.inbox_message_id) || isDemoAsk(ask.inbox_message_id) ? null : ask.inbox_message_id,
      body: draft.body,
      kind: decision.verdict === "ASK_ONE" ? "question" : "reply",
    });
    await db.setAskStatus(askId, "triaged");
    await db.logEvent("triaged", askId, { verdict: decision.verdict, rule: decision.rule });
    log(`ask ${askId} drafted`);
  } catch (e) {
    log(`triage failed for ${askId}: ${errMsg(e)}`);
    try {
      await db.setAskStatus(askId, "error");
    } catch {
      /* swallow: never crash the worker */
    }
    await db.logEvent("error", askId, { stage: "triage", error: errMsg(e) });
  }
}

// ---------------------------------------------------------------------------
// brief
// ---------------------------------------------------------------------------

let briefChain: Promise<unknown> = Promise.resolve();

/** Serialised so two concurrent calls cannot put the same drafts in two approvals. */
export function sendBrief(askIds?: string[]): Promise<{ approvalId: string; code: string } | null> {
  const run = briefChain.then(() => sendBriefInner(askIds));
  briefChain = run.catch(() => undefined);
  return run;
}

async function freshCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = makeApprovalCode(randomBytes(4));
    if (!(await db.codeInUse(code))) return code;
  }
  return makeApprovalCode(randomBytes(4));
}

async function sendBriefInner(askIds?: string[]): Promise<{ approvalId: string; code: string } | null> {
  const c = cfg();
  const all = await db.draftsAwaitingBrief(askIds);
  const asksById = new Map((await Promise.all(all.map((d) => db.getAsk(d.ask_id)))).filter(Boolean).map((a) => [a!.id, a!]));
  const isDemoDraft = (d: { ask_id: string }) => isDemoAsk(asksById.get(d.ask_id)?.inbox_message_id ?? "");
  // An unscoped (worker) brief never picks up demo drafts; the Desk's demo run briefs its own asks.
  // Copy-only drafts (no deliverable address, not demo) never enter an approval: nothing would be sent.
  const sendable = all.filter((d) => isDemoDraft(d) || EMAIL_RE.test(d.to_email));
  const drafts = askIds && askIds.length > 0 ? sendable : sendable.filter((d) => !isDemoDraft(d));
  if (drafts.length === 0) return null;
  // Desk-only: every draft is a demo draft or has no deliverable address (copy-only). No brief email;
  // the Desk approval card is the approval path (also avoids one email per pasted calendar event).
  const demoOnly = drafts.every(isDemoDraft);
  const blocked = askIds && askIds.length > 0 ? [] : await db.unlistedBlockedAsks();

  const items: BriefItem[] = [];
  for (const d of drafts) {
    const [ask, dec] = await Promise.all([db.getAsk(d.ask_id), db.latestDecision(d.ask_id)]);
    items.push({
      verdict: dec?.verdict ?? "?",
      from: ask?.from_name ? `${ask.from_name} <${ask.from_email}>` : (ask?.from_email ?? d.to_email),
      title: ask?.parsed?.title || ask?.subject || "(untitled)",
      reason: dec?.decision?.reasons?.[0] ?? "",
      draftFirstLine: draftFirstLine(d.body),
    });
  }
  const blockedItems: BlockedItem[] = blocked.map((b) => ({
    from: b.ask.from_email,
    title: b.ask.parsed?.title || b.ask.subject || "(untitled)",
    reason: b.decision?.reasons?.[0] ?? "",
  }));

  const approvalId = randomUUID();
  const code = await freshCode();
  const sortedIds = drafts.map((d) => d.id).sort();
  await db.insertApproval({
    id: approvalId,
    code,
    payloadSha256: payloadHash(drafts),
    draftIds: sortedIds,
    expiresAt: new Date(Date.now() + APPROVAL_TTL_MIN * 60_000),
  });

  if (demoOnly) {
    // Demo: no email at all. The Desk's approval card is the approval path.
    await db.logEvent("brief", null, { approvalId, drafts: sortedIds.length, demo: true });
    await db.setAskStatuses(drafts.map((d) => d.ask_id), "awaiting_approval");
    log(`demo brief ready on the Desk: ${drafts.length} draft(s), no email (approval ${approvalId})`);
    return { approvalId, code };
  }

  const { subject, text } = formatBrief({ code, items, blocked: blockedItems });
  let sent: { messageId: string; threadId: string };
  try {
    sent = await mail.sendMail({
      inboxId: c.inbox,
      to: [c.approver],
      subject,
      text,
      idempotencyKey: `brief.${approvalId}`,
    });
  } catch (e) {
    await db.setApprovalStatus(approvalId, "expired"); // frees the drafts for the next attempt
    await db.logEvent("error", null, { stage: "brief", approvalId, error: errMsg(e) });
    throw e;
  }

  await db.setApprovalBriefMessage(approvalId, sent.messageId);
  await db.logEvent("brief", null, { approvalId, threadId: sent.threadId, drafts: sortedIds.length });
  await db.setAskStatuses(drafts.map((d) => d.ask_id), "awaiting_approval");
  for (const b of blocked) await db.logEvent("blocked_listed", b.ask.id, { approvalId });
  log(`brief sent: ${drafts.length} draft(s), ${blocked.length} blocked (approval ${approvalId})`);
  return { approvalId, code };
}

// ---------------------------------------------------------------------------
// approve / decline
// ---------------------------------------------------------------------------

export async function approveByCode(
  code: string,
  via: "email" | "desk",
  opts: { replyToMessageId?: string } = {},
): Promise<{ ok: boolean; reason: string; sent: number; simulated?: number }> {
  const normalized = code.trim().toUpperCase();
  const approval = await db.findPendingApprovalByCode(normalized);
  if (!approval) return { ok: false, reason: "no pending approval with that code", sent: 0 };
  if (new Date(approval.expires_at).getTime() <= Date.now()) {
    await db.setApprovalStatus(approval.id, "expired");
    return { ok: false, reason: "code expired", sent: 0 };
  }

  // Exactly what the approver saw: recompute the hash from the CURRENT drafts.
  const drafts = await db.getDraftsByIds(approval.draft_ids);
  if (drafts.length !== approval.draft_ids.length || payloadHash(drafts) !== approval.payload_sha256) {
    await db.setApprovalStatus(approval.id, "expired");
    await db.logEvent("approval_refused", null, { approvalId: approval.id, reason: "drafts changed" });
    return { ok: false, reason: "drafts changed since approval", sent: 0 };
  }

  // Single-use: only one caller wins the pending -> approved transition.
  const claimed = await db.claimApproval(approval.id, "approved");
  if (!claimed) return { ok: false, reason: "approval already used or expired", sent: 0 };
  await db.logEvent("approved", null, { approvalId: approval.id, via, drafts: drafts.length });

  const c = cfg();
  let sent = 0;
  let failed = 0;
  let simulated = 0;
  const demoReplies: { to: string; subject: string; body: string }[] = [];
  const receipts: string[] = [];
  for (const d of drafts) {
    // Ledger row first; a conflict means this (approval, draft) was already handled.
    const won = await db.claimAction(approval.id, d.id);
    if (!won) continue;
    try {
      const askRow = await db.getAsk(d.ask_id);
      if (askRow && isDemoAsk(askRow.inbox_message_id)) {
        // Demo ask: same claim + hash + single-use path, but nothing is emailed.
        await db.finishAction(approval.id, d.id, { status: "simulated" });
        await db.setAskStatus(d.ask_id, "simulated");
        simulated += 1;
        demoReplies.push({
          to: askRow.from_name ? `${askRow.from_name} <${askRow.from_email}>` : askRow.from_email,
          subject: `Re: ${askRow.subject || "your note"}`,
          body: d.body,
        });
        continue;
      }
      const idempotencyKey = `${approval.id}.${d.id}`;
      if (!d.reply_to_message_id && !EMAIL_RE.test(d.to_email)) {
        // A Desk ask with no address: approved, but nothing is sent. The owner copies it.
        await db.finishAction(approval.id, d.id, { status: "ready" });
        await db.setAskStatus(d.ask_id, "ready");
        receipts.push("1 reply ready to copy on the Desk (nothing sent)");
        continue;
      }
      const r = d.reply_to_message_id
        ? await mail.replyTo({ inboxId: c.inbox, messageId: d.reply_to_message_id, text: d.body, idempotencyKey })
        : await mail.sendMail({
            inboxId: c.inbox,
            to: [d.to_email],
            subject: `Re: ${(await db.getAsk(d.ask_id))?.subject || "your note"}`,
            text: d.body,
            idempotencyKey,
          });
      await db.finishAction(approval.id, d.id, { status: "sent", sentMessageId: r.messageId });
      await db.setAskStatus(d.ask_id, "sent");
      receipts.push(`${d.to_email} (${r.messageId})`);
      sent += 1;
    } catch (e) {
      failed += 1;
      await db.finishAction(approval.id, d.id, { status: "failed", error: errMsg(e) });
      await db.setAskStatus(d.ask_id, "error");
      await db.logEvent("error", d.ask_id, { stage: "send", error: errMsg(e) });
    }
  }
  log(`approval ${approval.id} via ${via}: sent ${sent}, failed ${failed}, simulated ${simulated}`);
  if (simulated > 0 && sent === 0 && failed === 0) {
    const replies = `${simulated} repl${simulated === 1 ? "y" : "ies"}`;
    const recipient = process.env.DEMO_RECIPIENT?.trim();
    await db.logEvent("approved_demo", null, { approvalId: approval.id, simulated });
    if (!recipient) {
      return { ok: true, reason: `Demo: ${replies} would be sent. Nothing was emailed.`, sent: 0, simulated };
    }
    // ONE digest to the owner, never to the fictional senders. Keyed by approval: sent once.
    const text = [
      `Fewer demo: you approved ${replies}. These are the emails Fewer would send. Nobody else was emailed.`,
      "",
      ...demoReplies.flatMap((r) => [`To: ${r.to}`, `Subject: ${r.subject}`, "", r.body, "", "----", ""]),
    ].join("\n");
    const html = renderDigestHtml(demoReplies);
    try {
      const r = await mail.sendMail({
        inboxId: c.inbox,
        to: [recipient],
        subject: `[Fewer demo] ${replies} Fewer would send`,
        text,
        html,
        idempotencyKey: `demo-digest.${approval.id}`,
      });
      await db.logEvent("demo_digest", null, { approvalId: approval.id, messageId: r.messageId, replies: simulated, demo: true });
      return { ok: true, reason: `Demo: ${replies} sent to your work inbox for review. Nobody else was emailed.`, sent: 0, simulated };
    } catch (e) {
      await db.logEvent("error", null, { stage: "demo_digest", approvalId: approval.id, error: errMsg(e) });
      return { ok: false, reason: `Demo: approved, but the review email to your inbox failed. Nobody else was emailed.`, sent: 0, simulated };
    }
  }

  const receipt =
    `Sent ${sent} repl${sent === 1 ? "y" : "ies"}.` +
    (failed > 0 ? ` ${failed} failed (see Desk).` : "") +
    (receipts.length > 0 ? ` Receipts: ${receipts.join(", ")}` : "");
  await notifyApprover(receipt, {
    subject: "Re: Fewer brief",
    replyToMessageId: opts.replyToMessageId,
    idempotencyKey: `receipt.${approval.id}`,
  });

  return failed === 0
    ? { ok: true, reason: `sent ${sent}`, sent }
    : { ok: false, reason: `sent ${sent}, ${failed} failed`, sent };
}

export async function declineApproval(approvalId: string, opts: { replyToMessageId?: string } = {}): Promise<void> {
  const claimed = await db.claimApproval(approvalId, "declined");
  if (!claimed) {
    // Expired approvals cannot be claimed; still make the decline explicit.
    await db.setApprovalStatus(approvalId, "declined");
    return;
  }
  const drafts = await db.getDraftsByIds(claimed.draft_ids);
  await db.setAskStatuses(
    drafts.map((d) => d.ask_id),
    "declined",
  );
  await db.logEvent("declined", null, { approvalId, drafts: drafts.length });
  log(`approval ${approvalId} declined; ${drafts.length} draft(s) held`);
  await notifyApprover(`Held ${drafts.length} draft${drafts.length === 1 ? "" : "s"}. Nothing was sent.`, {
    subject: "Re: Fewer brief",
    replyToMessageId: opts.replyToMessageId,
    idempotencyKey: `declined.${approvalId}`,
  });
}

// ---------------------------------------------------------------------------
// check-ins (demo time skip)
// ---------------------------------------------------------------------------

type CheckinCandidate = { id: string; parsed: ParsedAsk | null; subject: string | null };

/**
 * The one "Was it worth it? 1-5" email, shared by the demo time skip and the automatic follow-ups.
 * `opening` is the sentence before the question (the demo says "Yesterday"; the real path names the time).
 * The Idempotency-Key is per ask, and the check-in row is inserted only if the ask has none, so the
 * worker and the Desk button can never double-send or double-record. Returns true when this call sent it.
 */
async function sendCheckin(
  c: { inbox: string; approver: string },
  a: CheckinCandidate,
  opening: (title: string) => string,
): Promise<boolean> {
  const title = a.parsed?.title || a.subject || "that ask";
  try {
    const sent = await mail.sendMail({
      inboxId: c.inbox,
      to: [c.approver],
      subject: `Was it worth it? — ${title}`,
      text: `${opening(title)} Was it worth it? Reply 1–5 and a few words.`,
      idempotencyKey: `checkin.${a.id}`,
    });
    const inserted = await db.insertCheckinIfAbsent({ askId: a.id, sentMessageId: sent.messageId, threadId: sent.threadId });
    if (!inserted) return false; // someone else recorded this ask's check-in first
    await db.logEvent("checkin_sent", a.id, { threadId: sent.threadId });
    return true;
  } catch (e) {
    await db.logEvent("error", a.id, { stage: "checkin", error: errMsg(e) });
    return false;
  }
}

/** Sends "Was it worth it? 1-5" for sent YES/WILDCARD asks that have no check-in. Returns how many. */
export async function timeSkipCheckins(): Promise<number> {
  const c = cfg();
  const asks = await db.asksNeedingCheckin();
  let n = 0;
  for (const a of asks) {
    if (await sendCheckin(c, a, (title) => `Yesterday you said yes to ${title}.`)) n += 1;
  }
  log(`time skip: ${n} check-in(s) sent`);
  return n;
}

// ---------------------------------------------------------------------------
// Web intake: asks pasted into the Desk (email stays a second channel)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The sender handed to the parser: the real address, or a non-deliverable placeholder for copy-only asks. */
export const NO_SENDER = "you@desk.local";
export function senderForModel(fromEmail: string | null | undefined): string {
  return fromEmail && EMAIL_RE.test(fromEmail) ? fromEmail : NO_SENDER;
}

export function isWebAsk(inboxMessageId: string): boolean {
  return inboxMessageId.startsWith("web-");
}

/** Asks created by the Desk's "Run demo": never emailed, approval is simulated. */
export function isDemoAsk(inboxMessageId: string): boolean {
  return inboxMessageId.startsWith("demo-");
}

/** Records one demo ask (no email), the same way a Desk paste is recorded. */
export async function submitDemoAsk(i: { subject: string; text: string; fromEmail: string; fromName: string }): Promise<string> {
  const askId = shortId("ask");
  await db.insertAsk({
    id: askId,
    inboxMessageId: `demo-${randomUUID()}`,
    threadId: null,
    fromEmail: i.fromEmail,
    fromName: i.fromName,
    subject: i.subject,
    rawText: i.text,
  });
  await db.logEvent("received", askId, { source: "demo", from: i.fromEmail });
  return askId;
}

/**
 * Records an ask typed or pasted into the Desk. Returns at once; call runWebAsk(askId) after
 * the response to triage it and send the approval brief (the Desk shows "Reading..." meanwhile).
 */
export async function submitWebAsk(i: {
  text: string;
  subject?: string;
  fromEmail?: string;
  fromName?: string;
}): Promise<{ askId: string }> {
  const askId = shortId("ask");
  const fromEmail = i.fromEmail && EMAIL_RE.test(i.fromEmail.trim()) ? normalizeEmail(i.fromEmail.trim()) : "";
  const firstLine = i.text.trim().split(/\r?\n/)[0]?.slice(0, 120) ?? "";
  await db.insertAsk({
    id: askId,
    inboxMessageId: `web-${randomUUID()}`,
    threadId: null,
    fromEmail,
    fromName: i.fromName?.trim() || undefined,
    subject: i.subject?.trim() || firstLine || "Ask from the Desk",
    rawText: i.text,
  });
  await db.logEvent("received", askId, { source: "web", from: fromEmail || null });
  log(`ask ${askId} received from the Desk`);
  return { askId };
}

/** Triage a Desk ask, then put it in front of the owner for approval. */
export async function runWebAsk(askId: string): Promise<void> {
  await triage(askId);
  const ask = await db.getAsk(askId);
  if (ask?.status !== "triaged") return;
  // Copy-only (no sender address): decided, the reply is there to copy; no approval needed.
  if (!EMAIL_RE.test(ask.from_email ?? "")) await db.setAskStatus(askId, "ready");
  else await sendBrief([askId]);
}

// ---------------------------------------------------------------------------
// Proactive mode: guard the owner's time. Two jobs, both from facts already in the database:
//  1. automatic follow-up: "Was it worth it?" once a YES the owner approved has ended;
//  2. a morning brief: what waits on the owner's yes, evenings left, hours protected, the next 24h.
// Neither job looks for new events or creates asks.
// ---------------------------------------------------------------------------

/** One queue per job: overlapping ticks (worker interval + Desk button) run one after the other. */
const queues: Record<"checkins" | "morning", Promise<unknown>> = {
  checkins: Promise.resolve(),
  morning: Promise.resolve(),
};

function enqueue<T>(key: keyof typeof queues, fn: () => Promise<T>): Promise<T> {
  const run = queues[key].then(fn);
  queues[key] = run.catch(() => undefined);
  return run;
}

/** An event that ended longer ago than this is not followed up (a long outage must not flood the owner). */
export const CHECKIN_MAX_AGE_MS = 7 * 24 * 3_600_000;
const DEFAULT_EVENT_MIN = 60;

/** When the ask's event ends (ms since epoch): startsAt + durationMin (60 when unstated). Null without a usable start. */
export function checkinDueAt(parsed: Pick<ParsedAsk, "startsAt" | "durationMin"> | null | undefined): number | null {
  if (!parsed?.startsAt) return null;
  const start = Date.parse(parsed.startsAt);
  if (Number.isNaN(start)) return null;
  const minutes = typeof parsed.durationMin === "number" && parsed.durationMin > 0 ? parsed.durationMin : DEFAULT_EVENT_MIN;
  return start + minutes * 60_000;
}

/** Asks whose event has ended (and not longer ago than CHECKIN_MAX_AGE_MS). Undated asks are never due. */
export function selectDueCheckins<T extends { parsed: Pick<ParsedAsk, "startsAt" | "durationMin"> | null }>(
  asks: T[],
  now: Date,
): T[] {
  const t = now.getTime();
  return asks.filter((a) => {
    const end = checkinDueAt(a.parsed);
    return end !== null && end <= t && t - end <= CHECKIN_MAX_AGE_MS;
  });
}

/** "Tue, Oct 6, 5:30 PM" in `tz` (plain spaces: newer ICU puts a narrow no-break space before PM). */
export function localWhen(iso: string, tz: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(d)
    .replace(/[  ]/g, " ");
}

/** YYYY-MM-DD of the instant in `tz`. Null if unparseable. */
export function localDateKey(at: Date | string, tz: string): string | null {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** 08:00 to 08:05 local (inclusive): the worker's window for sending the morning brief. */
export function isMorningBriefWindow(now: Date, tz: string): boolean {
  const local = toLocalTime(now.toISOString(), tz);
  return local !== null && local.minutes >= 8 * 60 && local.minutes <= 8 * 60 + 5;
}

/**
 * Follow up on YES/WILDCARD asks the owner approved (status 'sent') whose event has ended and that have
 * no check-in yet: the same "Was it worth it? 1-5" email the demo time skip sends. Returns how many.
 */
export function runDueCheckins(now: Date = new Date()): Promise<number> {
  return enqueue("checkins", async () => {
    const c = cfg();
    const due = selectDueCheckins(await db.asksNeedingCheckin(), now);
    let n = 0;
    for (const a of due) {
      const when = a.parsed?.startsAt ? localWhen(a.parsed.startsAt, c.tz) : null;
      const sent = await sendCheckin(c, a, (title) =>
        when ? `You said yes to ${title} (${when}).` : `You said yes to ${title}.`,
      );
      if (sent) n += 1;
    }
    if (n > 0) log(`proactive: ${n} due check-in(s) sent`);
    return n;
  });
}

// ----- morning brief -----

export interface BriefCommitment {
  title: string;
  /** asks.status of a YES/WILDCARD ask. */
  status: string;
  startsAt?: string | null;
  inPerson: boolean;
}

export interface WeekDecision {
  verdict: string;
  costHours: number | null;
  smallerOffer: string | null;
}

/** Everything buildMorningBrief may say. A null section means "could not be read": the brief says unknown. */
export interface MorningBriefData {
  /** ISO instant the brief is built for. */
  now: string;
  /** Asks with status awaiting_approval. */
  awaiting: { title: string }[] | null;
  boundaries: Pick<Boundary, "strength" | "rule">[] | null;
  /** Live YES/WILDCARD asks (triaged, awaiting_approval, sent, ready). */
  commitments: BriefCommitment[] | null;
  /** Latest decision per ask made this week: the rows the Desk ledger counts. */
  weekDecisions: WeekDecision[] | null;
}

export interface MorningBriefFacts {
  /** Local date (YYYY-MM-DD) the brief is for. */
  date: string;
  awaiting: { count: number; titles: string[] } | null;
  /** null: no absolute evenings boundary, so the line is omitted. cap/used/left null: unknown. */
  evenings: { cap: number | null; used: number | null; left: number | null } | null;
  hoursProtected: number | null;
  upcoming: { title: string; startsAt: string; inPerson: boolean }[] | null;
}

/** Statuses the rules (buildContext) count toward the weekly evenings cap. */
const CAP_STATUSES = new Set(["received", "triaged", "awaiting_approval", "sent", "ready", "simulated"]);
/** Statuses where the owner has said yes: the commitment is real. */
const APPROVED_STATUSES = new Set(["sent", "ready"]);
const BRIEF_TITLES_SHOWN = 5;

/** One line, control characters stripped, capped: ask titles are untrusted text and must not fake brief lines. */
function oneLine(s: string, max = 100): string {
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() || "(untitled)";
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/**
 * Hours protected so far this week. Same definition as the Desk ledger (read-model.ts):
 * NO = cost.hours; SMALLER = cost.hours minus what the smaller offer costs (savedHoursForSmaller).
 */
export function weekHoursProtected(rows: WeekDecision[]): number {
  let total = 0;
  for (const r of rows) {
    const hours = r.costHours ?? 0;
    if (r.verdict === "NO") total += hours;
    else if (r.verdict === "SMALLER") total += savedHoursForSmaller(hours, r.smallerOffer);
  }
  return Math.round(total * 10) / 10;
}

/**
 * The morning brief, from existing database facts only. Pure: no clock, no I/O.
 * `summary` is the one-line version the Desk shows; `facts` is the same content as data.
 */
export function buildMorningBrief(
  data: MorningBriefData,
  tz: string,
): { subject: string; text: string; summary: string; facts: MorningBriefFacts } {
  const now = new Date(data.now);
  const nowMs = now.getTime();
  const date = localDateKey(now, tz) ?? "";
  const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(
    now,
  );

  const awaiting =
    data.awaiting === null ? null : { count: data.awaiting.length, titles: data.awaiting.map((a) => oneLine(a.title)) };

  // Evenings out left = the absolute weekly cap minus committed in-person asks starting 17:00+ local this week.
  const caps = (data.boundaries ?? []).flatMap((b) =>
    b.strength === "absolute" && b.rule.type === "max_evenings_out_per_week" ? [b.rule.n] : [],
  );
  let evenings: MorningBriefFacts["evenings"] = null;
  if (data.boundaries === null || caps.length > 0) {
    const cap = caps.length > 0 ? Math.min(...caps) : null;
    const thisWeek = weekKey(data.now, tz);
    let used: number | null = null;
    if (data.commitments !== null && thisWeek !== null) {
      used = data.commitments.filter(
        (c) =>
          !!c.startsAt &&
          CAP_STATUSES.has(c.status) &&
          isEveningOut({ startsAt: c.startsAt, inPerson: c.inPerson }, tz) &&
          weekKey(c.startsAt, tz) === thisWeek,
      ).length;
    }
    evenings = { cap, used, left: cap !== null && used !== null ? Math.max(0, cap - used) : null };
  }

  const hoursProtected = data.weekDecisions === null ? null : weekHoursProtected(data.weekDecisions);

  // Upcoming: approved YES/WILDCARD commitments starting within the next 24 hours.
  const upcoming =
    data.commitments === null
      ? null
      : data.commitments
          .flatMap((c) =>
            APPROVED_STATUSES.has(c.status) && c.startsAt
              ? [{ title: oneLine(c.title), startsAt: c.startsAt, inPerson: c.inPerson, ms: Date.parse(c.startsAt) }]
              : [],
          )
          .filter((c) => Number.isFinite(c.ms) && c.ms >= nowMs && c.ms <= nowMs + 24 * 3_600_000)
          .sort((a, b) => a.ms - b.ms)
          .map(({ title, startsAt, inPerson }) => ({ title, startsAt, inPerson }));

  const facts: MorningBriefFacts = { date, awaiting, evenings, hoursProtected, upcoming };

  // ----- one-line summary (Desk) -----
  const parts: string[] = [];
  parts.push(
    awaiting === null
      ? "Asks waiting on your yes: unknown"
      : awaiting.count === 0
        ? "Nothing waiting on your yes"
        : `${plural(awaiting.count, "ask")} waiting on your yes`,
  );
  if (evenings) {
    parts.push(
      evenings.left !== null && evenings.cap !== null
        ? `${evenings.left} of ${evenings.cap} ${evenings.cap === 1 ? "evening" : "evenings"} out left this week`
        : "Evenings out left this week: unknown",
    );
  }
  parts.push(
    hoursProtected === null ? "Hours protected this week: unknown" : `${formatHours(hoursProtected)}h protected so far this week`,
  );
  parts.push(
    upcoming === null
      ? "Next 24 hours: unknown"
      : upcoming.length === 0
        ? "No yes-commitments in the next 24 hours"
        : `${plural(upcoming.length, "yes-commitment")} in the next 24 hours`,
  );
  const summary = parts.join(". ") + ".";

  // ----- email body -----
  const subject = `Fewer morning brief — ${dayLabel}`;
  const lines: string[] = [subject, ""];
  if (awaiting === null) {
    lines.push("Waiting on your yes: unknown (could not read your asks).");
  } else if (awaiting.count === 0) {
    lines.push("Waiting on your yes: nothing.");
  } else {
    lines.push(`Waiting on your yes: ${awaiting.count}`);
    for (const t of awaiting.titles.slice(0, BRIEF_TITLES_SHOWN)) lines.push(`- ${t}`);
    if (awaiting.titles.length > BRIEF_TITLES_SHOWN) lines.push(`- and ${awaiting.titles.length - BRIEF_TITLES_SHOWN} more`);
  }
  if (evenings) {
    if (evenings.left !== null && evenings.cap !== null && evenings.used !== null) {
      lines.push(`Evenings out left this week: ${evenings.left} of ${evenings.cap} (${evenings.used} committed)`);
    } else if (evenings.cap !== null) {
      lines.push(`Evenings out left this week: unknown (the limit is ${evenings.cap}; could not read your commitments).`);
    } else {
      lines.push("Evenings out left this week: unknown (could not read your boundaries).");
    }
  }
  lines.push(
    hoursProtected === null
      ? "Hours protected so far this week: unknown (could not read decisions)."
      : `Hours protected so far this week: ${formatHours(hoursProtected)}h`,
  );
  if (upcoming === null) {
    lines.push("Next 24 hours: unknown (could not read your commitments).");
  } else if (upcoming.length === 0) {
    lines.push("Next 24 hours: no yes-commitments.");
  } else {
    lines.push("Next 24 hours:");
    for (const u of upcoming) {
      lines.push(`- ${localWhen(u.startsAt, tz) ?? u.startsAt}, ${u.title}${u.inPerson ? " (in person)" : ""}`);
    }
  }
  return { subject, text: lines.join("\n"), summary, facts };
}

type MorningBriefResult = { sent: boolean; summary: string; error?: string; alreadySentToday?: boolean };

/**
 * Builds the brief from the database and emails it to the approver. Never throws on a send failure.
 * `demo` (the Desk button) always sends a fresh email under its own Idempotency-Key and logs the event as
 * demo, so a rehearsal click can neither burn the real brief nor suppress the 08:00 one.
 */
async function morningBriefInner(now: Date, demo: boolean): Promise<MorningBriefResult> {
  const c = cfg();
  const [awaiting, boundaries, commitments, weekDecisions] = await Promise.all([
    db.awaitingApprovalAsks().catch(() => null),
    db.listBoundaries().catch(() => null),
    db.liveCommitments().catch(() => null),
    db.weekDecisionRows(c.tz).catch(() => null),
  ]);
  const brief = buildMorningBrief(
    {
      now: now.toISOString(),
      awaiting: awaiting && awaiting.map((a) => ({ title: a.parsed?.title || a.subject || "(untitled)" })),
      boundaries,
      commitments:
        commitments &&
        commitments.map((a) => ({
          title: a.parsed?.title || a.subject || "(untitled)",
          status: a.status,
          startsAt: a.parsed?.startsAt ?? null,
          inPerson: a.parsed?.inPerson ?? false,
        })),
      weekDecisions,
    },
    c.tz,
  );
  const date = brief.facts.date || now.toISOString().slice(0, 10);
  if (!demo && (await db.morningBriefLogged(date).catch(() => false))) {
    return { sent: false, summary: brief.summary, alreadySentToday: true };
  }
  const subject = demo ? `${brief.subject} (demo run)` : brief.subject;
  try {
    const sent = await mail.sendMail({
      inboxId: c.inbox,
      to: [c.approver],
      subject,
      text: brief.text,
      idempotencyKey: demo ? `morning.${date}.demo.${Math.floor(now.getTime() / 60_000)}` : `morning.${date}`,
    });
    await db.logEvent("morning_brief", null, {
      date,
      summary: brief.summary,
      subject,
      facts: brief.facts,
      messageId: sent.messageId,
      threadId: sent.threadId,
      ...(demo ? { demo: true } : {}),
    });
    log(`morning brief sent for ${date}: ${brief.summary}`);
    return { sent: true, summary: brief.summary };
  } catch (e) {
    await db.logEvent("error", null, { stage: "morning_brief", error: errMsg(e) });
    return { sent: false, summary: brief.summary, error: errMsg(e) };
  }
}

/**
 * Email the morning brief now. The Idempotency-Key is per local date (morning.<YYYY-MM-DD>), so a second call
 * the same day cannot put a second email in the inbox: it reports alreadySentToday instead. The Desk's labeled
 * demo button passes `{ demo: true }` to send a fresh, clearly marked one.
 */
export function runMorningBrief(now: Date = new Date(), opts: { demo?: boolean } = {}): Promise<MorningBriefResult> {
  return enqueue("morning", () => morningBriefInner(now, opts.demo === true));
}

/** Worker tick: run the morning brief only inside the 08:00-08:05 local window and once per local date. */
export function runMorningBriefIfDue(now: Date = new Date()): Promise<MorningBriefResult | null> {
  return enqueue("morning", async () => {
    const c = cfg();
    if (!isMorningBriefWindow(now, c.tz)) return null;
    const date = localDateKey(now, c.tz);
    if (!date || (await db.morningBriefLogged(date))) return null;
    return morningBriefInner(now, false);
  });
}
