import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plan.ts reads with `sql` and sends with `sendMail`. Replace both: no database, no network, and
// NEVER a real email. vitest has no "@/" alias, so everything here is relative.
const h = vi.hoisted(() => ({
  sql: vi.fn(),
  logEvent: vi.fn(async () => undefined),
  sendMail: vi.fn(),
}));
vi.mock("../db", () => ({ sql: h.sql, logEvent: h.logEvent }));
vi.mock("../mail", () => ({ sendMail: h.sendMail }));

import {
  EMAIL_HTML_MAX_BYTES,
  EMAIL_PALETTE,
  escapeHtml,
  planRangeLine,
  planSummaryLine,
  renderDigestHtml,
  renderPlanHtml,
  stripDashes,
  type DigestReply,
  type PlanHtmlInput,
} from "../email-html";
import { buildPlan, emailPlan, formatPlanEmail, planIdempotencyKey, type Plan, type PlanRow } from "../plan";

const EM = "—";
const EN = "–";
const DASHES = /[‒-―]/;
const TZ = "America/Los_Angeles";
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
const P = EMAIL_PALETTE;

const going = (over: Partial<PlanHtmlInput["going"][number]> = {}): PlanHtmlInput["going"][number] => ({
  when: "Tue, Oct 6, 5:30 PM",
  title: "Founders panel",
  location: "Moscone West",
  url: "https://lu.ma/panel",
  reason: "Fits your top journey.",
  ...over,
});

const PLAN: PlanHtmlInput = {
  going: [
    going(),
    going({ when: "Tue, Oct 6, 7:00 PM", title: "Rooftop dinner", url: "", location: "", reason: "Your one wildcard.", verdict: "WILDCARD" }),
    going({ when: "Thu, Oct 8, 9:00 AM", title: "Demo breakfast", url: "https://lu.ma/breakfast", reason: "Two investors you want." }),
  ],
  smaller: [
    { when: "Wed, Oct 7, 4:00 PM", title: "Coffee chat", offer: "Do 20 minutes by video instead." },
    { when: "Wed, Oct 7, 6:00 PM", title: "Mixer", offer: "Stay for the talk only." },
  ],
  askOne: [{ title: "Dinner with a VC", question: "Is this about fundraising?" }],
  declined: 4,
};

/** Every <span ...> opening tag in the document. */
const spanTags = (html: string): string[] => html.match(/<span\b[^>]*>/g) ?? [];

describe("shared frame (both emails)", () => {
  const docs: Array<[string, string]> = [
    ["plan", renderPlanHtml(PLAN, { tz: TZ })],
    ["digest", renderDigestHtml([{ to: "Sam <sam@example.org>", subject: "Re: panel", body: "Hi Sam.\n\nSee you there." }])],
  ];

  for (const [name, html] of docs) {
    it(`${name}: 600px canvas, outer 100% table, inner table with the width attribute AND max-width`, () => {
      expect(html).toMatch(/<table[^>]*\swidth="100%"[^>]*style="width:100%;background-color:#f6f4ef"/);
      expect(html).toMatch(/<table[^>]*\swidth="600"[^>]*style="width:100%;max-width:600px"/);
      expect(html).toContain('width="600"');
      expect(html).toContain("max-width:600px");
    });

    it(`${name}: no SVG, no scripts, no <style> block, no dashes, small`, () => {
      expect(html).not.toContain("<svg");
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<style/i);
      expect(html).not.toMatch(DASHES);
      expect(bytes(html)).toBeLessThan(80_000);
    });

    it(`${name}: font weights are only 400 and 700`, () => {
      const weights = [...html.matchAll(/font-weight:\s*([a-z0-9]+)/gi)].map((m) => m[1]!.toLowerCase());
      expect(weights.length).toBeGreaterThan(0);
      for (const w of weights) expect(["400", "700", "bold", "normal"]).toContain(w);
    });

    it(`${name}: uses the owner palette on paper`, () => {
      expect(html).toContain(P.paper);
      expect(html).toContain(P.ink);
      expect(html).toContain(P.muted);
    });
  }
});

describe("chips (MUST 2): text colour plus a 2px solid outline, never a background", () => {
  const html = renderPlanHtml(PLAN, { tz: TZ });

  it("no span carries background or background-color", () => {
    const spans = spanTags(html);
    expect(spans.length).toBeGreaterThanOrEqual(4);
    for (const tag of spans) expect(tag).not.toMatch(/background/i);
  });

  it("companion check: every verdict chip DOES carry the outline recipe in its accent", () => {
    const chipFor = (label: string, color: string) =>
      new RegExp(
        `<span style="[^"]*color:${color};border:2px solid ${color};border-radius:999px;[^"]*font-size:12px;[^"]*font-weight:700[^"]*">${label}</span>`,
      );
    expect(html).toMatch(chipFor("YES", P.YES));
    expect(html).toMatch(chipFor("WILDCARD", P.WILDCARD));
    expect(html).toMatch(chipFor("SMALLER", P.SMALLER));
    expect(html).toMatch(chipFor("ASK ONE", P.ASK_ONE));
  });

  it("the wildcard gets WILDCARD and plain going items get YES, never both on one card", () => {
    const wildcardCard = html.split("<table").find((c) => c.includes("Rooftop dinner"))!;
    expect(wildcardCard).toContain(">WILDCARD</span>");
    expect(wildcardCard).not.toContain(">YES</span>");
    const yesCard = html.split("<table").find((c) => c.includes("Founders panel"))!;
    expect(yesCard).toContain(">YES</span>");
    expect(yesCard).not.toContain("WILDCARD");
  });

  it("chip text is uppercase, 12px, bold", () => {
    for (const label of ["YES", "WILDCARD", "SMALLER", "ASK ONE"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(spanTags(html).every((s) => /font-size:12px/.test(s) && /font-weight:700/.test(s))).toBe(true);
  });
});

describe("renderPlanHtml layout and copy", () => {
  const html = renderPlanHtml(PLAN, { tz: TZ });
  const at = (s: string): number => html.indexOf(s);

  it("header, range line, and the one summary line with real counts", () => {
    expect(html).toContain(">Fewer</td>");
    expect(html).toContain("Your plan for Oct 6 to Oct 8");
    expect(html).toContain("3 going · 2 shorter · 1 needs an answer · 4 declined");
  });

  it("sections come in order: GOING, SHORTER, NEEDS AN ANSWER, then the footer", () => {
    expect(at(">GOING</h2>")).toBeGreaterThan(0);
    expect(at(">GOING</h2>")).toBeLessThan(at(">SHORTER</h2>"));
    expect(at(">SHORTER</h2>")).toBeLessThan(at(">NEEDS AN ANSWER</h2>"));
    expect(at(">NEEDS AN ANSWER</h2>")).toBeLessThan(at("open the Desk to change your goals"));
  });

  it("groups by day with the full weekday, one heading per day, days in order", () => {
    expect(html.split("Tuesday, Oct 6").length - 1).toBe(1); // two Tuesday events, one heading
    expect(at("Tuesday, Oct 6")).toBeLessThan(at("Thursday, Oct 8"));
    expect(at("Wednesday, Oct 7")).toBeGreaterThan(at(">SHORTER</h2>"));
  });

  it("each going card: bold time, title linked to the event URL, reason line, muted location", () => {
    expect(html).toContain('<div style="font-size:14px;line-height:20px;font-weight:700">5:30 PM</div>');
    expect(html).toMatch(/<a href="https:\/\/lu\.ma\/panel" style="[^"]*">Founders panel<\/a>/);
    expect(html).toContain("Fits your top journey.");
    expect(html).toContain(`color:${P.muted}">Moscone West</div>`);
  });

  it("a title with no URL is plain text, not a link", () => {
    expect(html).toContain(">Rooftop dinner</div>");
    expect(html).not.toMatch(/<a [^>]*>Rooftop dinner<\/a>/);
  });

  it("shorter cards carry the offer line; the needs-an-answer card carries the question", () => {
    expect(html).toContain("Do 20 minutes by video instead.");
    expect(html).toContain("Stay for the talk only.");
    expect(html).toContain("Is this about fundraising?");
  });

  it("footer lines", () => {
    expect(html).toContain("Fewer · open the Desk to change your goals");
    expect(html).toContain("Nothing was sent to anyone else.");
  });

  it("an undated event goes in a final 'Date not set' group", () => {
    const withUndated = renderPlanHtml({ ...PLAN, going: [going({ when: "", title: "Whenever" }), ...PLAN.going] }, { tz: TZ });
    expect(withUndated.indexOf("Date not set")).toBeGreaterThan(withUndated.indexOf("Thursday, Oct 8"));
    expect(withUndated).toContain("Your plan for Oct 6 to Oct 8"); // undated items do not shape the range
  });
});

describe("summary and range lines", () => {
  const n = <T>(count: number, make: (i: number) => T): T[] => Array.from({ length: count }, (_, i) => make(i));

  it("matches the spec example and omits zero parts except going", () => {
    const plan: PlanHtmlInput = {
      going: n(8, (i) => going({ title: `G${i}` })),
      smaller: n(13, (i) => ({ title: `S${i}`, when: "", offer: "" })),
      askOne: [{ title: "Q", question: "" }],
      declined: 43,
    };
    expect(planSummaryLine(plan)).toBe("8 going · 13 shorter · 1 needs an answer · 43 declined");
    expect(planSummaryLine({ going: plan.going, smaller: [], askOne: [], declined: 0 })).toBe("8 going");
    expect(planSummaryLine({ going: [], smaller: [], askOne: plan.askOne, declined: 2 })).toBe("0 going · 1 needs an answer · 2 declined");
    expect(planSummaryLine({ going: [], smaller: [], askOne: [...plan.askOne, ...plan.askOne], declined: 0 })).toBe("0 going · 2 need an answer");
  });

  it("range comes from the going items; one day is just that day", () => {
    expect(planRangeLine(PLAN)).toBe("Your plan for Oct 6 to Oct 8");
    expect(planRangeLine({ going: [going()] })).toBe("Your plan for Oct 6");
  });

  it("with nothing dated going, it is the current Monday to Sunday week in the zone", () => {
    // Sun Oct 4 2026, 12:00 Pacific
    const now = new Date("2026-10-04T19:00:00Z");
    expect(planRangeLine({ going: [] }, { tz: TZ, now })).toBe("Your plan for Sep 28 to Oct 4");
    // Mon Oct 5 2026, 00:30 Pacific is still Sun Oct 4 in New York at 03:30? no: it is Mon there
    expect(planRangeLine({ going: [] }, { tz: "America/New_York", now: new Date("2026-10-05T04:30:00Z") })).toBe("Your plan for Oct 5 to Oct 11");
    expect(planRangeLine({ going: [] }, { tz: "Not/AZone", now })).toBe("Your plan for Sep 28 to Oct 4");
  });
});

describe("escaping and safety", () => {
  const hostile = `<script>alert(1)</script> & "quoted" 'single'`;
  const plan: PlanHtmlInput = {
    going: [going({ title: hostile, reason: hostile, location: hostile, url: "javascript:alert(1)" })],
    smaller: [{ when: "Wed, Oct 7, 4:00 PM", title: hostile, offer: hostile }],
    askOne: [{ title: hostile, question: hostile }],
    declined: 0,
  };
  const html = renderPlanHtml(plan, { tz: TZ });

  it("a <script> in any event text comes out entity-escaped, never as a tag", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#39;single&#39;");
    // title, reason, location (going) + title, offer (shorter) + title, question (ask one)
    expect(html.split("&lt;script&gt;").length - 1).toBeGreaterThanOrEqual(7);
  });

  it("only http(s) links are linked; javascript: and friends fall back to plain text", () => {
    expect(html).not.toMatch(/href="javascript/i);
    expect(html).not.toContain("<a ");
    for (const bad of ["data:text/html,hi", "mailto:a@b.co", "//evil.example", 'https://x.test/"onmouseover="x', "not a url"]) {
      expect(renderPlanHtml({ ...PLAN, going: [going({ url: bad })] }, { tz: TZ })).not.toContain("<a ");
    }
  });

  it("a link carries a safe, attribute-escaped, dash-free href", () => {
    const out = renderPlanHtml({ ...PLAN, going: [going({ url: `https://example.org/a${EM}b?x=1&y=2` })] }, { tz: TZ });
    expect(out).toMatch(/href="https:\/\/example\.org\/a%E2%80%94b\?x=1&amp;y=2"/);
    expect(out).not.toMatch(DASHES);
  });

  it("escapeHtml covers the five characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("no em or en dash anywhere", () => {
  const plan: PlanHtmlInput = {
    going: [
      going({
        title: `Founders ${EM} Investors ${EN} Night 5${EN}7 PM`,
        reason: `Fits${EM}really`,
        location: `Sam ${EM} host`,
      }),
    ],
    smaller: [{ when: "Wed, Oct 7, 4:00 PM", title: `Smaller ${EM} one`, offer: `Go 6 PM ${EN} 7 PM only ${EM}` }],
    askOne: [{ title: `Ask ${EN} one`, question: `Paid ${EM} or free?` }],
    declined: 1,
  };

  it("plan html is clean and keeps the sanitised wording", () => {
    const html = renderPlanHtml(plan, { tz: TZ });
    expect(html).not.toMatch(DASHES);
    expect(html).toContain("Founders, Investors, Night 5 to 7 PM");
    expect(html).toContain("Go 6 PM to 7 PM only");
  });

  it("digest html is clean", () => {
    const html = renderDigestHtml([{ to: `Sam ${EM} Host <s@x.org>`, subject: `Re: A ${EM} B`, body: `Hello ${EN} there.\n\nFine ${EM} thanks` }]);
    expect(html).not.toMatch(DASHES);
    expect(html).toContain("Re: A, B");
  });

  it("stripDashes leaves ASCII hyphens alone", () => {
    expect(stripDashes("Re-entry, 5-7 PM")).toBe("Re-entry, 5-7 PM");
  });
});

describe("size budget (Gmail clips near 102KB; the owner's ceiling is 80KB)", () => {
  const many = (count: number): PlanHtmlInput => ({
    going: Array.from({ length: count }, (_, i) =>
      going({
        when: `Tue, Oct ${6 + (i % 5)}, ${1 + (i % 11)}:30 PM`,
        title: `Event number ${i} with a fairly realistic long title for Tech Week`,
        url: `https://lu.ma/event-${i}?utm_source=fewer&utm_medium=email`,
        location: "Moscone West, 747 Howard St, San Francisco",
        reason: "Matches your top journey and falls on a day with room to spare.",
      }),
    ),
    smaller: Array.from({ length: Math.floor(count / 3) }, (_, i) => ({
      when: `Wed, Oct 7, ${1 + (i % 11)}:00 PM`,
      title: `Shorter event ${i}`,
      offer: "Do 20 minutes by video instead of the whole evening.",
    })),
    askOne: [{ title: "Dinner with a VC", question: "Is this about fundraising?" }],
    declined: 43,
  });

  it("60 events (45 going + 15 shorter) stay under 80KB and keep full detail", () => {
    const html = renderPlanHtml(many(45), { tz: TZ });
    expect(bytes(html)).toBeLessThan(80_000);
    expect(html).toContain("Event number 44");
    expect(html).toContain("Shorter event 14");
    expect(html).toContain(">YES</span>");
    expect(html).toContain("Moscone West, 747 Howard St, San Francisco");
    expect(html).not.toContain("more events are on the Desk");
  });

  it("80 events (60 going + 20 shorter) still fit under 80KB by dropping chips and locations, never events", () => {
    const html = renderPlanHtml(many(60), { tz: TZ });
    expect(bytes(html)).toBeLessThan(80_000);
    expect(html).toContain("Event number 59");
    expect(html).toContain("Shorter event 19");
    expect(html).not.toContain("more events are on the Desk");
    expect(html).toContain("Matches your top journey"); // the reason line survives compact mode
  });

  it("an absurd plan still stays under the ceiling, and says what it cut", () => {
    const html = renderPlanHtml(many(900), { tz: TZ });
    expect(bytes(html)).toBeLessThanOrEqual(EMAIL_HTML_MAX_BYTES);
    expect(html).toMatch(/\d+ more events are on the Desk\./);
    expect(html).toContain("900 going"); // the summary line stays honest
  });

  it("an empty plan renders a valid, tiny document", () => {
    const html = renderPlanHtml({ going: [], smaller: [], askOne: [], declined: 0 }, { tz: TZ, now: new Date("2026-10-04T19:00:00Z") });
    expect(html).toContain("0 going");
    expect(html).toContain("Your plan for Sep 28 to Oct 4");
    expect(html).not.toContain(">GOING</h2>");
    expect(bytes(html)).toBeLessThan(5_000);
  });
});

describe("renderDigestHtml", () => {
  const replies: DigestReply[] = [
    { to: "Sam Rivera <sam@example.org>", subject: "Re: Founders panel", body: "Hi Sam,\nThanks for the invite.\n\nI will join for the talk.\n\nRahul" },
    { to: "ops@example.org", subject: "Re: your note", body: "Short reply." },
  ];
  const html = renderDigestHtml(replies);

  it("header, count line, footer", () => {
    expect(html).toContain(">Fewer demo</td>");
    expect(html).toContain("2 replies Fewer would send");
    expect(html).toContain("Demo: nobody else was emailed.");
    expect(renderDigestHtml([replies[1]!])).toContain("1 reply Fewer would send");
  });

  it("one card per reply: muted To line (escaped), bold subject, body as paragraphs with <br>", () => {
    expect(html).toContain(`color:${P.muted}">To: Sam Rivera &lt;sam@example.org&gt;</div>`);
    expect(html).toContain('font-weight:700">Re: Founders panel</div>');
    expect(html).toContain("<p ");
    expect(html).toContain("Hi Sam,<br>Thanks for the invite.</p>");
    expect(html).toContain(">I will join for the talk.</p>");
    expect(html.split("To: ").length - 1).toBe(2);
    expect(html).toContain("Short reply.");
  });

  it("escapes hostile reply text and never emits the raw address brackets", () => {
    const out = renderDigestHtml([{ to: "<b>x</b> <x@y.org>", subject: "<script>1</script>", body: "<img src=x onerror=alert(1)>\n\n<script>2</script>" }]);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(out).toContain("To: &lt;b&gt;x&lt;/b&gt; &lt;x@y.org&gt;");
  });

  it("no chips, no background anywhere on a span, and a 600px canvas", () => {
    expect(spanTags(html)).toEqual([]);
    expect(html).toMatch(/<table[^>]*\swidth="600"[^>]*style="width:100%;max-width:600px"/);
  });

  it("many long replies still stay under the ceiling", () => {
    const big = Array.from({ length: 80 }, (_, i) => ({ to: `P${i} <p${i}@example.org>`, subject: `Re: thing ${i}`, body: "A long paragraph of reply text. ".repeat(40) }));
    const out = renderDigestHtml(big);
    expect(bytes(out)).toBeLessThanOrEqual(EMAIL_HTML_MAX_BYTES);
    expect(out).toMatch(/\d+ more replies are on the Desk\./);
    expect(out).toContain("80 replies Fewer would send");
  });
});

// ---------- plan.ts wiring ----------

const row = (over: Partial<PlanRow> & { title?: string; startsAt?: string } = {}): PlanRow => {
  const { title, startsAt, ...rest } = over;
  return {
    subject: "Subject line",
    parsed: { title: title ?? "Founders panel", ...(startsAt ? { startsAt } : {}) },
    verdict: "YES",
    decision: { verdict: "YES", reasons: ["Fits your top journey.", "Second reason."] },
    ...rest,
  };
};

const ROWS: PlanRow[] = [
  row({ title: "Late party", startsAt: "2026-10-09T03:00:00Z", verdict: "WILDCARD", decision: { verdict: "WILDCARD", reasons: ["Your one wildcard."] } }),
  row({
    title: "Founders panel",
    startsAt: "2026-10-07T00:30:00Z",
    parsed: { title: "Founders panel", startsAt: "2026-10-07T00:30:00Z", url: "https://lu.ma/panel", organizer: "Sam Rivera" },
  }),
  row({ title: "Coffee chat", startsAt: "2026-10-06T16:00:00Z", verdict: "SMALLER", decision: { verdict: "SMALLER", reasons: ["Costs 2h."], smallerOffer: "Do 20 minutes by video instead." } }),
  row({ title: "Dinner with a VC", verdict: "ASK_ONE", decision: { verdict: "ASK_ONE", reasons: [], question: "Is this about fundraising?" } }),
  row({ title: "Spam seminar", verdict: "NO", decision: { verdict: "NO", reasons: ["Off topic."] } }),
  row({ title: "Shady invite", verdict: "BLOCKED", decision: { verdict: "BLOCKED", reasons: ["Blocked sender."] } }),
];

describe("formatPlanEmail returns subject, text AND html", () => {
  const plan: Plan = buildPlan(ROWS, TZ);
  const email = formatPlanEmail(plan, { tz: TZ });

  it("keeps the existing subject and the plain text", () => {
    expect(email.subject).toBe("Your Tech Week plan from Fewer: 2 events");
    expect(email.text.startsWith("Going")).toBe(true);
    expect(email.text).toContain("- Tue, Oct 6, 5:30 PM: Founders panel (Sam Rivera)");
    expect(email.text).toContain("Fewer said no to 2 other asks.");
  });

  it("the html says the same thing as the text, from real plan data", () => {
    expect(email.html).toContain("2 going · 1 shorter · 1 needs an answer · 2 declined");
    expect(email.html).toContain("Your plan for Oct 6 to Oct 8");
    expect(email.html).toMatch(/<a href="https:\/\/lu\.ma\/panel"[^>]*>Founders panel<\/a>/);
    expect(email.html).toContain(">WILDCARD</span>"); // Late party is the wildcard
    expect(email.html).toContain("Do 20 minutes by video instead.");
    expect(email.html).toContain("Sam Rivera");
    expect(email.html).not.toMatch(DASHES);
  });

  it("buildPlan flags only the wildcard, so plain going items keep their old shape", () => {
    expect(plan.going.map((g) => g.verdict)).toEqual([undefined, "WILDCARD"]);
    expect("verdict" in plan.going[0]!).toBe(false);
  });
});

describe("planIdempotencyKey includes the html", () => {
  const plan = buildPlan(ROWS, TZ);
  const a = formatPlanEmail(plan, { tz: TZ });

  it("same content, same key; different html, different key", () => {
    const k = planIdempotencyKey(a.subject, a.text, a.html);
    expect(k).toMatch(/^plan\.[0-9a-f]{40}$/);
    expect(planIdempotencyKey(a.subject, a.text, formatPlanEmail(buildPlan([...ROWS], TZ), { tz: TZ }).html)).toBe(k);
    expect(planIdempotencyKey(a.subject, a.text, a.html + "<!-- restyled -->")).not.toBe(k);
    expect(k).not.toBe(planIdempotencyKey(a.subject, a.text)); // html is in the hash
  });

  it("without html it is still the old text-only key", () => {
    const legacy = "plan." + createHash("sha256").update(`${a.subject}\n${a.text}`).digest("hex").slice(0, 40);
    expect(planIdempotencyKey(a.subject, a.text)).toBe(legacy);
  });
});

describe("emailPlan sends multipart (mocked mail: nothing real is ever sent)", () => {
  beforeEach(() => {
    h.sql.mockReset();
    h.logEvent.mockClear();
    h.sendMail.mockReset();
    h.sendMail.mockResolvedValue({ messageId: "msg-1", threadId: "th-1" });
    vi.stubEnv("DEMO_RECIPIENT", "owner@example.org");
    vi.stubEnv("FEWER_INBOX", "fewer@agentmail.test");
    vi.stubEnv("FEWER_TZ", TZ);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("passes text AND html to sendMail, to the owner only, with a key derived from both", async () => {
    h.sql.mockResolvedValue(ROWS);
    const r = await emailPlan("demo");
    expect(r).toMatchObject({ ok: true, sentTo: "owner@example.org", going: 2, smaller: 1, askOne: 1, declined: 2 });
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    const arg = h.sendMail.mock.calls[0]![0] as { to: string[]; subject: string; text: string; html: string; idempotencyKey: string };
    expect(arg.to).toEqual(["owner@example.org"]);
    expect(arg.text).toContain("Needs one answer");
    expect(arg.html).toContain("NEEDS AN ANSWER");
    expect(arg.html).toContain('width="600"');
    expect(arg.idempotencyKey).toBe(planIdempotencyKey(arg.subject, arg.text, arg.html));
  });
});
