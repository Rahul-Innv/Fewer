import {
  normalizeEmail,
  type Boundary,
  type Decision,
  type DecisionContext,
  type EvidenceClaim,
  type Fit,
  type FitScore,
  type Journey,
  type ParsedAsk,
  type Rating,
  type RuleId,
  type TimeBlockRule,
  type Verdict,
  type Weekday,
} from "./contracts";
import { corroborate } from "./corroborate";

/**
 * decide(): the deterministic half of "the model suggests, rules decide".
 * First matching rule wins, after the learned-dislike adjustment:
 *   R0 BLOCKED -> R2 ASK_ONE -> R1 conflict (NO | SMALLER) -> R3 YES
 *   -> R4 SMALLER -> R5 WILDCARD -> R6 NO
 * Web corroboration (>= 1 verified claim) gates R3 and R5 for public events only.
 * A private meeting or request has no public listing to check, so it never needs one.
 */

const DAY_ORDER: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SHORT_WEEKDAY: Record<string, Weekday> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};
const MIN_PER_DAY = 24 * 60;
const MIN_PER_WEEK = 7 * MIN_PER_DAY;
const EVENING_START_MIN = 17 * 60;
const BIG_ASK_MIN = 90;
const DEFAULT_DURATION_MIN = 60;

export interface LocalTime {
  weekday: Weekday;
  /** 0 = Sunday ... 6 = Saturday */
  dayIndex: number;
  /** minutes since local midnight */
  minutes: number;
}

/** Convert an ISO instant to weekday + minutes-since-midnight in an IANA zone. No date libs. */
export function toLocalTime(iso: string, timeZone: string): LocalTime | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = SHORT_WEEKDAY[part("weekday")];
  if (!weekday) return null;
  let hour = Number(part("hour"));
  if (hour === 24) hour = 0; // some ICU builds emit 24 at midnight
  const minute = Number(part("minute"));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { weekday, dayIndex: DAY_ORDER.indexOf(weekday), minutes: hour * 60 + minute };
}

export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid HH:MM time: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Does [start, start + durationMin) overlap the block on any of its days?
 * Works on a week-long minute line and also checks the neighbouring weeks so
 * Saturday-night-into-Sunday and overnight blocks (end <= start) are handled.
 */
export function overlapsTimeBlock(
  local: LocalTime,
  durationMin: number,
  rule: Pick<TimeBlockRule, "days" | "start" | "end">,
): boolean {
  const askStart = local.dayIndex * MIN_PER_DAY + local.minutes;
  const askEnd = askStart + durationMin;
  const blockStart = hhmmToMinutes(rule.start);
  let blockEnd = hhmmToMinutes(rule.end);
  if (blockEnd <= blockStart) blockEnd += MIN_PER_DAY;
  for (const day of rule.days) {
    const base = DAY_ORDER.indexOf(day) * MIN_PER_DAY;
    for (const shift of [-MIN_PER_WEEK, 0, MIN_PER_WEEK]) {
      const bs = base + blockStart + shift;
      const be = base + blockEnd + shift;
      if (askStart < be && bs < askEnd) return true;
    }
  }
  return false;
}

type ConflictKind = "time_block" | "max_minutes" | "evenings";

interface Conflict {
  boundary: Boundary;
  kind: ConflictKind;
  /** detail appended after the label, e.g. "(this asks for 240 min)" */
  detail: string;
  limit?: number;
}

function findConflicts(
  ask: ParsedAsk,
  local: LocalTime | null,
  boundaries: Boundary[],
  ctx: DecisionContext,
): Conflict[] {
  const out: Conflict[] = [];
  for (const boundary of boundaries) {
    const rule = boundary.rule;
    if (rule.type === "time_block") {
      if (local && ask.durationMin != null && overlapsTimeBlock(local, ask.durationMin, rule)) {
        out.push({ boundary, kind: "time_block", detail: "" });
      }
    } else if (rule.type === "max_minutes") {
      if (ask.durationMin != null && ask.durationMin > rule.minutes) {
        out.push({
          boundary,
          kind: "max_minutes",
          detail: ` (this asks for ${ask.durationMin} min)`,
          limit: rule.minutes,
        });
      }
    } else if (rule.type === "max_evenings_out_per_week") {
      if (isInPersonEvening(ask, local) && ctx.eveningsOutThisWeek >= rule.n) {
        out.push({
          boundary,
          kind: "evenings",
          detail: ` (${ctx.eveningsOutThisWeek} evening${ctx.eveningsOutThisWeek === 1 ? "" : "s"} out already this week)`,
          limit: rule.n,
        });
      }
    }
  }
  return out;
}

function isInPersonEvening(ask: ParsedAsk, local: LocalTime | null): boolean {
  return ask.inPerson && local !== null && local.minutes >= EVENING_START_MIN;
}

function conflictReason(c: Conflict): string {
  if (c.boundary.strength === "absolute") return `${c.boundary.label} is absolute${c.detail}`;
  const strength = c.boundary.strength === "ask_first" ? "ask first" : "preference";
  return `Heads up: touches ${c.boundary.label} (${strength})${c.detail}`;
}

function sameTag(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Most recent rating <= 2 for this tag, if any. */
function findDislike(tag: string, ratings: Rating[]): Rating | null {
  const dislikes = ratings.filter((r) => r.rating <= 2 && sameTag(r.tag, tag));
  if (dislikes.length === 0) return null;
  return dislikes.reduce((latest, r) => (Date.parse(r.at) > Date.parse(latest.at) ? r : latest));
}

function formatMonthDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(date);
}

function roundToHalf(x: number): number {
  return Math.round(x * 2) / 2;
}

function clampScore(n: number): FitScore {
  return Math.max(0, Math.min(3, n)) as FitScore;
}

/** One fit per journey (missing -> 0), plus any stray fits; all reduced by `penalty` (floor 0). */
function buildEffectiveFit(fits: Fit[], journeys: Journey[], penalty: number): Fit[] {
  const journeyIds = new Set(journeys.map((j) => j.id));
  const base: Fit[] = journeys.map(
    (j) => fits.find((f) => f.journeyId === j.id) ?? { journeyId: j.id, score: 0, reason: "No fit provided" },
  );
  for (const f of fits) {
    if (!journeyIds.has(f.journeyId) && !base.some((b) => b.journeyId === f.journeyId)) base.push(f);
  }
  return base.map((f) => ({ journeyId: f.journeyId, score: clampScore(f.score - penalty), reason: f.reason }));
}

function bestFit(fits: Fit[], filter: (f: Fit) => boolean = () => true): Fit | null {
  let best: Fit | null = null;
  for (const f of fits) {
    if (!filter(f)) continue;
    if (!best || f.score > best.score) best = f;
  }
  return best;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function decide(
  ask: ParsedAsk,
  fits: Fit[],
  claims: EvidenceClaim[],
  journeys: Journey[],
  boundaries: Boundary[],
  ctx: DecisionContext,
): Decision {
  const tz = ctx.timeZone;
  const verified = corroborate(claims).verified;
  const hours = roundToHalf((ask.durationMin ?? DEFAULT_DURATION_MIN) / 60 + (ask.inPerson ? 0.5 : 0));

  // Learned dislike: applied before every rule.
  const dislike = findDislike(ask.tag, ctx.ratings);
  const effectiveFit = buildEffectiveFit(fits, journeys, dislike ? 1 : 0);
  const dislikeNote = dislike
    ? [`You rated a ${dislike.tag} ${dislike.rating}/5 on ${formatMonthDay(dislike.at, tz)}`]
    : [];

  const journeyById = new Map(journeys.map((j) => [j.id, j]));
  const titleOf = (f: Fit) => journeyById.get(f.journeyId)?.title ?? f.journeyId;
  const rankOf = (f: Fit) => journeyById.get(f.journeyId)?.rank;
  const fitLine = (f: Fit) => `Advances ${titleOf(f)} (fit ${f.score}/3)${f.reason ? `: ${f.reason}` : ""}`;
  const verifiedLine = () => `${plural(verified, "claim")} checked out on 2+ independent sites`;
  // Only public events can be corroborated on the web; a private coffee never can.
  const needsCorroboration = ask.kind === "event";
  const corroborated = !needsCorroboration || verified >= 1;
  // Non-events with nothing verified skip the line rather than print "0 claims checked out".
  const verifiedLines = () => (needsCorroboration || verified >= 1 ? [verifiedLine()] : []);

  const best = bestFit(effectiveFit);
  const maxFit = best?.score ?? 0;
  const bestTop2 = bestFit(effectiveFit, (f) => rankOf(f) === 1 || rankOf(f) === 2);

  const make = (
    verdict: Verdict,
    rule: RuleId,
    reasons: string[],
    extra: { question?: string; smallerOffer?: string; pushesOut?: string } = {},
  ): Decision => {
    const decision: Decision = {
      verdict,
      rule,
      reasons,
      cost: extra.pushesOut ? { hours, pushesOut: extra.pushesOut } : { hours },
      verifiedClaims: verified,
      effectiveFit,
    };
    if (extra.question) decision.question = extra.question;
    if (extra.smallerOffer) decision.smallerOffer = extra.smallerOffer;
    return decision;
  };

  // R0 BLOCKED: prompt injection or blocked sender.
  const blockedReasons: string[] = [];
  if (ask.containsInstructionsToAgent) {
    blockedReasons.push("The message contains instructions aimed at Fewer itself, so it is quarantined");
  }
  const sender = normalizeEmail(ask.from);
  for (const b of boundaries) {
    if (b.rule.type === "blocked_sender" && normalizeEmail(b.rule.email) === sender) {
      blockedReasons.push(`${b.label}: ${sender} is a blocked sender`);
    }
  }
  if (blockedReasons.length > 0) return make("BLOCKED", "R0", blockedReasons);

  // R2 ASK_ONE: timed asks need a start and a duration before conflicts can be computed.
  const local = ask.startsAt ? toLocalTime(ask.startsAt, tz) : null;
  if ((ask.kind === "event" || ask.kind === "meeting") && (!local || ask.durationMin == null)) {
    if (local) {
      return make("ASK_ONE", "R2", ["Missing how long it runs, so it can't be checked against your boundaries yet"], {
        question: `How long will "${ask.title}" run?`,
      });
    }
    return make("ASK_ONE", "R2", ["Missing the date and time, so it can't be checked against your boundaries yet"], {
      question: `What day and start time (with time zone) is "${ask.title}"?`,
    });
  }

  const conflicts = findConflicts(ask, local, boundaries, ctx);
  const hard = conflicts.filter((c) => c.boundary.strength === "absolute");
  const softNotes = conflicts.filter((c) => c.boundary.strength !== "absolute").map(conflictReason);

  // R1: absolute boundary conflict.
  if (hard.length > 0) {
    const hardReasons = hard.map(conflictReason);
    if (maxFit >= 1 && best && (ask.kind === "meeting" || ask.kind === "request")) {
      return make("SMALLER", "R1", [...hardReasons, `Still worth something: ${fitLine(best)}`, ...dislikeNote], {
        smallerOffer: smallerOfferForConflict(ask, hard),
      });
    }
    return make("NO", "R1", [...hardReasons, ...dislikeNote]);
  }

  // Evening capacity for non-absolute evening caps (absolute ones were handled by R1).
  const eveningCaps = boundaries.flatMap((b) =>
    b.rule.type === "max_evenings_out_per_week" ? [{ boundary: b, n: b.rule.n }] : [],
  );
  const isEvening = isInPersonEvening(ask, local);
  const eveningFull = isEvening && eveningCaps.some((c) => ctx.eveningsOutThisWeek >= c.n);

  // R3 YES.
  if (bestTop2 && bestTop2.score >= 2 && corroborated && !eveningFull) {
    const reasons = [fitLine(bestTop2), ...verifiedLines()];
    const cap = eveningCaps[0];
    if (isEvening && cap) reasons.push(`Uses evening ${ctx.eveningsOutThisWeek + 1} of ${cap.n} this week`);
    return make("YES", "R3", [...reasons, ...softNotes, ...dislikeNote]);
  }

  // R4 SMALLER: some link, but a big ask.
  if (maxFit >= 1 && best && ask.durationMin != null && ask.durationMin > BIG_ASK_MIN) {
    return make(
      "SMALLER",
      "R4",
      [`${ask.durationMin} min is a lot for a ${best.score}/3 link to ${titleOf(best)}`, ...softNotes, ...dislikeNote],
      { smallerOffer: smallerOfferForSize(ask) },
    );
  }

  // R5 WILDCARD: one exploratory yes per week.
  if (maxFit === 1 && best && corroborated && !ctx.wildcardUsedThisWeek) {
    return make("WILDCARD", "R5", [
      "One exploratory yes per week",
      `Light link to ${titleOf(best)} (fit 1/3)`,
      ...verifiedLines(),
      ...softNotes,
      ...dislikeNote,
    ]);
  }

  // R6 NO.
  const rank1 = journeys.find((j) => j.rank === 1);
  const reasons: string[] = [];
  if (bestTop2 && bestTop2.score >= 2 && needsCorroboration && verified === 0) {
    reasons.push(`Fits ${titleOf(bestTop2)}, but none of its claims checked out on 2+ independent sites`);
  } else if (bestTop2 && bestTop2.score >= 2 && eveningFull) {
    const cap = eveningCaps.find((c) => ctx.eveningsOutThisWeek >= c.n);
    reasons.push(`Fits ${titleOf(bestTop2)}, but no evenings left this week (${cap?.boundary.label ?? "evening cap"})`);
  } else if (best && maxFit >= 2) {
    reasons.push(`Only links to your #3 goal, ${titleOf(best)}; yeses go to your top two`);
  } else {
    reasons.push("No link strong enough to your 3 goals");
    if (maxFit === 1 && corroborated && ctx.wildcardUsedThisWeek) {
      reasons.push("This week's exploratory yes is already used");
    }
  }
  if (rank1) reasons.push(`It would push out ${hours}h from ${rank1.title}`);
  return make("NO", "R6", [...reasons, ...dislikeNote], rank1 ? { pushesOut: rank1.title } : {});
}

function smallerOfferForConflict(ask: ParsedAsk, hard: Conflict[]): string {
  if (ask.kind === "request") return "Offer to answer 3 questions by email instead";
  const limits = hard.filter((c) => c.kind === "max_minutes" && c.limit != null).map((c) => c.limit!);
  const minutes = Math.min(20, ...limits);
  if (hard.some((c) => c.kind === "time_block")) return `Offer ${minutes} minutes outside protected hours`;
  if (hard.some((c) => c.kind === "evenings")) return `Offer ${minutes} minutes during the day instead`;
  return `Offer ${minutes} minutes instead`;
}

function smallerOfferForSize(ask: ParsedAsk): string {
  switch (ask.kind) {
    case "meeting":
      return "Offer 30 minutes instead";
    case "request":
      return "Offer to answer 3 questions by email instead";
    default:
      return "Offer to join for the first 45 minutes";
  }
}
