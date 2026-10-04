import { beforeEach, describe, expect, it, vi } from "vitest";

// buildContext lives in pipeline.ts; stub its IO so no env, database or network is needed.
const h = vi.hoisted(() => {
  const state = {
    queries: [] as { text: string; values: unknown[] }[],
    busyRows: [] as { start_at: Date; end_at: Date; source: string }[],
    acceptedRows: [] as { id: string; title: string | null; starts_at: string | null; duration_min: string | null }[],
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    state.queries.push({ text, values });
    if (text.includes("from calendar_busy")) return Promise.resolve(state.busyRows);
    // Returns rows unfiltered (no `a.id <> askId`), so the JS-side self-exclusion is tested on its own.
    if (text.includes("from asks a")) return Promise.resolve(state.acceptedRows);
    return Promise.reject(new Error(`unexpected sql: ${text}`));
  };
  const db = {
    sql,
    committedAsks: vi.fn(async () => []),
    listRatings: vi.fn(async () => []),
  };
  return { state, db };
});

vi.mock("../db", () => h.db);
vi.mock("../llm", () => ({}));
vi.mock("../mail", () => ({}));
vi.mock("../research", () => ({}));

import type { ParsedAsk } from "../../core";
import { MAX_BUSY_BLOCKS, acceptedTakenBlocks, calendarWindow, parseBusyPayload } from "../calendar";
import { buildContext } from "../pipeline";

const TZ = "America/Los_Angeles";

describe("parseBusyPayload (POST /api/calendar/busy validation)", () => {
  const block = { start: "2026-10-05T16:00:00Z", end: "2026-10-05T17:00:00Z" };

  it("accepts blocks, defaults source to google, normalizes to UTC and drops every other field", () => {
    const r = parseBusyPayload({
      blocks: [{ ...block, title: "Secret meeting", location: "HQ", attendees: ["a@b.c"] }, { start: "2026-10-05T10:00:00-07:00", end: "2026-10-05T10:30:00-07:00" }],
    });
    expect(r).toEqual({
      ok: true,
      source: "google",
      blocks: [
        { start: "2026-10-05T16:00:00.000Z", end: "2026-10-05T17:00:00.000Z" },
        { start: "2026-10-05T17:00:00.000Z", end: "2026-10-05T17:30:00.000Z" },
      ],
    });
  });

  it("accepts an empty list (clears the window) and a custom source", () => {
    expect(parseBusyPayload({ blocks: [], source: "Outlook" })).toEqual({ ok: true, source: "outlook", blocks: [] });
  });

  it("rejects non-objects, missing blocks and bad sources", () => {
    expect(parseBusyPayload(null).ok).toBe(false);
    expect(parseBusyPayload([block]).ok).toBe(false);
    expect(parseBusyPayload({}).ok).toBe(false);
    expect(parseBusyPayload({ blocks: [block], source: "" }).ok).toBe(false);
    expect(parseBusyPayload({ blocks: [block], source: "a b" }).ok).toBe(false);
  });

  it("rejects non-ISO, offset-less and date-only times", () => {
    for (const start of ["tomorrow", "2026-10-05T16:00:00", "2026-10-05", 1759680000000]) {
      const r = parseBusyPayload({ blocks: [{ ...block, start }] });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects end <= start and blocks over 24 h; allows exactly 24 h", () => {
    expect(parseBusyPayload({ blocks: [{ start: block.end, end: block.start }] }).ok).toBe(false);
    expect(parseBusyPayload({ blocks: [{ start: block.start, end: block.start }] }).ok).toBe(false);
    expect(parseBusyPayload({ blocks: [{ start: "2026-10-05T00:00:00Z", end: "2026-10-06T00:00:01Z" }] }).ok).toBe(false);
    expect(parseBusyPayload({ blocks: [{ start: "2026-10-05T00:00:00-07:00", end: "2026-10-06T00:00:00-07:00" }] }).ok).toBe(true);
  });

  it(`allows ${MAX_BUSY_BLOCKS} blocks and rejects one more`, () => {
    expect(parseBusyPayload({ blocks: Array.from({ length: MAX_BUSY_BLOCKS }, () => block) }).ok).toBe(true);
    const r = parseBusyPayload({ blocks: Array.from({ length: MAX_BUSY_BLOCKS + 1 }, () => block) });
    expect(r).toEqual({ ok: false, error: `At most ${MAX_BUSY_BLOCKS} blocks.` });
  });

  it("names the offending block", () => {
    const r = parseBusyPayload({ blocks: [block, { start: "x", end: "y" }] });
    expect(r.ok === false && r.error).toContain("blocks[1]");
  });
});

describe("calendarWindow", () => {
  it("Sunday evening PT: Monday of this week 00:00 PT through 8 local midnights later", () => {
    const w = calendarWindow(new Date("2026-10-04T22:30:00-07:00"), TZ); // Sun Oct 4, 22:30 PT
    expect(w.start.toISOString()).toBe("2026-09-28T07:00:00.000Z"); // Mon Sep 28 00:00 PDT
    expect(w.end.toISOString()).toBe("2026-10-12T07:00:00.000Z"); // Mon Oct 12 00:00 PDT
  });

  it("uses the local date, not the UTC date (Monday 01:00 UTC is still Sunday in PT)", () => {
    const w = calendarWindow(new Date("2026-10-05T01:00:00Z"), TZ);
    expect(w.start.toISOString()).toBe("2026-09-28T07:00:00.000Z");
  });

  it("on a Monday the window starts that same day", () => {
    const w = calendarWindow(new Date("2026-10-05T09:00:00-07:00"), TZ);
    expect(w.start.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  });

  it("handles the DST change (end of PDT on Nov 1 2026)", () => {
    const w = calendarWindow(new Date("2026-10-30T12:00:00-07:00"), TZ); // Fri Oct 30
    expect(w.start.toISOString()).toBe("2026-10-26T07:00:00.000Z"); // Mon Oct 26 00:00 PDT
    expect(w.end.toISOString()).toBe("2026-11-07T08:00:00.000Z"); // Sat Nov 7 00:00 PST
  });

  it("works in another zone", () => {
    const w = calendarWindow(new Date("2026-10-04T22:30:00-07:00"), "Asia/Kolkata"); // Mon Oct 5 11:00 IST
    expect(w.start.toISOString()).toBe("2026-10-04T18:30:00.000Z"); // Mon Oct 5 00:00 IST
  });
});

describe("acceptedTakenBlocks", () => {
  const row = (id: string, starts_at: string | null, duration_min: string | null, title: string | null = `Ask ${id}`) => ({
    id,
    title,
    starts_at,
    duration_min,
  });

  it("builds [start, start + duration) blocks labelled with the ask title", () => {
    expect(acceptedTakenBlocks([row("a", "2026-10-08T18:00:00-07:00", "120")], "z")).toEqual([
      { start: "2026-10-09T01:00:00.000Z", end: "2026-10-09T03:00:00.000Z", label: "Ask a", kind: "accepted" },
    ]);
  });

  it("excludes the ask being decided, ignored ids and rows without a usable time", () => {
    const rows = [
      row("self", "2026-10-08T18:00:00-07:00", "60"),
      row("later", "2026-10-08T18:00:00-07:00", "60"),
      row("nodur", "2026-10-08T18:00:00-07:00", null),
      row("bad", "soon", "60"),
      row("zero", "2026-10-08T18:00:00-07:00", "0"),
      row("ok", "2026-10-08T18:00:00-07:00", "60", null),
    ];
    const out = acceptedTakenBlocks(rows, "self", new Set(["later"]));
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("something you already said yes to");
  });
});

describe("buildContext takenBlocks", () => {
  const parsed: ParsedAsk = {
    id: "ask_me",
    from: "x@example.com",
    subject: "s",
    kind: "meeting",
    title: "Me",
    tag: "coffee",
    startsAt: "2026-10-08T14:00:00-07:00",
    durationMin: 30,
    inPerson: false,
    containsInstructionsToAgent: false,
  };

  beforeEach(() => {
    h.state.queries = [];
    h.state.busyRows = [];
    h.state.acceptedRows = [];
  });

  it("excludes the ask itself (in SQL and again in JS) and labels calendar blocks 'your calendar'", async () => {
    h.state.acceptedRows = [
      { id: "ask_me", title: "Me", starts_at: "2026-10-08T14:00:00-07:00", duration_min: "30" },
      { id: "ask_other", title: "Coffee with Sam", starts_at: "2026-10-08T14:15:00-07:00", duration_min: "30" },
    ];
    h.state.busyRows = [{ start_at: new Date("2026-10-08T21:00:00Z"), end_at: new Date("2026-10-08T22:00:00Z"), source: "google" }];

    const ctx = await buildContext("ask_me", parsed, TZ);

    expect(ctx.takenBlocks).toEqual([
      { start: "2026-10-08T21:15:00.000Z", end: "2026-10-08T21:45:00.000Z", label: "Coffee with Sam", kind: "accepted" },
      { start: "2026-10-08T21:00:00.000Z", end: "2026-10-08T22:00:00.000Z", label: "your calendar", kind: "calendar" },
    ]);
    const acceptedQuery = h.state.queries.find((q) => q.text.includes("from asks a"));
    expect(acceptedQuery?.values).toContain("ask_me");
    expect(acceptedQuery?.text).toContain("'triaged', 'awaiting_approval', 'sent', 'ready', 'simulated'");
    expect(acceptedQuery?.text).not.toContain("'received'");
    expect(acceptedQuery?.text).toContain("'YES', 'WILDCARD'");
  });

  it("queries the calendar for the ask's day +/- 1 day", async () => {
    await buildContext("ask_me", parsed, TZ);
    const busyQuery = h.state.queries.find((q) => q.text.includes("from calendar_busy"));
    const [from, to] = busyQuery!.values as Date[];
    expect(from.toISOString()).toBe("2026-10-07T21:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-09T21:30:00.000Z");
  });

  it("skips ignored ids (re-decide pass) and omits takenBlocks when nothing is taken", async () => {
    h.state.acceptedRows = [{ id: "ask_later", title: "Later", starts_at: "2026-10-08T14:00:00-07:00", duration_min: "30" }];
    const ctx = await buildContext("ask_me", parsed, TZ, { ignoreAskIds: new Set(["ask_later"]) });
    expect(ctx.takenBlocks).toBeUndefined();
  });

  it("an ask without a start or duration runs no taken-time queries", async () => {
    const ctx = await buildContext("ask_me", { ...parsed, startsAt: undefined }, TZ);
    expect(ctx.takenBlocks).toBeUndefined();
    expect(h.state.queries).toEqual([]);
  });
});
