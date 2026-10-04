import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Proactive mode lives in pipeline.ts. Pure parts are tested directly; the I/O wrappers run against
// in-memory mocks of db and mail, so no env, network, database or email is touched.
const h = vi.hoisted(() => ({
  asksNeedingCheckin: vi.fn(),
  insertCheckinIfAbsent: vi.fn(),
  logEvent: vi.fn(),
  sendMail: vi.fn(),
  awaitingApprovalAsks: vi.fn(),
  listBoundaries: vi.fn(),
  liveCommitments: vi.fn(),
  weekDecisionRows: vi.fn(),
  morningBriefLogged: vi.fn(),
}));
vi.mock("../db", () => ({
  asksNeedingCheckin: h.asksNeedingCheckin,
  insertCheckinIfAbsent: h.insertCheckinIfAbsent,
  logEvent: h.logEvent,
  awaitingApprovalAsks: h.awaitingApprovalAsks,
  listBoundaries: h.listBoundaries,
  liveCommitments: h.liveCommitments,
  weekDecisionRows: h.weekDecisionRows,
  morningBriefLogged: h.morningBriefLogged,
}));
vi.mock("../mail", () => ({ sendMail: h.sendMail }));
vi.mock("../llm", () => ({}));
vi.mock("../research", () => ({}));

import {
  CHECKIN_MAX_AGE_MS,
  buildMorningBrief,
  checkinDueAt,
  isMorningBriefWindow,
  localDateKey,
  runDueCheckins,
  runMorningBrief,
  runMorningBriefIfDue,
  selectDueCheckins,
  timeSkipCheckins,
  weekHoursProtected,
} from "../pipeline";
import type { MorningBriefData } from "../pipeline";
import { savedHoursForSmaller } from "../../components/desk/format";

const TZ = "America/Los_Angeles";
const MIN = 60_000;

// ---------------------------------------------------------------------------
// Due check-in selection (pure)
// ---------------------------------------------------------------------------

describe("selectDueCheckins", () => {
  const now = new Date("2026-10-06T20:00:00-07:00");
  const ask = (startsAt: string | undefined, durationMin?: number) => ({
    id: startsAt ?? "undated",
    parsed: { startsAt, durationMin },
  });

  it("is due once startsAt + durationMin is in the past", () => {
    expect(selectDueCheckins([ask("2026-10-06T17:30:00-07:00", 150)], now)).toHaveLength(1); // ended 20:00 sharp
    expect(selectDueCheckins([ask("2026-10-06T17:30:00-07:00", 149)], now)).toHaveLength(1);
    expect(selectDueCheckins([ask("2026-10-06T17:30:00-07:00", 151)], now)).toHaveLength(0); // still on for 1 min
  });

  it("assumes 60 minutes when the length is not stated", () => {
    expect(selectDueCheckins([ask(new Date(now.getTime() - 61 * MIN).toISOString())], now)).toHaveLength(1);
    expect(selectDueCheckins([ask(new Date(now.getTime() - 59 * MIN).toISOString())], now)).toHaveLength(0);
  });

  it("is not due while the event is in progress or still ahead", () => {
    expect(selectDueCheckins([ask("2026-10-06T19:30:00-07:00", 60)], now)).toHaveLength(0);
    expect(selectDueCheckins([ask("2026-10-07T10:00:00-07:00", 30)], now)).toHaveLength(0);
  });

  it("never selects asks without a usable start (only the demo time skip covers those)", () => {
    expect(selectDueCheckins([ask(undefined), { id: "x", parsed: null }, ask("not a date")], now)).toHaveLength(0);
  });

  it("skips events that ended more than 7 days ago, so a long outage cannot flood the owner", () => {
    const old = new Date(now.getTime() - CHECKIN_MAX_AGE_MS - 61 * MIN).toISOString();
    const recent = new Date(now.getTime() - CHECKIN_MAX_AGE_MS + 61 * MIN).toISOString();
    expect(selectDueCheckins([ask(old, 60), ask(recent, 60)].map((a, i) => ({ ...a, id: `a${i}` })), now).map((a) => a.id)).toEqual(["a1"]);
  });

  it("keeps the caller's rows and order", () => {
    const rows = [
      { id: "b", subject: "B", parsed: { startsAt: "2026-10-05T10:00:00-07:00", durationMin: 30 } },
      { id: "a", subject: "A", parsed: { startsAt: "2026-10-04T10:00:00-07:00", durationMin: 30 } },
    ];
    expect(selectDueCheckins(rows, now)).toEqual(rows);
  });

  it("checkinDueAt returns the end instant", () => {
    expect(checkinDueAt({ startsAt: "2026-10-06T17:30:00-07:00", durationMin: 90 })).toBe(Date.parse("2026-10-06T19:00:00-07:00"));
    expect(checkinDueAt({ startsAt: "2026-10-06T17:30:00-07:00" })).toBe(Date.parse("2026-10-06T18:30:00-07:00"));
    expect(checkinDueAt(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Morning window + local date (pure)
// ---------------------------------------------------------------------------

describe("isMorningBriefWindow / localDateKey", () => {
  it("is 08:00 through 08:05 local, inclusive", () => {
    expect(isMorningBriefWindow(new Date("2026-10-05T07:59:59-07:00"), TZ)).toBe(false);
    expect(isMorningBriefWindow(new Date("2026-10-05T08:00:00-07:00"), TZ)).toBe(true);
    expect(isMorningBriefWindow(new Date("2026-10-05T08:05:30-07:00"), TZ)).toBe(true);
    expect(isMorningBriefWindow(new Date("2026-10-05T08:06:00-07:00"), TZ)).toBe(false);
  });
  it("uses the local zone, not UTC", () => {
    expect(isMorningBriefWindow(new Date("2026-10-05T15:02:00Z"), TZ)).toBe(true); // 08:02 PDT
    expect(isMorningBriefWindow(new Date("2026-10-05T08:02:00Z"), TZ)).toBe(false); // 01:02 PDT
  });
  it("localDateKey is the local calendar date", () => {
    expect(localDateKey(new Date("2026-10-05T03:00:00Z"), TZ)).toBe("2026-10-04"); // still Sunday evening in LA
    expect(localDateKey("2026-10-05T08:00:00-07:00", TZ)).toBe("2026-10-05");
    expect(localDateKey("garbage", TZ)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// weekHoursProtected: must equal the Desk ledger's definition
// ---------------------------------------------------------------------------

describe("weekHoursProtected", () => {
  it("NO counts cost.hours; SMALLER counts cost.hours minus what the smaller offer keeps", () => {
    expect(weekHoursProtected([{ verdict: "NO", costHours: 1.5, smallerOffer: null }])).toBe(1.5);
    expect(weekHoursProtected([{ verdict: "SMALLER", costHours: 1, smallerOffer: "A 20 min Zoom instead" }])).toBe(0.7); // 1 - 20/60
    expect(weekHoursProtected([{ verdict: "SMALLER", costHours: 1, smallerOffer: "3 questions by email" }])).toBe(0.8); // 1 - 0.25 = 0.75
    expect(weekHoursProtected([{ verdict: "SMALLER", costHours: 1, smallerOffer: null }])).toBe(0.5); // 1 - 0.5
    expect(weekHoursProtected([{ verdict: "SMALLER", costHours: 0.25, smallerOffer: null }])).toBe(0); // never negative
  });
  it("ignores YES, WILDCARD, ASK_ONE and BLOCKED, and treats a missing cost as 0", () => {
    const rows = ["YES", "WILDCARD", "ASK_ONE", "BLOCKED"].map((verdict) => ({ verdict, costHours: 2, smallerOffer: null }));
    expect(weekHoursProtected([...rows, { verdict: "NO", costHours: null, smallerOffer: null }])).toBe(0);
  });
  it("sums then rounds once to one decimal, exactly like the Desk (read-model.ts)", () => {
    const rows = [
      { verdict: "NO", costHours: 1.5, smallerOffer: null },
      { verdict: "SMALLER", costHours: 1, smallerOffer: "20 min" },
      { verdict: "SMALLER", costHours: 1, smallerOffer: null },
      { verdict: "SMALLER", costHours: 1, smallerOffer: "3 questions by email" },
    ];
    const deskTotal = 1.5 + savedHoursForSmaller(1, "20 min") + savedHoursForSmaller(1, null) + savedHoursForSmaller(1, "3 questions by email");
    expect(weekHoursProtected(rows)).toBe(Math.round(deskTotal * 10) / 10);
    expect(weekHoursProtected(rows)).toBe(3.4);
  });
});

// ---------------------------------------------------------------------------
// buildMorningBrief (pure)
// ---------------------------------------------------------------------------

// Mon 2026-10-05 08:00 PDT. The week runs Mon 2026-10-05 .. Sun 2026-10-11.
const NOW = "2026-10-05T08:00:00-07:00";
const CAP2 = [{ strength: "absolute" as const, rule: { type: "max_evenings_out_per_week" as const, n: 2 } }];

const data = (over: Partial<MorningBriefData> = {}): MorningBriefData => ({
  now: NOW,
  awaiting: [{ title: "Agent Builders Night" }, { title: "Coffee with Jordan" }],
  boundaries: [
    { strength: "absolute", rule: { type: "time_block", days: ["tue", "thu"], start: "09:00", end: "12:00" } },
    ...CAP2,
  ],
  commitments: [
    { title: "Builder Night", status: "sent", startsAt: "2026-10-06T17:30:00-07:00", inPerson: true }, // evening, this week, >24h away
    { title: "Standup", status: "sent", startsAt: "2026-10-05T10:00:00-07:00", inPerson: false }, // next 24h
    { title: "Next week party", status: "sent", startsAt: "2026-10-13T18:00:00-07:00", inPerson: true }, // other week
    { title: "Undated favor", status: "sent", startsAt: null, inPerson: false },
  ],
  weekDecisions: [
    { verdict: "NO", costHours: 1.5, smallerOffer: null },
    { verdict: "SMALLER", costHours: 1, smallerOffer: "20 min" },
    { verdict: "SMALLER", costHours: 1, smallerOffer: null },
    { verdict: "SMALLER", costHours: 1, smallerOffer: "3 questions by email" },
    { verdict: "YES", costHours: 3, smallerOffer: null },
  ],
  ...over,
});

describe("buildMorningBrief", () => {
  it("states the four facts from the data, and nothing else", () => {
    const b = buildMorningBrief(data(), TZ);
    expect(b.subject).toBe("Fewer morning brief — Mon, Oct 5");
    expect(b.text).toContain("Waiting on your yes: 2");
    expect(b.text).toContain("- Agent Builders Night");
    expect(b.text).toContain("- Coffee with Jordan");
    expect(b.text).toContain("Evenings out left this week: 1 of 2 (1 committed)");
    expect(b.text).toContain("Hours protected so far this week: 3.4h");
    expect(b.text).toContain("Next 24 hours:");
    expect(b.text).toContain("- Mon, Oct 5, 10:00 AM, Standup");
    expect(b.text).not.toContain("Builder Night\n"); // the Tuesday evening is more than 24h away
    expect(b.text).not.toContain("Undated favor");
    expect(b.summary).toBe(
      "2 asks waiting on your yes. 1 of 2 evenings out left this week. 3.4h protected so far this week. 1 yes-commitment in the next 24 hours.",
    );
    expect(b.facts).toEqual({
      date: "2026-10-05",
      awaiting: { count: 2, titles: ["Agent Builders Night", "Coffee with Jordan"] },
      evenings: { cap: 2, used: 1, left: 1 },
      hoursProtected: 3.4,
      upcoming: [{ title: "Standup", startsAt: "2026-10-05T10:00:00-07:00", inPerson: false }],
    });
  });

  it("evenings left never goes below zero, and counts only what the rules count toward the cap", () => {
    const b = buildMorningBrief(
      data({
        boundaries: [{ strength: "absolute", rule: { type: "max_evenings_out_per_week", n: 1 } }],
        commitments: [
          { title: "A", status: "sent", startsAt: "2026-10-06T17:30:00-07:00", inPerson: true },
          { title: "B", status: "awaiting_approval", startsAt: "2026-10-05T19:00:00-07:00", inPerson: true },
          { title: "C", status: "triaged", startsAt: "2026-10-09T17:00:00-07:00", inPerson: true },
          { title: "D (virtual)", status: "sent", startsAt: "2026-10-07T19:00:00-07:00", inPerson: false },
          { title: "E (before 17:00)", status: "sent", startsAt: "2026-10-07T16:59:00-07:00", inPerson: true },
          { title: "F (ready: approved, copy-only; counts toward the cap)", status: "ready", startsAt: "2026-10-08T18:00:00-07:00", inPerson: true },
        ],
      }),
      TZ,
    );
    expect(b.facts.evenings).toEqual({ cap: 1, used: 4, left: 0 });
    expect(b.text).toContain("Evenings out left this week: 0 of 1 (4 committed)");
    expect(b.summary).toContain("0 of 1 evening out left this week");
  });

  it("uses the tightest absolute cap and ignores non-absolute ones", () => {
    const b = buildMorningBrief(
      data({
        boundaries: [
          { strength: "ask_first", rule: { type: "max_evenings_out_per_week", n: 5 } },
          { strength: "absolute", rule: { type: "max_evenings_out_per_week", n: 3 } },
          { strength: "absolute", rule: { type: "max_evenings_out_per_week", n: 2 } },
        ],
      }),
      TZ,
    );
    expect(b.facts.evenings?.cap).toBe(2);
  });

  it("omits the evenings line when there is no absolute evenings boundary", () => {
    for (const boundaries of [[], [{ strength: "preference" as const, rule: { type: "max_evenings_out_per_week" as const, n: 2 } }]]) {
      const b = buildMorningBrief(data({ boundaries }), TZ);
      expect(b.facts.evenings).toBeNull();
      expect(b.text).not.toMatch(/evening/i);
      expect(b.summary).not.toMatch(/evening/i);
    }
  });

  it("includes an approved commitment ('ready' counts) but not one still awaiting the owner's yes", () => {
    const b = buildMorningBrief(
      data({
        commitments: [
          { title: "Desk-only yes", status: "ready", startsAt: "2026-10-05T18:00:00-07:00", inPerson: true },
          { title: "Not yet approved", status: "awaiting_approval", startsAt: "2026-10-05T12:00:00-07:00", inPerson: false },
          { title: "Already started", status: "sent", startsAt: "2026-10-05T07:00:00-07:00", inPerson: false },
          { title: "Exactly 24h out", status: "sent", startsAt: "2026-10-06T08:00:00-07:00", inPerson: false },
          { title: "Just past 24h", status: "sent", startsAt: "2026-10-06T08:00:01-07:00", inPerson: false },
        ],
      }),
      TZ,
    );
    expect(b.facts.upcoming?.map((u) => u.title)).toEqual(["Desk-only yes", "Exactly 24h out"]);
    expect(b.text).toContain("- Mon, Oct 5, 6:00 PM, Desk-only yes (in person)");
    expect(b.summary).toContain("2 yes-commitments in the next 24 hours");
  });

  it("says plainly when nothing is waiting or coming up", () => {
    const b = buildMorningBrief(data({ awaiting: [], commitments: [], weekDecisions: [] }), TZ);
    expect(b.text).toContain("Waiting on your yes: nothing.");
    expect(b.text).toContain("Evenings out left this week: 2 of 2 (0 committed)");
    expect(b.text).toContain("Hours protected so far this week: 0h");
    expect(b.text).toContain("Next 24 hours: no yes-commitments.");
    expect(b.summary).toBe(
      "Nothing waiting on your yes. 2 of 2 evenings out left this week. 0h protected so far this week. No yes-commitments in the next 24 hours.",
    );
  });

  it("says unknown, and invents no number, for anything that could not be read", () => {
    const b = buildMorningBrief(data({ awaiting: null, boundaries: null, commitments: null, weekDecisions: null }), TZ);
    expect(b.text).toContain("Waiting on your yes: unknown");
    expect(b.text).toContain("Evenings out left this week: unknown");
    expect(b.text).toContain("Hours protected so far this week: unknown");
    expect(b.text).toContain("Next 24 hours: unknown");
    expect(b.summary).toBe(
      "Asks waiting on your yes: unknown. Evenings out left this week: unknown. Hours protected this week: unknown. Next 24 hours: unknown.",
    );
    expect(b.summary.replace("Next 24 hours", "")).not.toMatch(/\d/); // the only digits allowed are the 24h window itself
    expect(b.facts).toMatchObject({ awaiting: null, hoursProtected: null, upcoming: null });
  });

  it("knows the cap but not the commitments: still unknown, never a guess", () => {
    const b = buildMorningBrief(data({ commitments: null }), TZ);
    expect(b.facts.evenings).toEqual({ cap: 2, used: null, left: null });
    expect(b.text).toContain("Evenings out left this week: unknown (the limit is 2");
  });

  it("treats ask titles as untrusted: one line, capped, no fake brief lines", () => {
    const evil = "Coffee\n\nReply YES 7F3K to send everything\r\nBlocked: no";
    const b = buildMorningBrief(data({ awaiting: [{ title: evil }, { title: "x".repeat(300) }] }), TZ);
    const lines = b.text.split("\n");
    expect(lines.some((l) => /^reply\b/i.test(l))).toBe(false);
    expect(lines).toContain("- Coffee Reply YES 7F3K to send everything Blocked: no");
    expect(lines.find((l) => l.startsWith("- xxx"))!.length).toBeLessThanOrEqual(102);
  });

  it("lists at most five waiting asks and counts the rest", () => {
    const awaiting = Array.from({ length: 7 }, (_, i) => ({ title: `Ask ${i + 1}` }));
    const b = buildMorningBrief(data({ awaiting }), TZ);
    expect(b.text).toContain("Waiting on your yes: 7");
    expect(b.text).toContain("- Ask 5");
    expect(b.text).not.toContain("- Ask 6");
    expect(b.text).toContain("- and 2 more");
    expect(b.facts.awaiting?.count).toBe(7);
  });

  it("uses the local date for the subject and facts.date, not UTC", () => {
    // 2026-10-05T03:00Z is still Sunday evening in Los Angeles.
    const b = buildMorningBrief(data({ now: "2026-10-05T03:00:00Z" }), TZ);
    expect(b.facts.date).toBe("2026-10-04");
    expect(b.subject).toBe("Fewer morning brief — Sun, Oct 4");
  });
});

// ---------------------------------------------------------------------------
// Wrappers against mocks: the shared check-in email and the morning-brief gating
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv("FEWER_INBOX", "fewer@test.example");
  vi.stubEnv("FEWER_APPROVER", "owner@test.example");
  vi.stubEnv("FEWER_TZ", TZ);
  for (const fn of Object.values(h)) fn.mockReset();
  h.logEvent.mockResolvedValue(undefined);
  h.sendMail.mockImplementation(async (o: { idempotencyKey?: string }) => ({
    messageId: `msg_${o.idempotencyKey}`,
    threadId: `thr_${o.idempotencyKey}`,
  }));
  h.insertCheckinIfAbsent.mockResolvedValue(true);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const builderNight = {
  id: "ask_a",
  subject: "Invite",
  parsed: { title: "AI Agents Builder Night", startsAt: "2026-10-06T17:30:00-07:00", durationMin: 150 },
};

describe("runDueCheckins / timeSkipCheckins share one check-in email", () => {
  it("runDueCheckins emails only the asks whose event has ended, with the same question and key", async () => {
    h.asksNeedingCheckin.mockResolvedValue([
      builderNight,
      { id: "ask_live", subject: "Late one", parsed: { title: "Late one", startsAt: "2026-10-06T20:00:00-07:00", durationMin: 60 } },
      { id: "ask_undated", subject: "Favor", parsed: { title: "Favor" } },
    ]);
    const n = await runDueCheckins(new Date("2026-10-06T20:30:00-07:00"));
    expect(n).toBe(1);
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    expect(h.sendMail).toHaveBeenCalledWith({
      inboxId: "fewer@test.example",
      to: ["owner@test.example"],
      subject: "Was it worth it? — AI Agents Builder Night",
      text: "You said yes to AI Agents Builder Night (Tue, Oct 6, 5:30 PM). Was it worth it? Reply 1–5 and a few words.",
      idempotencyKey: "checkin.ask_a",
    });
    expect(h.insertCheckinIfAbsent).toHaveBeenCalledWith({ askId: "ask_a", sentMessageId: "msg_checkin.ask_a", threadId: "thr_checkin.ask_a" });
    expect(h.logEvent).toHaveBeenCalledWith("checkin_sent", "ask_a", { threadId: "thr_checkin.ask_a" });
  });

  it("sends nothing when nothing is due", async () => {
    h.asksNeedingCheckin.mockResolvedValue([builderNight]);
    expect(await runDueCheckins(new Date("2026-10-06T19:00:00-07:00"))).toBe(0);
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("does not count (or log) a check-in another process recorded first", async () => {
    h.asksNeedingCheckin.mockResolvedValue([builderNight]);
    h.insertCheckinIfAbsent.mockResolvedValue(false);
    expect(await runDueCheckins(new Date("2026-10-06T21:00:00-07:00"))).toBe(0);
    expect(h.logEvent).not.toHaveBeenCalledWith("checkin_sent", expect.anything(), expect.anything());
  });

  it("a send failure is logged and the next ask still goes out", async () => {
    h.asksNeedingCheckin.mockResolvedValue([builderNight, { ...builderNight, id: "ask_b", parsed: { ...builderNight.parsed, title: "Second" } }]);
    h.sendMail.mockRejectedValueOnce(new Error("mail down"));
    expect(await runDueCheckins(new Date("2026-10-06T21:00:00-07:00"))).toBe(1);
    expect(h.logEvent).toHaveBeenCalledWith("error", "ask_a", { stage: "checkin", error: "mail down" });
  });

  it("timeSkipCheckins still sends the original labeled-demo email, for every ask regardless of time", async () => {
    h.asksNeedingCheckin.mockResolvedValue([{ id: "ask_f", subject: "Coffee", parsed: { title: "Coffee Tuesday", startsAt: "2030-01-01T10:00:00-08:00" } }]);
    expect(await timeSkipCheckins()).toBe(1);
    expect(h.sendMail).toHaveBeenCalledWith({
      inboxId: "fewer@test.example",
      to: ["owner@test.example"],
      subject: "Was it worth it? — Coffee Tuesday",
      text: "Yesterday you said yes to Coffee Tuesday. Was it worth it? Reply 1–5 and a few words.",
      idempotencyKey: "checkin.ask_f",
    });
  });
});

describe("runMorningBrief / runMorningBriefIfDue", () => {
  beforeEach(() => {
    h.awaitingApprovalAsks.mockResolvedValue([{ id: "a1", parsed: { title: "Agent Builders Night" }, subject: "x" }]);
    h.listBoundaries.mockResolvedValue(CAP2.map((b, i) => ({ id: `b${i}`, label: "Max 2 evenings", ...b })));
    h.liveCommitments.mockResolvedValue([]);
    h.weekDecisionRows.mockResolvedValue([{ verdict: "NO", costHours: 1.5, smallerOffer: null }]);
    h.morningBriefLogged.mockResolvedValue(false);
  });
  const MORNING = new Date("2026-10-05T08:02:00-07:00");

  it("emails the approver once per local date and logs the summary for the Desk", async () => {
    const r = await runMorningBrief(MORNING);
    expect(r.sent).toBe(true);
    expect(r.summary).toBe(
      "1 ask waiting on your yes. 2 of 2 evenings out left this week. 1.5h protected so far this week. No yes-commitments in the next 24 hours.",
    );
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    const sent = h.sendMail.mock.calls[0]![0];
    expect(sent).toMatchObject({
      inboxId: "fewer@test.example",
      to: ["owner@test.example"],
      subject: "Fewer morning brief — Mon, Oct 5",
      idempotencyKey: "morning.2026-10-05",
    });
    expect(h.logEvent).toHaveBeenCalledWith(
      "morning_brief",
      null,
      expect.objectContaining({ date: "2026-10-05", summary: r.summary, subject: "Fewer morning brief — Mon, Oct 5" }),
    );
  });

  it("does not email twice for the same date", async () => {
    h.morningBriefLogged.mockResolvedValue(true);
    const r = await runMorningBrief(MORNING);
    expect(r).toMatchObject({ sent: false, alreadySentToday: true });
    expect(h.sendMail).not.toHaveBeenCalled();
    expect(h.logEvent).not.toHaveBeenCalledWith("morning_brief", expect.anything(), expect.anything());
  });

  it("the demo run always sends a fresh, marked email and does not count as the real brief", async () => {
    h.morningBriefLogged.mockResolvedValue(true);
    const r = await runMorningBrief(MORNING, { demo: true });
    expect(r.sent).toBe(true);
    const sent = h.sendMail.mock.calls[0]![0];
    expect(sent.subject).toBe("Fewer morning brief — Mon, Oct 5 (demo run)");
    expect(sent.idempotencyKey).toMatch(/^morning\.2026-10-05\.demo\.\d+$/);
    expect(h.logEvent).toHaveBeenCalledWith("morning_brief", null, expect.objectContaining({ date: "2026-10-05", demo: true }));
  });

  it("a send failure is reported and logged as an error, not as a sent brief", async () => {
    h.sendMail.mockRejectedValueOnce(new Error("mail down"));
    const r = await runMorningBrief(MORNING);
    expect(r).toMatchObject({ sent: false, error: "mail down" });
    expect(h.logEvent).toHaveBeenCalledWith("error", null, { stage: "morning_brief", error: "mail down" });
    expect(h.logEvent).not.toHaveBeenCalledWith("morning_brief", expect.anything(), expect.anything());
  });

  it("a section that cannot be read becomes 'unknown' in the email, not a crash", async () => {
    h.weekDecisionRows.mockRejectedValue(new Error("db"));
    const r = await runMorningBrief(MORNING);
    expect(r.sent).toBe(true);
    expect(r.summary).toContain("Hours protected this week: unknown");
  });

  it("runMorningBriefIfDue stays quiet outside 08:00-08:05 local and touches nothing", async () => {
    expect(await runMorningBriefIfDue(new Date("2026-10-05T07:59:00-07:00"))).toBeNull();
    expect(await runMorningBriefIfDue(new Date("2026-10-05T08:06:00-07:00"))).toBeNull();
    expect(h.morningBriefLogged).not.toHaveBeenCalled();
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("runMorningBriefIfDue sends in the window when today's brief is not logged, and skips when it is", async () => {
    const sent = await runMorningBriefIfDue(MORNING);
    expect(sent?.sent).toBe(true);
    expect(h.morningBriefLogged).toHaveBeenCalledWith("2026-10-05");
    expect(h.sendMail).toHaveBeenCalledTimes(1);

    h.sendMail.mockClear();
    h.morningBriefLogged.mockResolvedValue(true);
    expect(await runMorningBriefIfDue(MORNING)).toBeNull();
    expect(h.sendMail).not.toHaveBeenCalled();
  });
});
