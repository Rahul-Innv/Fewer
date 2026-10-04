import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Boundary, Decision, DecisionContext, Fit, ParsedAsk } from "../../core";

interface JourneyRow {
  id: string;
  rank: number;
  title: string;
  keywords: string[];
}
interface AskRow {
  id: string;
  subject: string | null;
  parsed: ParsedAsk | null;
  status: string;
}
interface StoredDecision {
  id: string;
  ask_id: string;
  verdict: Decision["verdict"];
  rule: string;
  decision: Decision;
  fits: Fit[] | null;
}
interface ApprovalRow {
  id: string;
  status: "pending" | "approved" | "declined" | "expired";
  draft_ids: string[];
}

// In-memory stand-in for ../db: just enough SQL routing for the batched pass in reorder.ts.
const h = vi.hoisted(() => {
  const s = {
    journeys: [] as JourneyRow[],
    boundaries: [] as Boundary[],
    asks: [] as AskRow[],
    decisions: new Map<string, StoredDecision>(),
    evidence: new Map<string, unknown[]>(),
    drafts: [] as { id: string; ask_id: string }[],
    approvals: [] as ApprovalRow[],
    events: [] as { ask_id: string; detail: Record<string, unknown> }[],
    transactions: 0,
    expireCalls: [] as string[],
    failOpenAsksQuery: false,
  };

  const FINAL = new Set(["sent", "ready", "simulated", "blocked", "declined", "error"]);
  const APPROVED = new Set(["sent", "ready", "simulated"]);

  function run(text: string, values: unknown[]): unknown[] {
    if (/update journeys set rank/.test(text)) {
      const [rank, id] = values as [number, string];
      const j = s.journeys.find((x) => x.id === id);
      if (j) j.rank = rank;
      return [];
    }
    if (/left join lateral/.test(text)) {
      if (s.failOpenAsksQuery) throw new Error("db down");
      return s.asks
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => !FINAL.has(a.status) && a.parsed !== null)
        .map(({ a, i }) => {
          const d = s.decisions.get(a.id);
          return { ...a, received_at: new Date(i * 1000), verdict: d?.verdict ?? null, decision: d?.decision ?? null, fits: d?.fits ?? null };
        });
    }
    if (/from evidence e/.test(text)) return [...s.evidence].map(([ask_id, claims]) => ({ ask_id, claims }));
    if (/where a\.status in \('sent', 'ready', 'simulated'\)/.test(text)) {
      return s.asks
        .filter((a) => APPROVED.has(a.status) && ["YES", "WILDCARD"].includes(s.decisions.get(a.id)?.verdict ?? ""))
        .map((a) => ({ id: a.id, title: a.parsed?.title ?? "", parsed: a.parsed, received_at: new Date(0), verdict: s.decisions.get(a.id)!.verdict }));
    }
    if (/from calendar_busy/.test(text)) return [];
    if (/update approvals set status = 'expired'/.test(text)) {
      const ids = JSON.parse(values[0] as string) as string[];
      s.expireCalls.push(...ids);
      const draftIds = new Set(s.drafts.filter((d) => ids.includes(d.ask_id)).map((d) => d.id));
      for (const a of s.approvals) if (a.status === "pending" && a.draft_ids.some((d) => draftIds.has(d))) a.status = "expired";
      return [];
    }
    if (/update asks/.test(text)) {
      const [blocked, ids] = values.map((v) => JSON.parse(v as string) as string[]) as [string[], string[]];
      for (const a of s.asks) if (ids.includes(a.id)) a.status = blocked.includes(a.id) ? "blocked" : "triaged";
      return [];
    }
    if (/insert into decisions/.test(text)) {
      for (const r of JSON.parse(values[0] as string) as { ask_id: string; verdict: Decision["verdict"]; rule: string; decision: Decision; fits: Fit[] }[]) {
        s.decisions.set(r.ask_id, { id: "d", ask_id: r.ask_id, verdict: r.verdict, rule: r.rule, decision: r.decision, fits: r.fits });
      }
      return [];
    }
    if (/insert into events_log/.test(text)) {
      s.events.push(...(JSON.parse(values[0] as string) as { ask_id: string; detail: Record<string, unknown> }[]));
      return [];
    }
    throw new Error(`unexpected sql: ${text}`);
  }

  // sql`...` runs a query; sql(array) is the postgres.js list helper (returns a marker here).
  const tagged = (strings: TemplateStringsArray | readonly string[], ...values: unknown[]) => {
    if (!("raw" in strings)) return { helper: strings } as unknown as Promise<unknown[]>;
    try {
      return Promise.resolve(run(strings.join("?"), values));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  const sql = Object.assign(tagged, { begin: async <T>(cb: (tx: typeof tagged) => Promise<T>) => (s.transactions += 1, cb(tagged)) });

  const db = {
    sql,
    withDecisionLock: async <T>(fn: () => Promise<T>) => fn(),
    listJourneys: vi.fn(async () => [...s.journeys].sort((a, b) => a.rank - b.rank)),
    listBoundaries: vi.fn(async () => s.boundaries),
    listRatings: vi.fn(async () => []),
    logEvent: vi.fn(async () => undefined),
  };
  return { s, db };
});

vi.mock("../db", () => h.db);
// pipeline.ts is imported for its pure week/evening helpers; stub its IO-bound imports.
vi.mock("../llm", () => ({}));
vi.mock("../mail", () => ({}));
vi.mock("../research", () => ({}));

import { decide } from "../../core";
import { redecideAll, reorderJourneys, validateOrder } from "../reorder";

const { s, db } = h;

const journeyRows = (order: string[]): JourneyRow[] =>
  order.map((id, i) => ({ id, rank: i + 1, title: `Goal ${id.toUpperCase()}`, keywords: [] }));

function meeting(id: string): ParsedAsk {
  return {
    id,
    from: "someone@example.com",
    subject: `Subject ${id}`,
    kind: "meeting",
    title: `Ask ${id}`,
    tag: "coffee",
    startsAt: "2026-10-08T13:00:00-07:00",
    durationMin: 30,
    inPerson: false,
    containsInstructionsToAgent: false,
  };
}

const ctx: DecisionContext = {
  now: "2026-10-04T12:00:00-07:00",
  timeZone: "America/Los_Angeles",
  eveningsOutThisWeek: 0,
  wildcardUsedThisWeek: false,
  ratings: [],
};

/** Adds an open ask whose stored decision is what decide() gave under the CURRENT ranks (no taken time). */
function addAsk(
  id: string,
  fits: Fit[],
  status = "awaiting_approval",
  opts: { decided?: boolean; parsed?: Partial<ParsedAsk> } = {},
): void {
  const parsed = { ...meeting(id), ...opts.parsed };
  s.asks.push({ id, subject: `Subject ${id}`, parsed, status });
  if (opts.decided === false) return;
  const journeys = [...s.journeys].sort((a, b) => a.rank - b.rank) as Parameters<typeof decide>[3];
  const d = decide(parsed, fits, [], journeys, s.boundaries, ctx);
  s.decisions.set(id, { id: `dec_${id}`, ask_id: id, verdict: d.verdict, rule: d.rule, decision: d, fits });
  s.drafts.push({ id: `drf_${id}`, ask_id: id });
}

const fit = (journeyId: string, score: 0 | 1 | 2 | 3): Fit => ({ journeyId, score, reason: "test" });

beforeEach(() => {
  s.journeys = journeyRows(["j_a", "j_b", "j_c"]);
  s.boundaries = [];
  s.asks = [];
  s.decisions = new Map();
  s.evidence = new Map();
  s.drafts = [];
  s.approvals = [];
  s.events = [];
  s.transactions = 0;
  s.expireCalls = [];
  s.failOpenAsksQuery = false;
  vi.clearAllMocks();
});

describe("validateOrder", () => {
  const current = ["j_a", "j_b", "j_c"];
  it("accepts any permutation of the current ids", () => {
    expect(validateOrder(["j_c", "j_a", "j_b"], current)).toEqual({ ok: true, ids: ["j_c", "j_a", "j_b"] });
    expect(validateOrder(["j_a", "j_b", "j_c"], current).ok).toBe(true);
  });
  it("rejects anything that is not exactly the current set, once each", () => {
    for (const bad of [
      undefined,
      "j_a,j_b,j_c",
      { 0: "j_a" },
      ["j_a", "j_b"],
      ["j_a", "j_b", "j_c", "j_d"],
      ["j_a", "j_a", "j_b"],
      ["j_a", "j_b", "j_x"],
      ["j_a", "j_b", 3],
      ["j_a", "j_b", ""],
    ]) {
      expect(validateOrder(bad, current).ok).toBe(false);
    }
  });
});

describe("reorderJourneys", () => {
  it("rejects an invalid order without touching ranks, asks or approvals", async () => {
    addAsk("ask_1", [fit("j_c", 2)]);
    const r = await reorderJourneys(["j_a", "j_b"]);
    expect(r.ok).toBe(false);
    expect(s.transactions).toBe(0);
    expect(s.journeys.map((j) => j.rank)).toEqual([1, 2, 3]);
    expect(s.events).toEqual([]);
    expect(s.expireCalls).toEqual([]);
  });

  it("writes ranks 1..N in the given order inside one transaction, and reports ms", async () => {
    const r = await reorderJourneys(["j_c", "j_a", "j_b"]);
    expect(s.transactions).toBe(1); // ranks only: nothing changed, so no write transaction
    expect(r).toMatchObject({
      ok: true,
      order: [
        { id: "j_c", rank: 1, title: "Goal J_C" },
        { id: "j_a", rank: 2, title: "Goal J_A" },
        { id: "j_b", rank: 3, title: "Goal J_B" },
      ],
      changed: [],
      unchanged: 0,
    });
    expect(r.ok && typeof r.ms === "number" && r.ms >= 0).toBe(true);
  });

  it("a fit-2 ask on the old #3 goal flips NO -> YES when that goal becomes #1, and expires its pending approval", async () => {
    addAsk("ask_1", [fit("j_c", 2)]);
    expect(s.decisions.get("ask_1")?.verdict).toBe("NO");
    s.approvals.push({ id: "ap_1", status: "pending", draft_ids: ["drf_ask_1"] });

    const r = await reorderJourneys(["j_c", "j_a", "j_b"]);

    expect(r).toMatchObject({
      ok: true,
      changed: [{ askId: "ask_1", title: "Ask ask_1", from: "NO", to: "YES", rule: "R3" }],
      unchanged: 0,
    });
    expect(s.transactions).toBe(2); // ranks + ONE write transaction for all changes
    expect(s.approvals[0]?.status).toBe("expired");
    expect(s.asks[0]?.status).toBe("triaged");
    expect(s.decisions.get("ask_1")).toMatchObject({ verdict: "YES", rule: "R3", fits: [fit("j_c", 2)] });
    expect(s.events).toEqual([{ ask_id: "ask_1", detail: { from: "NO", to: "YES", draftStale: true } }]);
  });

  it("the reverse swap flips YES -> NO", async () => {
    s.journeys = journeyRows(["j_c", "j_a", "j_b"]);
    addAsk("ask_1", [fit("j_c", 2)]);
    expect(s.decisions.get("ask_1")?.verdict).toBe("YES");
    s.approvals.push({ id: "ap_1", status: "pending", draft_ids: ["drf_ask_1"] });

    const r = await reorderJourneys(["j_a", "j_b", "j_c"]);

    expect(r).toMatchObject({ ok: true, changed: [{ askId: "ask_1", from: "YES", to: "NO", rule: "R6" }] });
    expect(s.approvals[0]?.status).toBe("expired");
    expect(s.events).toEqual([{ ask_id: "ask_1", detail: { from: "YES", to: "NO", draftStale: true } }]);
  });

  it("leaves unchanged, final-status and not-yet-decided asks untouched; expires approvals for changed asks only", async () => {
    // Different slots, so no ask clashes with another here.
    addAsk("ask_flip", [fit("j_c", 2)], "awaiting_approval", { parsed: { startsAt: "2026-10-08T15:00:00-07:00" } }); // NO -> YES
    addAsk("ask_same", [fit("j_a", 3)]); // YES before (rank 1) and after (rank 2)
    addAsk("ask_sent", [fit("j_c", 2)], "sent", { parsed: { startsAt: "2026-10-09T13:00:00-07:00" } }); // final: never re-decided
    addAsk("ask_new", [fit("j_c", 2)], "received", { decided: false }); // triage has not decided it yet
    s.approvals.push(
      { id: "ap_flip", status: "pending", draft_ids: ["drf_ask_flip"] },
      { id: "ap_same", status: "pending", draft_ids: ["drf_ask_same"] },
      { id: "ap_sent", status: "approved", draft_ids: ["drf_ask_sent"] },
    );

    const r = await reorderJourneys(["j_c", "j_a", "j_b"]);

    expect(r).toMatchObject({
      ok: true,
      changed: [{ askId: "ask_flip", from: "NO", to: "YES" }],
      unchanged: 1,
      skipped: 1,
      failed: [],
    });
    expect(s.expireCalls).toEqual(["ask_flip"]);
    expect(Object.fromEntries(s.approvals.map((a) => [a.id, a.status]))).toEqual({
      ap_flip: "expired",
      ap_same: "pending",
      ap_sent: "approved",
    });
    expect(s.asks.find((a) => a.id === "ask_same")?.status).toBe("awaiting_approval");
    expect(s.asks.find((a) => a.id === "ask_sent")?.status).toBe("sent");
    expect(s.decisions.get("ask_sent")?.verdict).toBe("NO"); // untouched
  });

  it("two asks in one slot: walked best first, so the better ask keeps the slot and the other clashes (R1)", async () => {
    addAsk("ask_low", [fit("j_a", 2)]); // YES now (j_a is #1); stays fit 2
    addAsk("ask_high", [fit("j_c", 3)]); // NO now (j_c is #3); becomes YES when j_c is #1
    expect(s.decisions.get("ask_low")?.verdict).toBe("YES");
    expect(s.decisions.get("ask_high")?.verdict).toBe("NO");

    const r = await reorderJourneys(["j_c", "j_a", "j_b"]);

    expect(r).toMatchObject({
      ok: true,
      changed: [
        { askId: "ask_high", from: "NO", to: "YES", rule: "R3" },
        { askId: "ask_low", from: "YES", to: "SMALLER", rule: "R1" },
      ],
    });
    expect(s.decisions.get("ask_low")?.decision.reasons[0]).toBe("Clashes with Ask ask_high at 1:00 PM Thu");
    expect(s.decisions.get("ask_low")?.decision.smallerOffer).toBe("Offer another time that week");
  });

  it("an already-approved (sent) YES holds its slot even against a better open ask", async () => {
    addAsk("ask_sent", [fit("j_a", 2)], "sent");
    addAsk("ask_open", [fit("j_a", 3)]); // YES when decided alone
    expect(s.decisions.get("ask_open")?.verdict).toBe("YES");
    const r = await redecideAll();
    expect(r.changed).toEqual([{ askId: "ask_open", title: "Ask ask_open", from: "YES", to: "SMALLER", rule: "R1" }]);
    expect(s.decisions.get("ask_open")?.decision.reasons[0]).toBe("Clashes with Ask ask_sent at 1:00 PM Thu");
  });

  it("evening caps are counted in memory from yeses earlier in the pass (best first)", async () => {
    s.boundaries = [{ id: "b_ev", strength: "absolute", label: "Max 1 evening out", rule: { type: "max_evenings_out_per_week", n: 1 } }];
    const evening = (startsAt: string): Partial<ParsedAsk> => ({ startsAt, inPerson: true, durationMin: 60 });
    addAsk("ev_low", [fit("j_a", 2)], "awaiting_approval", { parsed: evening("2026-10-06T19:00:00-07:00") }); // YES alone
    addAsk("ev_high", [fit("j_a", 3)], "awaiting_approval", { parsed: evening("2026-10-08T19:00:00-07:00") }); // YES alone
    const r = await redecideAll();
    expect(r.changed).toEqual([{ askId: "ev_low", title: "Ask ev_low", from: "YES", to: "SMALLER", rule: "R1" }]); // a meeting over an absolute cap
    expect(s.decisions.get("ev_high")?.verdict).toBe("YES");
  });

  it("re-decides with the stored evidence claims", async () => {
    // A public event needs a corroborated claim for YES (R3). With stored verified claims it flips; without, it stays NO.
    const verified = {
      text: "Organizer confirmed",
      sources: [
        { domain: "lu.ma", url: "https://lu.ma/x", quote: "q", quoteFound: true, checkedAt: "2026-10-04T12:00:00-07:00" },
        { domain: "example.org", url: "https://example.org/x", quote: "q", quoteFound: true, checkedAt: "2026-10-04T12:00:00-07:00" },
      ],
    };
    for (const withClaims of [true, false]) {
      s.journeys = journeyRows(["j_a", "j_b", "j_c"]);
      s.asks = [];
      s.decisions = new Map();
      s.drafts = [];
      s.evidence = new Map();
      addAsk("ask_ev", [fit("j_c", 2)], "awaiting_approval", { parsed: { kind: "event" } });
      if (withClaims) s.evidence.set("ask_ev", [verified]);
      const r = await reorderJourneys(["j_c", "j_a", "j_b"]);
      expect(r.ok && r.changed.length).toBe(withClaims ? 1 : 0);
    }
  });

  it("a failed read writes nothing", async () => {
    addAsk("ask_flip", [fit("j_c", 2)]);
    s.failOpenAsksQuery = true;
    await expect(redecideAll()).rejects.toThrow("db down");
    expect(s.events).toEqual([]);
    expect(s.decisions.get("ask_flip")?.verdict).toBe("NO");
  });
});

describe("redecideAll", () => {
  it("keeps the current ranks: of two overlapping YES asks the higher fit stays YES, the other clashes", async () => {
    addAsk("ask_two", [fit("j_a", 2)]); // YES (rank 1, fit 2)
    addAsk("ask_three", [fit("j_a", 3)]); // YES (rank 1, fit 3), same slot
    const r = await redecideAll();
    expect(r).toMatchObject({
      ok: true,
      changed: [{ askId: "ask_two", from: "YES", to: "SMALLER", rule: "R1" }],
      unchanged: 1,
    });
    expect(s.transactions).toBe(1); // the single write transaction; ranks untouched
    expect(s.journeys.map((j) => j.rank)).toEqual([1, 2, 3]);
    expect(s.decisions.get("ask_three")?.verdict).toBe("YES");
    expect(s.asks.find((a) => a.id === "ask_two")?.status).toBe("triaged");
    expect(db.logEvent).not.toHaveBeenCalled();
  });

  it("is a no-op write when nothing changed", async () => {
    addAsk("ask_one", [fit("j_a", 3)]);
    const r = await redecideAll();
    expect(r).toMatchObject({ ok: true, changed: [], unchanged: 1 });
    expect(s.transactions).toBe(0);
  });
});
