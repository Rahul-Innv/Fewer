import { createHash } from "node:crypto";
import type { Decision, ParsedAsk } from "../core";
import { logEvent, sql } from "./db";
import { sendMail } from "./mail";

/**
 * "Email me my plan": one plain-text email, to the owner's own inbox only, summarising what Fewer
 * has decided so far. Pure parts (buildPlan, formatPlanEmail, planIdempotencyKey, assertOnlyRecipient)
 * are unit-tested; emailPlan is the orchestration the route calls.
 *
 * Safety: the only address this ever mails is DEMO_RECIPIENT. Fictional demo senders and real
 * organisers are never written to. Same plan text gives the same idempotency key, so AgentMail
 * dedupes a double click; a changed plan sends a fresh email.
 */

export type PlanScope = "live" | "demo";

export const DEFAULT_PLAN_TZ = "America/Los_Angeles";

/** One ask plus its latest decision, as read from the database. */
export interface PlanRow {
  subject?: string | null;
  parsed?: (Partial<ParsedAsk> & { location?: string }) | null;
  verdict?: string | null;
  rule?: string | null;
  decision?: Partial<Pick<Decision, "verdict" | "reasons" | "smallerOffer" | "question">> | null;
}

export interface PlanGoing {
  when: string;
  title: string;
  location: string;
  url: string;
  reason: string;
}
export interface PlanSmaller {
  title: string;
  when: string;
  offer: string;
}
export interface PlanAskOne {
  title: string;
  question: string;
}
export interface Plan {
  going: PlanGoing[];
  smaller: PlanSmaller[];
  askOne: PlanAskOne[];
  /** NO + BLOCKED */
  declined: number;
}

// ---------- pure: dashes ----------

const DASH_CLASS = String.raw`[\u2012-\u2015]`; // figure dash, en dash, em dash, horizontal bar
const AMPM = String.raw`[ \t]?[ap]\.?m\.?`;

/**
 * Local dash sanitizer (this module must stay free of server-only imports). No em dash or en dash
 * survives: a spaced dash becomes a comma ("a, b"), digit ranges (5 dash 6, 5 PM dash 6 PM) become "5 to 6", anything else ", ".
 */
export function stripPlanDashes(text: string): string {
  if (!new RegExp(DASH_CLASS).test(text)) return text;
  return text
    .replace(new RegExp(String.raw`^([ \t]*)${DASH_CLASS}+[ \t]*`, "gm"), "$1") // a dash opening a line
    .replace(new RegExp(String.raw`[ \t]*${DASH_CLASS}+[ \t]*$`, "gm"), "") // a dash closing a line
    .replace(
      new RegExp(String.raw`(\d(?:${AMPM})?)[ \t]*${DASH_CLASS}[ \t]*(?=[$€£]?\d)`, "gi"),
      "$1 to ",
    )
    .replace(new RegExp(String.raw`[ \t]*${DASH_CLASS}+[ \t]*`, "g"), ", ")
    .replace(/,(?:[ \t]*,)+/g, ",")
    .replace(/[ \t]+,/g, ",")
    .replace(/,[ \t]*(?=[.!?;:])/g, "")
    .replace(/(?<=\S)[ \t]{2,}(?=\S)/g, " ");
}

// ---------- pure: build ----------

const oneLine = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

function validTz(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_PLAN_TZ;
  }
}

/** "Tue, Oct 6, 5:30 PM" in `tz`. Built from parts so ICU's narrow no-break space never sneaks in. */
export function formatWhen(iso: string | undefined | null, tz: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTz(tz),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(t));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

const startMs = (row: PlanRow): number => {
  const t = row.parsed?.startsAt ? Date.parse(row.parsed.startsAt) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

function byStart(a: { ms: number; title: string }, b: { ms: number; title: string }): number {
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1; // handles Infinity without NaN from Infinity - Infinity
  return a.title.localeCompare(b.title);
}

export function buildPlan(rows: PlanRow[], tz: string): Plan {
  const going: Array<PlanGoing & { ms: number }> = [];
  const smaller: Array<PlanSmaller & { ms: number }> = [];
  const askOne: PlanAskOne[] = [];
  let declined = 0;

  for (const row of rows) {
    const verdict = row.verdict ?? row.decision?.verdict ?? null;
    if (!verdict) continue; // not decided yet
    const parsed = row.parsed ?? null;
    const title = oneLine(parsed?.title) || oneLine(row.subject) || "(untitled)";
    const when = formatWhen(parsed?.startsAt, tz);
    const ms = startMs(row);

    if (verdict === "YES" || verdict === "WILDCARD") {
      going.push({
        when,
        title,
        location: oneLine(parsed?.location) || oneLine(parsed?.organizer),
        url: oneLine(parsed?.url),
        reason: oneLine(row.decision?.reasons?.[0]),
        ms,
      });
    } else if (verdict === "SMALLER") {
      smaller.push({ title, when, offer: oneLine(row.decision?.smallerOffer), ms });
    } else if (verdict === "ASK_ONE") {
      askOne.push({ title, question: oneLine(row.decision?.question) });
    } else if (verdict === "NO" || verdict === "BLOCKED") {
      declined += 1;
    }
  }

  going.sort(byStart);
  smaller.sort(byStart);
  return {
    going: going.map((g) => ({ when: g.when, title: g.title, location: g.location, url: g.url, reason: g.reason })),
    smaller: smaller.map((s) => ({ title: s.title, when: s.when, offer: s.offer })),
    askOne,
    declined,
  };
}

// ---------- pure: format ----------

export function formatPlanEmail(plan: Plan): { subject: string; text: string } {
  const n = plan.going.length;
  const subject = `Your Tech Week plan from Fewer: ${n} event${n === 1 ? "" : "s"}`;

  const sections: string[] = [];

  if (plan.going.length) {
    const lines = ["Going"];
    for (const g of plan.going) {
      lines.push(`- ${g.when ? `${g.when}: ` : ""}${g.title}${g.location ? ` (${g.location})` : ""}`);
      if (g.url) lines.push(`  Link: ${g.url}`);
      if (g.reason) lines.push(`  Why: ${g.reason}`);
    }
    sections.push(lines.join("\n"));
  }

  if (plan.smaller.length) {
    const lines = ["Shorter or maybe"];
    for (const s of plan.smaller) {
      lines.push(`- ${s.title}${s.when ? ` (${s.when})` : ""}`);
      if (s.offer) lines.push(`  Fewer suggests: ${s.offer}`);
    }
    sections.push(lines.join("\n"));
  }

  if (plan.askOne.length) {
    const lines = ["Needs one answer"];
    for (const a of plan.askOne) {
      lines.push(`- ${a.title}`);
      if (a.question) lines.push(`  Question: ${a.question}`);
    }
    sections.push(lines.join("\n"));
  }

  if (plan.declined > 0) {
    sections.push(`Fewer said no to ${plan.declined} other ask${plan.declined === 1 ? "" : "s"}.`);
  }

  return { subject: stripPlanDashes(subject), text: stripPlanDashes(sections.join("\n\n")) };
}

/** Stable per plan content: the same plan dedupes at AgentMail, a changed plan sends fresh. */
export function planIdempotencyKey(subject: string, text: string): string {
  return "plan." + createHash("sha256").update(`${subject}\n${text}`).digest("hex").slice(0, 40);
}

// ---------- recipient guard ----------

/** A single bare address: no list separators, no display-name form, no whitespace. */
export function isSingleAddress(value: string): boolean {
  return /^[^\s,;<>"]+@[^\s,;<>"]+$/.test(value);
}

/** Last line of defence before sending: `to` must be exactly [DEMO_RECIPIENT]. Throws otherwise. */
export function assertOnlyRecipient(to: string[]): void {
  const recipient = (process.env.DEMO_RECIPIENT ?? "").trim();
  if (!recipient || to.length !== 1 || to[0] !== recipient) {
    throw new Error("Refusing to send: the plan may only go to DEMO_RECIPIENT.");
  }
}

// ---------- database ----------

/** Every ask in scope with its latest decision (decisions ordered by id desc). Undecided asks are skipped. */
export async function loadPlanRows(scope: PlanScope): Promise<PlanRow[]> {
  const demo = scope === "demo";
  return sql<PlanRow[]>`
    select a.subject, a.parsed, d.verdict, d.rule, d.decision
    from asks a
    join lateral (
      select verdict, rule, decision from decisions where ask_id = a.id order by id desc limit 1
    ) d on true
    where coalesce(a.inbox_message_id like 'demo-%', false) = ${demo}::boolean
    order by a.received_at asc, a.id asc`;
}

// ---------- orchestration ----------

export type EmailPlanResult =
  | { ok: true; sentTo: string; going: number; smaller: number; askOne: number; declined: number; messageId: string }
  | { ok: false; status: 409 | 412; error: string };

export async function emailPlan(scope: PlanScope): Promise<EmailPlanResult> {
  const recipient = (process.env.DEMO_RECIPIENT ?? "").trim();
  if (!recipient) return { ok: false, status: 412, error: "Set DEMO_RECIPIENT to email your plan." };
  if (!isSingleAddress(recipient)) {
    return { ok: false, status: 412, error: "DEMO_RECIPIENT must be a single email address." };
  }
  const inboxId = (process.env.FEWER_INBOX ?? "").trim();
  if (!inboxId) return { ok: false, status: 412, error: "Set FEWER_INBOX to email your plan." };
  const tz = (process.env.FEWER_TZ ?? "").trim() || DEFAULT_PLAN_TZ;

  const plan = buildPlan(await loadPlanRows(scope), tz);
  if (plan.going.length === 0 && plan.smaller.length === 0 && plan.askOne.length === 0) {
    return { ok: false, status: 409, error: "Nothing decided yet to put in a plan." };
  }

  const { subject, text } = formatPlanEmail(plan);
  const to = [recipient];
  assertOnlyRecipient(to);
  const sent = await sendMail({
    inboxId,
    to,
    subject,
    text,
    idempotencyKey: planIdempotencyKey(subject, text),
  });

  const counts = { going: plan.going.length, smaller: plan.smaller.length, askOne: plan.askOne.length };
  await logEvent("plan_emailed", null, { scope, ...counts, messageId: sent.messageId });
  return { ok: true, sentTo: recipient, ...counts, declined: plan.declined, messageId: sent.messageId };
}
