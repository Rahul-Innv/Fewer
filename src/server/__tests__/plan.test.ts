import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plan.ts reads with `sql` and sends with `sendMail`. Replace both so no database, network or real
// email is ever touched. vitest has no "@/" alias, so everything here is relative.
const h = vi.hoisted(() => ({
  sql: vi.fn(),
  logEvent: vi.fn(async () => undefined),
  sendMail: vi.fn(),
}));
vi.mock("../db", () => ({ sql: h.sql, logEvent: h.logEvent }));
vi.mock("../mail", () => ({ sendMail: h.sendMail }));

import {
  assertOnlyRecipient,
  buildPlan,
  emailPlan,
  formatPlanEmail,
  formatWhen,
  loadPlanRows,
  planIdempotencyKey,
  stripPlanDashes,
  type PlanRow,
} from "../plan";

const EM = "\u2014";
const EN = "\u2013";
const DASHES = /[\u2012-\u2015]/;
const TZ = "America/Los_Angeles";

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
    parsed: {
      title: "Founders panel",
      startsAt: "2026-10-07T00:30:00Z",
      url: "https://lu.ma/panel",
      organizer: "Sam Rivera",
    },
  }),
  row({
    title: "Coffee chat",
    startsAt: "2026-10-06T16:00:00Z",
    verdict: "SMALLER",
    decision: { verdict: "SMALLER", reasons: ["Costs 2h."], smallerOffer: "Do 20 minutes by video instead." },
  }),
  row({
    title: "Dinner with a VC",
    verdict: "ASK_ONE",
    decision: { verdict: "ASK_ONE", reasons: [], question: "Is this about fundraising?" },
  }),
  row({ title: "Spam seminar", verdict: "NO", decision: { verdict: "NO", reasons: ["Off topic."] } }),
  row({ title: "Shady invite", verdict: "BLOCKED", decision: { verdict: "BLOCKED", reasons: ["Blocked sender."] } }),
  row({ title: "Undecided", verdict: null, decision: null }),
];

describe("buildPlan", () => {
  it("groups verdicts and counts NO + BLOCKED as declined; undecided asks are skipped", () => {
    const plan = buildPlan(ROWS, TZ);
    expect(plan.going.map((g) => g.title)).toEqual(["Founders panel", "Late party"]);
    expect(plan.smaller).toEqual([{ title: "Coffee chat", when: "Tue, Oct 6, 9:00 AM", offer: "Do 20 minutes by video instead." }]);
    expect(plan.askOne).toEqual([{ title: "Dinner with a VC", question: "Is this about fundraising?" }]);
    expect(plan.declined).toBe(2);
  });

  it("sorts going (YES and WILDCARD together) by startsAt, undated last", () => {
    const rows = [
      row({ title: "No date" }),
      row({ title: "C", startsAt: "2026-10-08T20:00:00Z" }),
      row({ title: "A", startsAt: "2026-10-06T20:00:00Z", verdict: "WILDCARD" }),
      row({ title: "B", startsAt: "2026-10-07T20:00:00Z" }),
    ];
    expect(buildPlan(rows, TZ).going.map((g) => g.title)).toEqual(["A", "B", "C", "No date"]);
    expect(buildPlan(rows, TZ).going[3]!.when).toBe("");
  });

  it("fills when / location / url / reason per going item", () => {
    const g = buildPlan(ROWS, TZ).going[0]!;
    expect(g).toEqual({
      when: "Tue, Oct 6, 5:30 PM",
      title: "Founders panel",
      location: "Sam Rivera", // organizer, since parsed.location is absent
      url: "https://lu.ma/panel",
      reason: "Fits your top journey.", // first reason only
    });
  });

  it("prefers parsed.location over organizer, and falls back to the subject for a missing title", () => {
    const rows = [
      row({
        parsed: { title: "", startsAt: "2026-10-07T00:30:00Z", organizer: "Org", location: "Moscone West" },
        subject: "Re: the panel",
      }),
    ];
    const g = buildPlan(rows, TZ).going[0]!;
    expect(g.location).toBe("Moscone West");
    expect(g.title).toBe("Re: the panel");
  });

  it("uses the decision verdict when the column is missing, and collapses multi-line fields", () => {
    const rows = [row({ title: "Multi\nline  title", verdict: undefined })];
    expect(buildPlan(rows, TZ).going[0]!.title).toBe("Multi line title");
  });

  it("formats times in the given zone", () => {
    const iso = "2026-10-07T00:30:00Z";
    expect(formatWhen(iso, "America/Los_Angeles")).toBe("Tue, Oct 6, 5:30 PM");
    expect(formatWhen(iso, "America/New_York")).toBe("Tue, Oct 6, 8:30 PM");
    expect(formatWhen(iso, "Asia/Tokyo")).toBe("Wed, Oct 7, 9:30 AM");
    expect(formatWhen("2026-10-06T19:05:00-07:00", "UTC")).toBe("Wed, Oct 7, 2:05 AM");
    expect(formatWhen(iso, "Not/AZone")).toBe("Tue, Oct 6, 5:30 PM"); // falls back to the repo default zone
    expect(formatWhen("garbage", TZ)).toBe("");
    expect(formatWhen(undefined, TZ)).toBe("");
    // plain ASCII space before PM, not U+202F
    expect(formatWhen(iso, TZ)).not.toMatch(/\u202f|\u00a0/);
  });
});

describe("formatPlanEmail", () => {
  const plan = buildPlan(ROWS, TZ);

  it("builds the subject with correct pluralisation", () => {
    expect(formatPlanEmail(plan).subject).toBe("Your Tech Week plan from Fewer: 2 events");
    expect(formatPlanEmail({ ...plan, going: plan.going.slice(0, 1) }).subject).toBe("Your Tech Week plan from Fewer: 1 event");
    expect(formatPlanEmail({ ...plan, going: [] }).subject).toBe("Your Tech Week plan from Fewer: 0 events");
  });

  it("writes the sections in order, then the declined line", () => {
    const { text } = formatPlanEmail(plan);
    const i = (s: string) => text.indexOf(s);
    expect(i("Going")).toBe(0);
    expect(i("Going")).toBeLessThan(i("Shorter or maybe"));
    expect(i("Shorter or maybe")).toBeLessThan(i("Needs one answer"));
    expect(i("Needs one answer")).toBeLessThan(i("Fewer said no to 2 other asks."));
    expect(text).toContain("- Tue, Oct 6, 5:30 PM: Founders panel (Sam Rivera)");
    expect(text).toContain("  Link: https://lu.ma/panel");
    expect(text).toContain("  Why: Fits your top journey.");
    expect(text).not.toContain("Second reason");
    expect(text).toContain("- Coffee chat (Tue, Oct 6, 9:00 AM)");
    expect(text).toContain("  Fewer suggests: Do 20 minutes by video instead.");
    expect(text).toContain("- Dinner with a VC");
    expect(text).toContain("  Question: Is this about fundraising?");
    expect(text.endsWith("Fewer said no to 2 other asks.")).toBe(true);
  });

  it("omits empty sections", () => {
    const onlyGoing = formatPlanEmail({ going: plan.going, smaller: [], askOne: [], declined: 0 }).text;
    expect(onlyGoing).toContain("Going");
    expect(onlyGoing).not.toContain("Shorter or maybe");
    expect(onlyGoing).not.toContain("Needs one answer");
    expect(onlyGoing).not.toContain("Fewer said no");

    const onlyAsk = formatPlanEmail({ going: [], smaller: [], askOne: plan.askOne, declined: 1 }).text;
    expect(onlyAsk).not.toContain("Going");
    expect(onlyAsk).not.toContain("Shorter or maybe");
    expect(onlyAsk).toContain("Needs one answer");
    expect(onlyAsk).toContain("Fewer said no to 1 other ask.");
  });

  it("contains no em dash or en dash, even when ask text does", () => {
    const rows = [
      row({
        title: `Founders ${EM} Investors ${EN} Night 5${EN}7 PM`,
        startsAt: "2026-10-07T00:30:00Z",
        parsed: {
          title: `Founders ${EM} Investors ${EN} Night 5${EN}7 PM`,
          startsAt: "2026-10-07T00:30:00Z",
          organizer: `Sam ${EM} host`,
          url: "https://lu.ma/x",
        },
        decision: { verdict: "YES", reasons: [`Fits${EM}really`] },
      }),
      row({
        title: `Smaller ${EM} one`,
        verdict: "SMALLER",
        decision: { verdict: "SMALLER", smallerOffer: `Go 6 PM ${EN} 7 PM only ${EM}` },
      }),
      row({ title: `Ask ${EN} one`, verdict: "ASK_ONE", decision: { verdict: "ASK_ONE", question: `Paid ${EM} or free?` } }),
    ];
    const email = formatPlanEmail(buildPlan(rows, TZ));
    expect(email.subject).not.toMatch(DASHES);
    expect(email.text).not.toMatch(DASHES);
    expect(email.text).toContain("Founders, Investors, Night 5 to 7 PM");
    expect(email.text).toContain("Go 6 PM to 7 PM only");
  });
});

describe("stripPlanDashes", () => {
  it("replaces spaced dashes with a comma", () => {
    expect(stripPlanDashes(`a ${EM} b`)).toBe("a, b");
    expect(stripPlanDashes(`a ${EN} b`)).toBe("a, b");
  });
  it("turns digit ranges into 'to'", () => {
    expect(stripPlanDashes(`10${EN}12`)).toBe("10 to 12");
    expect(stripPlanDashes(`5:30 PM ${EN} 7 PM`)).toBe("5:30 PM to 7 PM");
  });
  it("replaces leftovers with a comma and tidies edges and doubles", () => {
    expect(stripPlanDashes(`word${EM}word`)).toBe("word, word");
    expect(stripPlanDashes(`${EM} leading`)).toBe("leading");
    expect(stripPlanDashes(`trailing ${EM}`)).toBe("trailing");
    expect(stripPlanDashes(`a ${EM}${EM} b`)).toBe("a, b");
    expect(stripPlanDashes(`end ${EM}.`)).toBe("end.");
  });
  it("leaves clean text and ASCII hyphens alone", () => {
    expect(stripPlanDashes("Re-entry, 5-7 PM")).toBe("Re-entry, 5-7 PM");
  });
});

describe("recipient guard", () => {
  beforeEach(() => vi.stubEnv("DEMO_RECIPIENT", "owner@example.org"));
  afterEach(() => vi.unstubAllEnvs());

  it("passes only for exactly [DEMO_RECIPIENT]", () => {
    expect(() => assertOnlyRecipient(["owner@example.org"])).not.toThrow();
  });
  it("throws for any other address, extra address, empty list or case change", () => {
    expect(() => assertOnlyRecipient(["someone@else.com"])).toThrow(/DEMO_RECIPIENT/);
    expect(() => assertOnlyRecipient(["owner@example.org", "x@y.com"])).toThrow();
    expect(() => assertOnlyRecipient([])).toThrow();
    expect(() => assertOnlyRecipient(["OWNER@example.org"])).toThrow();
  });
  it("throws when DEMO_RECIPIENT is unset", () => {
    vi.stubEnv("DEMO_RECIPIENT", "");
    expect(() => assertOnlyRecipient(["owner@example.org"])).toThrow();
  });
});

describe("planIdempotencyKey", () => {
  it("is stable for the same plan and different for a changed plan", () => {
    const a = formatPlanEmail(buildPlan(ROWS, TZ));
    const same = formatPlanEmail(buildPlan([...ROWS], TZ));
    const changed = formatPlanEmail(buildPlan([...ROWS, row({ title: "One more", startsAt: "2026-10-10T18:00:00Z" })], TZ));
    const k = planIdempotencyKey(a.subject, a.text);
    expect(k).toMatch(/^plan\.[0-9a-f]{40}$/);
    expect(planIdempotencyKey(same.subject, same.text)).toBe(k);
    expect(planIdempotencyKey(changed.subject, changed.text)).not.toBe(k);
  });
});

describe("loadPlanRows", () => {
  beforeEach(() => h.sql.mockReset());

  it("passes scope as a boolean: demo asks for true, live for false", async () => {
    h.sql.mockResolvedValue([]);
    await loadPlanRows("demo");
    await loadPlanRows("live");
    const [demoCall, liveCall] = h.sql.mock.calls as unknown as Array<[TemplateStringsArray, ...unknown[]]>;
    expect(demoCall!.slice(1)).toEqual([true]);
    expect(liveCall!.slice(1)).toEqual([false]);
    expect(demoCall![0]!.join("?")).toMatch(/inbox_message_id like 'demo-%'/);
    expect(demoCall![0]!.join("?")).toMatch(/order by id desc limit 1/);
  });
});

describe("emailPlan", () => {
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

  it("412 when DEMO_RECIPIENT is unset; nothing is read or sent", async () => {
    vi.stubEnv("DEMO_RECIPIENT", "");
    const r = await emailPlan("live");
    expect(r).toEqual({ ok: false, status: 412, error: "Set DEMO_RECIPIENT to email your plan." });
    expect(h.sql).not.toHaveBeenCalled();
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("412 when DEMO_RECIPIENT is not a single address", async () => {
    vi.stubEnv("DEMO_RECIPIENT", "a@b.com, c@d.com");
    const r = await emailPlan("live");
    expect(r).toMatchObject({ ok: false, status: 412 });
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("409 when nothing is going, smaller or askOne (declined alone does not count)", async () => {
    h.sql.mockResolvedValue([row({ verdict: "NO", decision: { verdict: "NO", reasons: [] } })]);
    const r = await emailPlan("live");
    expect(r).toEqual({ ok: false, status: 409, error: "Nothing decided yet to put in a plan." });
    expect(h.sendMail).not.toHaveBeenCalled();
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it("sends exactly one email to [DEMO_RECIPIENT] with the plan, an idempotency key, and logs it", async () => {
    h.sql.mockResolvedValue(ROWS);
    const r = await emailPlan("demo");
    expect(r).toEqual({
      ok: true,
      sentTo: "owner@example.org",
      going: 2,
      smaller: 1,
      askOne: 1,
      declined: 2,
      messageId: "msg-1",
    });
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    const arg = h.sendMail.mock.calls[0]![0] as { inboxId: string; to: string[]; subject: string; text: string; idempotencyKey: string };
    expect(arg.to).toEqual(["owner@example.org"]);
    expect(arg.inboxId).toBe("fewer@agentmail.test");
    expect(arg.subject).toBe("Your Tech Week plan from Fewer: 2 events");
    expect(arg.text).toContain("Needs one answer");
    expect(arg.idempotencyKey).toBe(planIdempotencyKey(arg.subject, arg.text));
    expect(h.logEvent).toHaveBeenCalledWith("plan_emailed", null, { scope: "demo", going: 2, smaller: 1, askOne: 1, messageId: "msg-1" });
  });

  it("same plan sends the same key, a changed plan a fresh one", async () => {
    h.sql.mockResolvedValue(ROWS);
    await emailPlan("live");
    await emailPlan("live");
    h.sql.mockResolvedValue([...ROWS, row({ title: "One more", startsAt: "2026-10-10T18:00:00Z" })]);
    await emailPlan("live");
    const keys = h.sendMail.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("never mails an ask sender or organiser", async () => {
    h.sql.mockResolvedValue(ROWS);
    await emailPlan("live");
    const arg = h.sendMail.mock.calls[0]![0] as { to: string[] };
    expect(arg.to).toHaveLength(1);
    expect(arg.to[0]).toBe("owner@example.org");
  });

  it("propagates a send failure and does not log plan_emailed", async () => {
    h.sql.mockResolvedValue(ROWS);
    h.sendMail.mockRejectedValue(new Error("agentmail down"));
    await expect(emailPlan("live")).rejects.toThrow("agentmail down");
    expect(h.logEvent).not.toHaveBeenCalled();
  });
});
