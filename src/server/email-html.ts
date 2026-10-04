/**
 * HTML for Fewer's two owner emails: the plan email and the demo digest. Pure string builders, no
 * server-only imports, so they are unit-tested without a database or a mailbox.
 *
 * Built to the owner's email-client rules (Gmail is the hostile target):
 *  - 600px canvas: outer 100% table, inner table with the width="600" ATTRIBUTE plus
 *    style="width:100%;max-width:600px". All CSS inline. Whole message stays under 80KB.
 *  - Chips are text colour plus a 2px solid outline pill. They never use `background`, because Gmail
 *    strips span backgrounds in draft-then-send and forwards.
 *  - Card-stack rows (one small table per event), never a multi-column data table. No SVG.
 *    Font weights are 400 and 700 only.
 *  - Every string from an ask or an event is HTML-escaped; every link is scheme-checked.
 *  - No em dash or en dash anywhere in the copy.
 */

// ---------- dashes (single definition; plan.ts re-exports it as stripPlanDashes) ----------

const DASH_CLASS = String.raw`[‒-―]`; // figure dash, en dash, em dash, horizontal bar
const AMPM = String.raw`[ \t]?[ap]\.?m\.?`;

/**
 * No em dash or en dash survives: a spaced dash becomes a comma ("a, b"), digit ranges (5 dash 6,
 * 5 PM dash 6 PM) become "5 to 6", anything else ", ".
 */
export function stripDashes(text: string): string {
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

// ---------- escaping and links ----------

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

/** Dash-free, then HTML-escaped. Every piece of ask or event text goes through this. */
const t = (s: string): string => escapeHtml(stripDashes(s));

/** http(s) only. `new URL().href` percent-encodes anything exotic, so no dash character slips into an href. */
function safeHref(url: string): string | null {
  const u = (url ?? "").trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(u)) return null;
  try {
    return new URL(u).href;
  } catch {
    return null;
  }
}

// ---------- palette and shared markup ----------

export const EMAIL_PALETTE = {
  paper: "#f6f4ef",
  ink: "#1b1f23",
  muted: "#566070",
  rule: "#d9d5cb",
  YES: "#15803d",
  WILDCARD: "#6d28d9",
  SMALLER: "#b45309",
  ASK_ONE: "#1d4ed8",
  NO: "#475569",
} as const;

const P = EMAIL_PALETTE;
const FONT = "font-family:Arial,Helvetica,sans-serif";
const TBL = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

export const EMAIL_HTML_MAX_BYTES = 76_000; // the owner's ceiling is 80KB; stay clear of it

/** Text colour plus a 2px solid outline pill. NEVER a background (MUST 2). */
function chip(label: string, color: string): string {
  return `<div style="padding-top:8px"><span style="display:inline-block;color:${color};border:2px solid ${color};border-radius:999px;padding:2px 10px;font-size:12px;line-height:16px;font-weight:700;white-space:nowrap">${label}</span></div>`;
}

const byteLength = (s: string): number => Buffer.byteLength(s, "utf8");

/** The shared frame: paper page, centred 600px column, header, body rows, footer lines. */
function frame(o: { title: string; heading: string; sub: string; preheader: string; rows: string; footer: string[] }): string {
  const foot = o.footer
    .map((line) => `<div style="padding-top:4px;font-size:12px;line-height:18px;color:${P.muted}">${t(line)}</div>`)
    .join("");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">` +
    `<title>${t(o.title)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${P.paper};${FONT};color:${P.ink}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${P.paper}">${t(o.preheader)}</div>` +
    `<table ${TBL} width="100%" bgcolor="${P.paper}" style="width:100%;background-color:${P.paper}"><tr><td align="center" style="padding:24px 16px">` +
    `<table ${TBL} width="600" style="width:100%;max-width:600px">` +
    `<tr><td style="${FONT};font-size:24px;line-height:30px;font-weight:700;color:${P.ink}">${t(o.heading)}</td></tr>` +
    `<tr><td style="${FONT};padding-top:2px;font-size:16px;line-height:22px;color:${P.ink}">${t(o.sub)}</td></tr>` +
    o.rows +
    `<tr><td style="${FONT};padding-top:28px;border-top:1px solid ${P.rule}">${foot}</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

const sectionLabel = (label: string): string =>
  `<tr><td style="${FONT};padding-top:28px"><h2 style="margin:0;font-size:13px;line-height:18px;font-weight:700;letter-spacing:1px;color:${P.muted}">${label}</h2></td></tr>`;

// ---------- plan email ----------

/** Structural copy of plan.ts's Plan (no import: plan.ts imports this file). */
export interface PlanHtmlInput {
  going: Array<{ when: string; title: string; location: string; url: string; reason: string; verdict?: "YES" | "WILDCARD" }>;
  smaller: Array<{ title: string; when: string; offer: string }>;
  askOne: Array<{ title: string; question: string }>;
  declined: number;
}

export interface PlanHtmlOptions {
  /** IANA zone for the "current week" fallback. */
  tz?: string;
  /** Clock for the "current week" fallback (tests). */
  now?: Date;
}

const WEEKDAYS: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};
const WHEN_RE = /^([A-Z][a-z]{2}), ([A-Z][a-z]{2}) (\d{1,2}), (\d{1,2}:\d{2} [AP]M)$/;
const NO_DATE = "Date not set";

/** "Tue, Oct 6, 5:30 PM" (what plan.ts formatWhen writes) -> day label, "Oct 6" and the clock time. */
function splitWhen(when: string): { label: string; short: string; time: string } {
  const m = WHEN_RE.exec((when ?? "").trim());
  if (!m) return { label: NO_DATE, short: "", time: (when ?? "").trim() };
  const [, wd, mon, day, time] = m as unknown as [string, string, string, string, string];
  return { label: `${WEEKDAYS[wd] ?? wd}, ${mon} ${day}`, short: `${mon} ${day}`, time };
}

function groupByDay<T extends { when: string }>(items: T[]): Array<{ label: string; items: Array<T & { time: string }> }> {
  const groups = new Map<string, Array<T & { time: string }>>();
  for (const it of items) {
    const w = splitWhen(it.when);
    const list = groups.get(w.label) ?? [];
    list.push({ ...it, time: w.time });
    groups.set(w.label, list);
  }
  const undated = groups.get(NO_DATE);
  groups.delete(NO_DATE);
  const out = [...groups].map(([label, list]) => ({ label, items: list }));
  if (undated) out.push({ label: NO_DATE, items: undated });
  return out;
}

/** Mon..Sun week that contains `now` in `tz`, as "Oct 5" and "Oct 11". */
function currentWeek(tz: string, now: Date): { start: string; end: string } {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "America/Los_Angeles";
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  const noon = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")), 12);
  const fmt = (ms: number): string =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(ms));
  const monday = noon - Math.max(dow, 0) * 86_400_000;
  return { start: fmt(monday), end: fmt(monday + 6 * 86_400_000) };
}

/** "Your plan for Oct 6 to Oct 9", from the going items, or the current week when none has a date. */
export function planRangeLine(plan: Pick<PlanHtmlInput, "going">, opts: PlanHtmlOptions = {}): string {
  const days = plan.going.map((g) => splitWhen(g.when).short).filter(Boolean);
  const first = days[0];
  const last = days[days.length - 1];
  if (first && last) return first === last ? `Your plan for ${first}` : `Your plan for ${first} to ${last}`;
  const w = currentWeek(opts.tz ?? "America/Los_Angeles", opts.now ?? new Date());
  return `Your plan for ${w.start} to ${w.end}`;
}

/** "8 going · 13 shorter · 1 needs an answer · 43 declined". Zero parts drop out, except going. */
export function planSummaryLine(plan: PlanHtmlInput): string {
  const parts = [`${plan.going.length} going`];
  if (plan.smaller.length) parts.push(`${plan.smaller.length} shorter`);
  if (plan.askOne.length) parts.push(`${plan.askOne.length} ${plan.askOne.length === 1 ? "needs" : "need"} an answer`);
  if (plan.declined > 0) parts.push(`${plan.declined} declined`);
  return parts.join(" · ");
}

type Detail = "full" | "compact" | "minimal";

interface Card {
  time: string;
  title: string;
  url?: string;
  lines: string[]; // plain text lines, already dash-free later
  muted?: string;
  chip?: { label: string; color: string };
}

function card(c: Card, detail: Detail): string {
  const href = c.url ? safeHref(c.url) : null;
  const title = href
    ? `<a href="${escapeHtml(href)}" style="display:inline-block;color:${P.ink};text-decoration:underline">${t(c.title)}</a>`
    : t(c.title);
  const time = c.time ? `<div style="font-size:14px;line-height:20px;font-weight:700">${t(c.time)}</div>` : "";
  const lines = c.lines.filter(Boolean).map((l) => `<div style="padding-top:2px;font-size:14px;line-height:20px">${t(l)}</div>`).join("");
  const muted = detail === "full" && c.muted ? `<div style="padding-top:2px;font-size:13px;line-height:18px;color:${P.muted}">${t(c.muted)}</div>` : "";
  const badge = detail === "full" && c.chip ? chip(c.chip.label, c.chip.color) : "";
  return (
    `<table ${TBL} width="100%" style="width:100%;border-top:1px solid ${P.rule}"><tr><td style="${FONT};padding:12px 0 14px;color:${P.ink}">` +
    time +
    `<div style="font-size:17px;line-height:24px;font-weight:700">${title}</div>` +
    (detail === "minimal" ? "" : lines) +
    muted +
    badge +
    `</td></tr></table>`
  );
}

function dayGroups<T extends { when: string }>(
  label: string,
  items: T[],
  toCard: (item: T & { time: string }) => Card,
  detail: Detail,
): string {
  let html = sectionLabel(label);
  for (const g of groupByDay(items)) {
    html +=
      `<tr><td style="${FONT};padding-top:14px"><div style="padding-bottom:4px;font-size:15px;line-height:20px;font-weight:700;color:${P.ink}">${t(g.label)}</div>` +
      g.items.map((it) => card(toCard(it), detail)).join("") +
      `</td></tr>`;
  }
  return html;
}

function renderPlan(plan: PlanHtmlInput, opts: PlanHtmlOptions, detail: Detail, cap: number): string {
  const going = plan.going.slice(0, cap);
  const smaller = plan.smaller.slice(0, cap);
  const hidden = plan.going.length - going.length + (plan.smaller.length - smaller.length);

  let rows =
    `<tr><td style="${FONT};padding-top:16px;font-size:15px;line-height:22px;color:${P.ink}">${t(planSummaryLine(plan))}</td></tr>`;

  if (going.length) {
    rows += dayGroups(
      "GOING",
      going,
      (g) => ({
        time: g.time,
        title: g.title,
        url: g.url,
        lines: [g.reason],
        muted: g.location,
        chip: g.verdict === "WILDCARD" ? { label: "WILDCARD", color: P.WILDCARD } : { label: "YES", color: P.YES },
      }),
      detail,
    );
  }

  if (smaller.length) {
    rows += dayGroups(
      "SHORTER",
      smaller,
      (s) => ({
        time: s.time,
        title: s.title,
        lines: [s.offer],
        chip: { label: "SMALLER", color: P.SMALLER },
      }),
      detail,
    );
  }

  if (plan.askOne.length) {
    rows += sectionLabel("NEEDS AN ANSWER");
    rows +=
      `<tr><td style="${FONT};padding-top:10px">` +
      plan.askOne
        .map((a) => card({ time: "", title: a.title, lines: [a.question], chip: { label: "ASK ONE", color: P.ASK_ONE } }, detail))
        .join("") +
      `</td></tr>`;
  }

  if (hidden > 0) {
    rows += `<tr><td style="${FONT};padding-top:20px;font-size:14px;line-height:20px;color:${P.muted}">${t(`${hidden} more events are on the Desk.`)}</td></tr>`;
  }

  return frame({
    title: "Your plan from Fewer",
    heading: "Fewer",
    sub: planRangeLine(plan, opts),
    preheader: planSummaryLine(plan),
    rows,
    footer: ["Fewer · open the Desk to change your goals", "Nothing was sent to anyone else."],
  });
}

/**
 * The plan email as HTML. Always under EMAIL_HTML_MAX_BYTES: a huge plan first drops per-event detail
 * (location and chip, then the reason line), and only then cuts the tail with a "more on the Desk" line.
 */
export function renderPlanHtml(plan: PlanHtmlInput, opts: PlanHtmlOptions = {}): string {
  for (const detail of ["full", "compact", "minimal"] as const) {
    const html = renderPlan(plan, opts, detail, Number.POSITIVE_INFINITY);
    if (byteLength(html) <= EMAIL_HTML_MAX_BYTES) return html;
  }
  let cap = Math.max(plan.going.length, plan.smaller.length);
  for (;;) {
    cap = Math.floor(cap / 2);
    const html = renderPlan(plan, opts, "minimal", cap);
    if (cap <= 1 || byteLength(html) <= EMAIL_HTML_MAX_BYTES) return html;
  }
}

// ---------- demo digest ----------

export interface DigestReply {
  to: string;
  subject: string;
  body: string;
}

/** Blank line = new paragraph, single newline = <br>. Escaped line by line. */
function paragraphs(body: string): string {
  return (body ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0">${p.split("\n").map(t).join("<br>")}</p>`)
    .join("");
}

function replyCard(r: DigestReply): string {
  return (
    `<table ${TBL} width="100%" style="width:100%;border-top:1px solid ${P.rule}"><tr><td style="${FONT};padding:14px 0 6px;color:${P.ink}">` +
    `<div style="font-size:13px;line-height:18px;color:${P.muted}">${t(`To: ${r.to}`)}</div>` +
    `<div style="padding-top:4px;font-size:17px;line-height:24px;font-weight:700">${t(r.subject)}</div>` +
    `<div style="padding-top:8px;font-size:15px;line-height:22px">${paragraphs(r.body)}</div>` +
    `</td></tr></table>`
  );
}

/** The demo digest as HTML: one card per reply Fewer would have sent. */
export function renderDigestHtml(replies: DigestReply[]): string {
  const n = replies.length;
  const line = `${n} ${n === 1 ? "reply" : "replies"} Fewer would send`;
  const build = (list: DigestReply[], more: number): string =>
    frame({
      title: "Fewer demo",
      heading: "Fewer demo",
      sub: line,
      preheader: line,
      rows:
        `<tr><td style="${FONT};padding-top:20px">${list.map(replyCard).join("")}</td></tr>` +
        (more > 0 ? `<tr><td style="${FONT};padding-top:12px;font-size:14px;line-height:20px;color:${P.muted}">${t(`${more} more replies are on the Desk.`)}</td></tr>` : ""),
      footer: ["Demo: nobody else was emailed."],
    });
  let list = replies;
  let html = build(list, 0);
  while (byteLength(html) > EMAIL_HTML_MAX_BYTES && list.length > 1) {
    list = list.slice(0, Math.floor(list.length / 2));
    html = build(list, n - list.length);
  }
  return html;
}
