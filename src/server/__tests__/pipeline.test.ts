import { describe, expect, it, vi } from "vitest";

// The pure helpers live in pipeline.ts; stub its heavy/IO-bound imports so no env or network is needed.
vi.mock("../db", () => ({}));
vi.mock("../llm", () => ({}));
vi.mock("../mail", () => ({}));
vi.mock("../research", () => ({}));

import {
  draftFirstLine,
  formatBrief,
  isEveningOut,
  parseRating,
  payloadHash,
  stripQuoted,
  weekKey,
} from "../pipeline";

const TZ = "America/Los_Angeles";

describe("parseRating", () => {
  it("takes the first 1-5 integer and the rest as the note", () => {
    expect(parseRating("4 - great founders, a bit loud")).toEqual({ rating: 4, note: "great founders, a bit loud" });
    expect(parseRating("Honestly a 2, too salesy")?.rating).toBe(2);
  });
  it("handles n/5 and ignores numbers outside 1-5", () => {
    expect(parseRating("5/5 loved it")).toEqual({ rating: 5, note: "loved it" });
    expect(parseRating("10 out of 10")).toBeNull();
    expect(parseRating("no idea")).toBeNull();
  });
  it("ignores quoted history", () => {
    const reply = "3 fine\n\nOn Mon, Oct 5, 2026 Fewer wrote:\n> Reply 1–5 and a few words.";
    expect(parseRating(reply)).toEqual({ rating: 3, note: "fine" });
    expect(parseRating("> Reply 1–5\nthanks")).toBeNull();
  });
});

describe("stripQuoted", () => {
  it("cuts at the 'wrote:' header and drops > lines", () => {
    expect(stripQuoted("YES 7F3K\n> old\nOn Tue, A wrote:\nstuff")).toBe("YES 7F3K");
  });
});

describe("draftFirstLine", () => {
  it("skips a bare greeting and truncates", () => {
    expect(draftFirstLine("Hi Maya,\n\nI'd love to come on Thursday.\nBest")).toBe("I'd love to come on Thursday.");
    expect(draftFirstLine("x".repeat(300), 20)).toHaveLength(20);
  });
});

describe("formatBrief", () => {
  const out = formatBrief({
    code: "7F3K",
    items: [
      { verdict: "YES", from: "Maya <maya@x.com>", title: "Agent Builders Night", reason: "Fits launch goal", draftFirstLine: "Count me in." },
      { verdict: "SMALLER", from: "jordan@x.com", title: "Coffee Tuesday", reason: "Tue 9–12 is deep work", draftFirstLine: "Can we do 20 min on Zoom?" },
    ],
    blocked: [{ from: "evil@x.com", title: "Quick favor", reason: "Instructions aimed at the agent" }],
  });
  it("has the header, per-ask lines, a blocked section and the exact footer", () => {
    expect(out.subject).toBe("Fewer brief — 3 asks");
    expect(out.text).toContain("1. YES — from Maya <maya@x.com>");
    expect(out.text).toContain("   Why: Fits launch goal");
    expect(out.text).toContain("   Draft: Count me in.");
    expect(out.text).toContain("BLOCKED — no action taken");
    expect(out.text).toContain("- from evil@x.com: Quick favor — Instructions aimed at the agent");
    expect(out.text.trimEnd().endsWith("Reply YES 7F3K to send exactly these drafts. Reply NO to hold them. Code expires in 30 min.")).toBe(true);
  });
  it("singular header", () => {
    expect(formatBrief({ code: "AAAA", items: [], blocked: [{ from: "a", title: "b", reason: "" }] }).subject).toBe("Fewer brief — 1 ask");
  });
});

describe("payloadHash", () => {
  const a = { id: "drf_a", to_email: "a@x.com", body: "hello" };
  const b = { id: "drf_b", to_email: "b@x.com", body: "world" };
  it("is order-independent and ignores extra fields", () => {
    expect(payloadHash([a, b])).toBe(payloadHash([b, { ...a, extra: 1 } as typeof a]));
  });
  it("changes when a body or recipient changes", () => {
    expect(payloadHash([a, b])).not.toBe(payloadHash([{ ...a, body: "hello!" }, b]));
    expect(payloadHash([a, b])).not.toBe(payloadHash([a, { ...b, to_email: "c@x.com" }]));
  });
});

describe("weekKey / isEveningOut", () => {
  it("groups a Monday-start week in the local zone", () => {
    // Sun 2026-10-04 local and Mon 2026-09-28 local share a week; Mon 2026-10-05 starts the next.
    expect(weekKey("2026-10-04T12:00:00-07:00", TZ)).toBe("2026-09-28");
    expect(weekKey("2026-09-28T00:30:00-07:00", TZ)).toBe("2026-09-28");
    expect(weekKey("2026-10-05T09:00:00-07:00", TZ)).toBe("2026-10-05");
    expect(weekKey("2026-10-08T18:00:00-07:00", TZ)).toBe("2026-10-05");
    expect(weekKey("not a date", TZ)).toBeNull();
  });
  it("uses local time, not UTC, for the week boundary", () => {
    // Sun 2026-10-04 20:00 PDT is already Mon in UTC; must still be the previous local week.
    expect(weekKey("2026-10-05T03:00:00Z", TZ)).toBe("2026-09-28");
  });
  it("evening = in-person and starting 17:00+ local", () => {
    expect(isEveningOut({ startsAt: "2026-10-08T18:00:00-07:00", inPerson: true }, TZ)).toBe(true);
    expect(isEveningOut({ startsAt: "2026-10-08T18:00:00-07:00", inPerson: false }, TZ)).toBe(false);
    expect(isEveningOut({ startsAt: "2026-10-08T10:00:00-07:00", inPerson: true }, TZ)).toBe(false);
    expect(isEveningOut({ inPerson: true }, TZ)).toBe(false);
  });
});
