import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Decision, DecisionContext, Fit, ParsedAsk } from "../../core";

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

// In-memory stand-in for ../db: just enough SQL routing for what reorder.ts asks of it.
const h = vi.hoisted(() => {
  const s = {
    journeys: [] as JourneyRow[],
    asks: [] as AskRow[],
    decisions: new Map<string, StoredDecision>(),
    evidence: new Map<string, unknown[]>(),
    drafts: [] as { id: string; ask_id: string }[],
    approvals: [] as ApprovalRow[],
    transactions: 0,
    expireCalls: [] as string[],
  };

  const FINAL = new Set(["sent", "ready", "simulated", "blocked", "declined", "error"]);

  function run(text: string, values: unknown[]): unknown[] {
    if (/update journeys set rank/.test(text)) {
      const [rank, id] = values as [number, string];
      const j = s.journeys.find((x) => x.id === id);
      if (j) j.rank = rank;
      return [];
    }
    if (/from asks/.test(text)) {
      return s.asks.filter((a) => !FINAL.has(a.status) && a.parsed !== null);
    }
    if (/from evidence/.test(text)) {
      const claims = s.evidence.get(values[0] as string);
      return claims ? [{ claims }] : [];
    }
    if (/update approvals set status = 'expired'/.test(text)) {
      const askId = values[0] as string;
      s.expireCalls.push(askId);
      const draftIds = new Set(s.drafts.filter((d) => d.ask_id === askId).map((d) => d.id));
      const hit = s.approvals.filter((a) => a.status === "pending" && a.draft_ids.some((d) => draftIds.has(d)));
      for (const a of hit) a.status = "expired";
      return hit.map((a) => ({ id: a.id }));
    }
    throw new Error(`unexpected sql: ${text}`);
  }

  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(run(strings.join("?"), values));
  const sql = Object.assign(tagged, { begin: async <T>(cb: (tx: typeof tagged) => Promise<T>) => (s.transactions += 1, cb(tagged)) });

  const db = {
    sql,
    withDecisionLock: async <T>(fn: () => Promise<T>) => fn(),
    listJourneys: vi.fn(async () => [...s.journeys].sort((a, b) => a.rank - b.rank)),
    listBoundaries: vi.fn(async () => []),
    latestDecision: vi.fn(async (askId: string) => s.decisions.get(askId) ?? null),
    saveDecision: vi.fn(async (askId: string, decision: Decision, fits: Fit[]) => {
      s.decisions.set(askId, { id: "d", ask_id: askId, verdict: decision.verdict, rule: decision.rule, decision, fits });
    }),
    setAskStatus: vi.fn(async (askId: string, status: string) => {
      const a = s.asks.find((x) => x.id === askId);
      if (a) a.status = status;
    }),
    logEvent: vi.fn(async () => undefined),
  };
  const buildContext = vi.fn(
    async (): Promise<DecisionContext> => ({
      now: "2026-10-04T12:00:00-07:00",
      timeZone: "America/Los_Angeles",
      eveningsOutThisWeek: 0,
      wildcardUsedThisWeek: false,
      ratings: [],
    }),
  );
  return { s, db, buildContext };
});

vi.mock("../db", () => h.db);
vi.mock("../pipeline", () => ({ buildContext: h.buildContext }));

import { decide } from "../../core";
import { reorderJourneys, validateOrder } from "../reorder";

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

/** Adds an open ask whose stored decision is what decide() gave under the CURRENT ranks. */
function addAsk(id: string, fits: Fit[], status = "awaiting_approval", opts: { decided?: boolean } = {}): void {
  const parsed = meeting(id);
  s.asks.push({ id, subject: `Subject ${id}`, parsed, status });
  if (opts.decided === false) return;
  const journeys = [...s.journeys].sort((a, b) => a.rank - b.rank) as Parameters<typeof decide>[3];
  const d = decide(parsed, fits, [], journeys, [], ctx);
  s.decisions.set(id, { id: `dec_${id}`, ask_id: id, verdict: d.verdict, rule: d.rule, decision: d, fits });
  s.drafts.push({ id: `drf_${id}`, ask_id: id });
}

const fit = (journeyId: string, score: 0 | 1 | 2 | 3): Fit => ({ journeyId, score, reason: "test" });

beforeEach(() => {
  s.journeys = journeyRows(["j_a", "j_b", "j_c"]);
  s.asks = [];
  s.decisions = new Map();
  s.evidence = new Map();
  s.drafts = [];
  s.approvals = [];
  s.transactions = 0;
  s.expireCalls = [];
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
    expect(db.saveDecision).not.toHaveBeenCalled();
    expect(s.expireCalls).toEqual([]);
  });

  it("writes ranks 1..N in the given order inside one transaction", async () => {
    const r = await reorderJourneys(["j_c", "j_a", "j_b"]);
    expect(s.transactions).toBe(1);
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
    expect(s.approvals[0]?.status).toBe("expired");
    expect(s.asks[0]?.status).toBe("triaged");
    expect(db.saveDecision).toHaveBeenCalledTimes(1);
    expect(db.saveDecision.mock.calls[0]?.[1]).toMatchObject({ verdict: "YES", rule: "R3" });
    expect(db.saveDecision.mock.calls[0]?.[2]).toEqual([fit("j_c", 2)]);
    expect(db.logEvent).toHaveBeenCalledWith("redecided", "ask_1", { from: "NO", to: "YES", draftStale: true });
  });

  it("the reverse swap flips YES -> NO", async () => {
    s.journeys = journeyRows(["j_c", "j_a", "j_b"]);
    addAsk("ask_1", [fit("j_c", 2)]);
    expect(s.decisions.get("ask_1")?.verdict).toBe("YES");
    s.approvals.push({ id: "ap_1", status: "pending", draft_ids: ["drf_ask_1"] });

    const r = await reorderJourneys(["j_a", "j_b", "j_c"]);

    expect(r).toMatchObject({ ok: true, changed: [{ askId: "ask_1", from: "YES", to: "NO", rule: "R6" }] });
    expect(s.approvals[0]?.status).toBe("expired");
    expect(db.logEvent).toHaveBeenCalledWith("redecided", "ask_1", { from: "YES", to: "NO", draftStale: true });
  });

  it("leaves unchanged, final-status and not-yet-decided asks untouched; expires approvals for changed asks only", async () => {
    addAsk("ask_flip", [fit("j_c", 2)]); // NO -> YES
    addAsk("ask_same", [fit("j_a", 3)]); // YES before (rank 1) and after (rank 2)
    addAsk("ask_sent", [fit("j_c", 2)], "sent"); // final: never re-decided, even though it would flip
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
    expect(db.saveDecision).toHaveBeenCalledTimes(1);
    expect(db.setAskStatus).toHaveBeenCalledTimes(1);
    expect(db.setAskStatus).toHaveBeenCalledWith("ask_flip", "triaged");
    expect(db.logEvent).toHaveBeenCalledTimes(1);
    expect(s.asks.find((a) => a.id === "ask_same")?.status).toBe("awaiting_approval");
    expect(s.asks.find((a) => a.id === "ask_sent")?.status).toBe("sent");
    const contextFor = h.buildContext.mock.calls as unknown as unknown[][];
    expect(contextFor.map((c) => c[0])).toEqual(["ask_flip", "ask_same"]);
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
      addAsk("ask_ev", [fit("j_c", 2)]);
      s.asks[0]!.parsed = { ...meeting("ask_ev"), kind: "event" };
      if (withClaims) s.evidence.set("ask_ev", [verified]);
      const r = await reorderJourneys(["j_c", "j_a", "j_b"]);
      expect(r.ok && r.changed.length).toBe(withClaims ? 1 : 0);
    }
  });

  it("reports an ask whose re-decision throws and still processes the rest", async () => {
    addAsk("ask_bad", [fit("j_c", 2)]);
    addAsk("ask_flip", [fit("j_c", 2)]);
    h.buildContext.mockRejectedValueOnce(new Error("boom"));

    const r = await reorderJourneys(["j_c", "j_a", "j_b"]);

    expect(r).toMatchObject({ ok: true, failed: ["ask_bad"], changed: [{ askId: "ask_flip" }] });
    expect(db.saveDecision).toHaveBeenCalledTimes(1);
    expect(db.logEvent).toHaveBeenCalledWith("error", "ask_bad", { stage: "redecide", error: "boom" });
  });
});
