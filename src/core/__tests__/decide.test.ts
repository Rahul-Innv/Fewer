import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BoundarySchema,
  DecisionContextSchema,
  DecisionSchema,
  EvidenceClaimSchema,
  FitSchema,
  JourneySchema,
  ParsedAskSchema,
  type Boundary,
  type DecisionContext,
  type EvidenceClaim,
  type Fit,
  type Journey,
  type ParsedAsk,
} from "../contracts";
import { decide, overlapsTimeBlock, toLocalTime } from "../decide";

interface GoldenCase {
  name: string;
  ask: unknown;
  fits: unknown[];
  claims: unknown[];
  ctx?: Partial<DecisionContext>;
  expect: {
    verdict: string;
    rule: string;
    reasonIncludes?: string;
    questionIncludes?: string;
    smallerOfferIncludes?: string;
    pushesOut?: string;
    hours?: number;
  };
}

const golden = JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/asks.golden.json"), "utf8")) as {
  journeys: unknown[];
  boundaries: unknown[];
  baseContext: unknown;
  cases: GoldenCase[];
};

const journeys: Journey[] = golden.journeys.map((j) => JourneySchema.parse(j));
const boundaries: Boundary[] = golden.boundaries.map((b) => BoundarySchema.parse(b));
const baseCtx: DecisionContext = DecisionContextSchema.parse(golden.baseContext);

const VERIFIED_CLAIM: EvidenceClaim = {
  text: "Organizer confirmed",
  sources: [
    { domain: "lu.ma", url: "https://lu.ma/x", quote: "q", quoteFound: true, checkedAt: "2026-10-04T12:00:00-07:00" },
    { domain: "example.org", url: "https://example.org/x", quote: "q", quoteFound: true, checkedAt: "2026-10-04T12:00:00-07:00" },
  ],
};

function makeAsk(overrides: Partial<ParsedAsk> = {}): ParsedAsk {
  return {
    id: "t",
    from: "someone@example.com",
    subject: "Invite",
    kind: "event",
    title: "Test event",
    tag: "meetup",
    startsAt: "2026-10-08T13:00:00-07:00", // Thu 13:00 PT
    durationMin: 60,
    inPerson: false,
    containsInstructionsToAgent: false,
    ...overrides,
  };
}

function ctxWith(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return { ...baseCtx, ...overrides };
}

describe("golden fixture", () => {
  it("has a case for every rule R0-R6", () => {
    const rules = new Set(golden.cases.map((c) => c.expect.rule));
    for (const r of ["R0", "R1", "R2", "R3", "R4", "R5", "R6"]) expect(rules.has(r)).toBe(true);
  });

  for (const c of golden.cases) {
    it(`${c.expect.verdict}/${c.expect.rule}: ${c.name}`, () => {
      const ask = ParsedAskSchema.parse(c.ask);
      const fits: Fit[] = c.fits.map((f) => FitSchema.parse(f));
      const claims: EvidenceClaim[] = c.claims.map((cl) => EvidenceClaimSchema.parse(cl));
      const ctx = DecisionContextSchema.parse({ ...baseCtx, ...(c.ctx ?? {}) });

      const d = decide(ask, fits, claims, journeys, boundaries, ctx);

      expect(DecisionSchema.safeParse(d).success).toBe(true);
      expect({ verdict: d.verdict, rule: d.rule }).toEqual({ verdict: c.expect.verdict, rule: c.expect.rule });
      if (c.expect.reasonIncludes) expect(d.reasons.join(" | ")).toContain(c.expect.reasonIncludes);
      if (c.expect.questionIncludes) expect(d.question ?? "").toContain(c.expect.questionIncludes);
      if (c.expect.smallerOfferIncludes) expect(d.smallerOffer ?? "").toContain(c.expect.smallerOfferIncludes);
      if (c.expect.pushesOut) expect(d.cost.pushesOut).toBe(c.expect.pushesOut);
      if (c.expect.hours !== undefined) expect(d.cost.hours).toBe(c.expect.hours);
      if (d.verdict === "ASK_ONE") expect(d.question).toBeTruthy();
      if (d.verdict === "SMALLER") expect(d.smallerOffer).toBeTruthy();
    });
  }
});

describe("decide: rule paths", () => {
  it("R0 names both causes when injection and blocked sender co-occur", () => {
    const d = decide(
      makeAsk({ from: "spam@growthhacks.io", containsInstructionsToAgent: true }),
      [],
      [],
      journeys,
      boundaries,
      baseCtx,
    );
    expect(d.verdict).toBe("BLOCKED");
    expect(d.reasons).toHaveLength(2);
  });

  it("R0 beats R2: a blocked sender with missing times is still BLOCKED", () => {
    const d = decide(
      makeAsk({ from: "SPAM@growthhacks.io", startsAt: undefined, durationMin: undefined }),
      [],
      [],
      journeys,
      boundaries,
      baseCtx,
    );
    expect(d.rule).toBe("R0");
  });

  it("R2 asks for the date when both start and duration are missing", () => {
    const d = decide(makeAsk({ startsAt: undefined, durationMin: undefined }), [], [], journeys, boundaries, baseCtx);
    expect(d.verdict).toBe("ASK_ONE");
    expect(d.question).toContain("day and start time");
  });

  it("R2 does not apply to requests without times", () => {
    const d = decide(
      makeAsk({ kind: "request", startsAt: undefined, durationMin: undefined }),
      [],
      [],
      journeys,
      boundaries,
      baseCtx,
    );
    expect(d.rule).toBe("R6");
  });

  it("R1 SMALLER for a request over the absolute max_minutes offers email answers", () => {
    const d = decide(
      makeAsk({ kind: "request", startsAt: undefined, durationMin: 240 }),
      [{ journeyId: "j1", score: 1, reason: "founder advice" }],
      [],
      journeys,
      boundaries,
      baseCtx,
    );
    expect(d.verdict).toBe("SMALLER");
    expect(d.rule).toBe("R1");
    expect(d.smallerOffer).toBe("Offer to answer 3 questions by email instead");
    expect(d.reasons[0]).toContain("Nothing over 3 hours is absolute");
  });

  it("R1 conflict with zero effective fit is a NO even for a meeting", () => {
    const d = decide(
      makeAsk({ kind: "meeting", startsAt: "2026-10-06T10:00:00-07:00", durationMin: 30 }),
      [],
      [],
      journeys,
      boundaries,
      baseCtx,
    );
    expect(d.verdict).toBe("NO");
    expect(d.rule).toBe("R1");
  });

  it("non-absolute boundaries never trigger R1", () => {
    // Sat 08:00 overlaps the weekend-run *preference* block.
    const d = decide(
      makeAsk({ startsAt: "2026-10-10T08:00:00-07:00", durationMin: 60 }),
      [{ journeyId: "j1", score: 3, reason: "users" }],
      [VERIFIED_CLAIM],
      journeys,
      boundaries,
      baseCtx,
    );
    expect(d.verdict).toBe("YES");
    expect(d.reasons.join(" | ")).toContain("Weekend mornings are for long runs (preference)");
  });

  it("R3 requires a verified claim; strong fit without verification falls to R6", () => {
    const d = decide(makeAsk(), [{ journeyId: "j1", score: 3, reason: "users" }], [], journeys, boundaries, baseCtx);
    expect(d.verdict).toBe("NO");
    expect(d.rule).toBe("R6");
    expect(d.reasons[0]).toContain("none of its claims checked out");
  });

  it("R3 requires a rank 1 or 2 journey; rank-3 strong fit is a NO", () => {
    const d = decide(
      makeAsk(),
      [{ journeyId: "j3", score: 3, reason: "run club" }],
      [VERIFIED_CLAIM],
      journeys,
      boundaries,
      baseCtx,
    );
    expect(d.rule).toBe("R6");
    expect(d.reasons[0]).toContain("#3 goal");
  });

  it("R3 respects a non-absolute evening cap", () => {
    const softCap: Boundary[] = [
      { id: "soft", strength: "preference", label: "Prefer 1 evening out", rule: { type: "max_evenings_out_per_week", n: 1 } },
    ];
    const ask = makeAsk({ startsAt: "2026-10-08T18:30:00-07:00", inPerson: true });
    const fits: Fit[] = [{ journeyId: "j2", score: 3, reason: "x" }];
    expect(decide(ask, fits, [VERIFIED_CLAIM], journeys, softCap, ctxWith({ eveningsOutThisWeek: 0 })).verdict).toBe("YES");
    const full = decide(ask, fits, [VERIFIED_CLAIM], journeys, softCap, ctxWith({ eveningsOutThisWeek: 1 }));
    expect(full.verdict).toBe("NO");
    expect(full.reasons[0]).toContain("no evenings left");
  });

  it("R4 meeting over 90 min offers 30 minutes", () => {
    const d = decide(
      makeAsk({ kind: "meeting", durationMin: 120 }),
      [{ journeyId: "j1", score: 2, reason: "x" }],
      [],
      journeys,
      boundaries,
      baseCtx,
    );
    expect(d.rule).toBe("R4");
    expect(d.smallerOffer).toBe("Offer 30 minutes instead");
  });

  it("R5 is skipped once the wildcard is used, and needs a verified claim", () => {
    const fits: Fit[] = [{ journeyId: "j3", score: 1, reason: "x" }];
    expect(decide(makeAsk(), fits, [VERIFIED_CLAIM], journeys, boundaries, baseCtx).verdict).toBe("WILDCARD");
    const used = decide(makeAsk(), fits, [VERIFIED_CLAIM], journeys, boundaries, ctxWith({ wildcardUsedThisWeek: true }));
    expect(used.verdict).toBe("NO");
    expect(used.reasons).toContain("This week's exploratory yes is already used");
    expect(decide(makeAsk(), fits, [], journeys, boundaries, baseCtx).verdict).toBe("NO");
  });

  it("R6 sets pushesOut to the rank-1 journey title and cites it", () => {
    const d = decide(makeAsk(), [], [], journeys, boundaries, baseCtx);
    expect(d.cost.pushesOut).toBe("Ship Fewer to 100 users");
    expect(d.reasons).toContain("No link strong enough to your 3 goals");
    expect(d.reasons.join(" | ")).toContain("Ship Fewer to 100 users");
  });
});

describe("decide: learned dislike", () => {
  const ask = makeAsk({ tag: "panel" });
  const fits: Fit[] = [
    { journeyId: "j1", score: 0, reason: "none" },
    { journeyId: "j2", score: 2, reason: "agent talks" },
  ];

  it("without a dislike the same ask is a YES", () => {
    const d = decide(ask, fits, [VERIFIED_CLAIM], journeys, boundaries, ctxWith({ ratings: [] }));
    expect(d.verdict).toBe("YES");
    expect(d.effectiveFit.find((f) => f.journeyId === "j2")?.score).toBe(2);
  });

  it("a <=2 rating for the tag lowers every fit by 1 (floor 0) and cites the rating", () => {
    const d = decide(ask, fits, [VERIFIED_CLAIM], journeys, boundaries, baseCtx);
    expect(d.effectiveFit.find((f) => f.journeyId === "j2")?.score).toBe(1);
    expect(d.effectiveFit.find((f) => f.journeyId === "j1")?.score).toBe(0);
    expect(d.verdict).toBe("WILDCARD");
    expect(d.reasons).toContain("You rated a panel 2/5 on Oct 4");
  });

  it("a high rating for the tag changes nothing", () => {
    const d = decide(makeAsk({ tag: "meetup" }), fits, [VERIFIED_CLAIM], journeys, boundaries, baseCtx);
    expect(d.verdict).toBe("YES");
    expect(d.reasons.join(" | ")).not.toContain("You rated");
  });

  it("the adjustment also decides R1 SMALLER vs NO", () => {
    const meeting = makeAsk({ kind: "meeting", tag: "panel", startsAt: "2026-10-06T10:00:00-07:00", durationMin: 30 });
    const one: Fit[] = [{ journeyId: "j1", score: 1, reason: "x" }];
    expect(decide(meeting, one, [], journeys, boundaries, ctxWith({ ratings: [] })).verdict).toBe("SMALLER");
    expect(decide(meeting, one, [], journeys, boundaries, baseCtx).verdict).toBe("NO");
  });
});

describe("decide: time zones and overlap", () => {
  const block = { days: ["tue" as const], start: "09:00", end: "12:00" };

  it("converts UTC to the local weekday and minutes", () => {
    expect(toLocalTime("2026-10-06T17:00:00Z", "America/Los_Angeles")).toEqual({ weekday: "tue", dayIndex: 2, minutes: 600 });
    // Wed 02:30 UTC is still Tue 19:30 in Los Angeles.
    expect(toLocalTime("2026-10-07T02:30:00Z", "America/Los_Angeles")).toEqual({ weekday: "tue", dayIndex: 2, minutes: 1170 });
    expect(toLocalTime("2026-10-07T02:30:00Z", "UTC")?.weekday).toBe("wed");
    expect(toLocalTime("not a date", "UTC")).toBeNull();
  });

  it("Tue 10:00 America/Los_Angeles overlaps a tue 09:00-12:00 block", () => {
    const local = toLocalTime("2026-10-06T10:00:00-07:00", "America/Los_Angeles")!;
    expect(overlapsTimeBlock(local, 60, block)).toBe(true);
  });

  it("10:00 New York on Tue is 07:00 in LA and does not overlap", () => {
    const local = toLocalTime("2026-10-06T10:00:00-04:00", "America/Los_Angeles")!;
    expect(local.minutes).toBe(7 * 60);
    expect(overlapsTimeBlock(local, 60, block)).toBe(false);
    expect(overlapsTimeBlock(local, 121, block)).toBe(true); // runs to 09:01
  });

  it("ending exactly at the block start or starting at its end is not a conflict", () => {
    expect(overlapsTimeBlock({ weekday: "tue", dayIndex: 2, minutes: 8 * 60 }, 60, block)).toBe(false);
    expect(overlapsTimeBlock({ weekday: "tue", dayIndex: 2, minutes: 12 * 60 }, 60, block)).toBe(false);
  });

  it("wrong weekday does not conflict; spanning midnight into the block day does", () => {
    expect(overlapsTimeBlock({ weekday: "wed", dayIndex: 3, minutes: 600 }, 60, block)).toBe(false);
    const sunBlock = { days: ["sun" as const], start: "00:00", end: "02:00" };
    expect(overlapsTimeBlock({ weekday: "sat", dayIndex: 6, minutes: 23 * 60 }, 120, sunBlock)).toBe(true);
  });

  it("an overnight block (end <= start) is handled", () => {
    const night = { days: ["fri" as const], start: "22:00", end: "06:00" };
    expect(overlapsTimeBlock({ weekday: "sat", dayIndex: 6, minutes: 5 * 60 }, 30, night)).toBe(true);
    expect(overlapsTimeBlock({ weekday: "sat", dayIndex: 6, minutes: 7 * 60 }, 30, night)).toBe(false);
  });

  it("evening detection uses the owner's zone, not the offset in startsAt", () => {
    const fits: Fit[] = [{ journeyId: "j2", score: 3, reason: "x" }];
    const full = ctxWith({ eveningsOutThisWeek: 2 });
    // 20:00 New York = 17:00 LA -> evening for an LA owner; the absolute cap blocks it.
    const la = decide(makeAsk({ startsAt: "2026-10-08T20:00:00-04:00", inPerson: true }), fits, [VERIFIED_CLAIM], journeys, boundaries, full);
    expect(la.rule).toBe("R1");
    // 14:00 LA is daytime for an LA owner...
    const day = makeAsk({ startsAt: "2026-10-08T14:00:00-07:00", inPerson: true });
    expect(decide(day, fits, [VERIFIED_CLAIM], journeys, boundaries, full).verdict).toBe("YES");
    // ...but 17:00 for a New York owner, so the cap applies.
    const ny = decide(day, fits, [VERIFIED_CLAIM], journeys, boundaries, { ...full, timeZone: "America/New_York" });
    expect(ny.rule).toBe("R1");
  });
});

describe("decide: cost and fits", () => {
  it("cost.hours = duration/60 + 0.5 in person, rounded to 0.5", () => {
    expect(decide(makeAsk({ durationMin: 45 }), [], [], journeys, boundaries, baseCtx).cost.hours).toBe(1);
    expect(decide(makeAsk({ durationMin: 45, inPerson: true }), [], [], journeys, boundaries, baseCtx).cost.hours).toBe(1.5);
    expect(
      decide(makeAsk({ kind: "request", startsAt: undefined, durationMin: undefined }), [], [], journeys, boundaries, baseCtx)
        .cost.hours,
    ).toBe(1);
  });

  it("empty fits are treated as zero for every journey", () => {
    const d = decide(makeAsk(), [], [], journeys, boundaries, baseCtx);
    expect(d.effectiveFit.map((f) => f.score)).toEqual([0, 0, 0]);
    expect(d.effectiveFit.map((f) => f.journeyId)).toEqual(["j1", "j2", "j3"]);
  });

  it("is deterministic", () => {
    const run = () =>
      decide(makeAsk(), [{ journeyId: "j1", score: 2, reason: "x" }], [VERIFIED_CLAIM], journeys, boundaries, baseCtx);
    expect(run()).toEqual(run());
  });
});
