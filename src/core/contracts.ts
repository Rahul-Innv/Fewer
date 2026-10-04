import { z } from "zod";

/**
 * Contracts for Fewer's decision core.
 * "The model suggests, rules decide": the model only produces ParsedAsk, Fit[]
 * and EvidenceClaim[]; decide() turns them into a Decision deterministically.
 */

const HHMM = z
  .string()
  .regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, "expected HH:MM (24h)");

const IsoWithOffset = z.iso.datetime({ offset: true });

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const WeekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof WeekdaySchema>;

// ---------- Journeys (the owner's 3 goals) ----------

export const JourneyRankSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const JourneySchema = z.object({
  id: z.string().min(1),
  rank: JourneyRankSchema,
  title: z.string().min(1),
  keywords: z.array(z.string()),
});
export type Journey = z.infer<typeof JourneySchema>;

// ---------- Boundaries ----------

export const BoundaryStrengthSchema = z.enum(["absolute", "ask_first", "preference"]);
export type BoundaryStrength = z.infer<typeof BoundaryStrengthSchema>;

export const TimeBlockRuleSchema = z.object({
  type: z.literal("time_block"),
  days: z.array(WeekdaySchema).min(1),
  start: HHMM,
  end: HHMM,
});
export type TimeBlockRule = z.infer<typeof TimeBlockRuleSchema>;

export const BoundaryRuleSchema = z.discriminatedUnion("type", [
  TimeBlockRuleSchema,
  z.object({ type: z.literal("max_evenings_out_per_week"), n: z.number().int().min(0) }),
  z.object({ type: z.literal("blocked_sender"), email: z.string().min(3) }),
  z.object({ type: z.literal("max_minutes"), minutes: z.number().int().positive() }),
]);
export type BoundaryRule = z.infer<typeof BoundaryRuleSchema>;

export const BoundarySchema = z.object({
  id: z.string().min(1),
  strength: BoundaryStrengthSchema,
  label: z.string().min(1),
  rule: BoundaryRuleSchema,
});
export type Boundary = z.infer<typeof BoundarySchema>;

// ---------- Parsed ask (model-provided facts) ----------

export const AskKindSchema = z.enum(["event", "meeting", "request", "other"]);
export type AskKind = z.infer<typeof AskKindSchema>;

export const ParsedAskSchema = z.object({
  id: z.string().min(1),
  /** Sender email. A display-name form ("Name <a@b.c>") is tolerated; decide() normalizes it. */
  from: z.string().min(3),
  fromName: z.string().optional(),
  subject: z.string(),
  kind: AskKindSchema,
  title: z.string(),
  /** Short category, e.g. "panel", "coffee", "meetup", "party". Used for learned dislikes. */
  tag: z.string(),
  /** ISO 8601 with offset (or Z). */
  startsAt: IsoWithOffset.optional(),
  durationMin: z.number().positive().optional(),
  inPerson: z.boolean(),
  url: z.string().optional(),
  organizer: z.string().optional(),
  containsInstructionsToAgent: z.boolean(),
});
export type ParsedAsk = z.infer<typeof ParsedAskSchema>;

// ---------- Fit (model-provided score per journey) ----------

export const FitScoreSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type FitScore = z.infer<typeof FitScoreSchema>;

export const FitSchema = z.object({
  journeyId: z.string().min(1),
  score: FitScoreSchema,
  reason: z.string(),
});
export type Fit = z.infer<typeof FitSchema>;

// ---------- Evidence ----------

export const EvidenceSourceSchema = z.object({
  domain: z.string(),
  url: z.string(),
  quote: z.string(),
  quoteFound: z.boolean(),
  checkedAt: z.string(),
});
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const EvidenceClaimSchema = z.object({
  text: z.string(),
  sources: z.array(EvidenceSourceSchema),
});
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;

// ---------- Decision context ----------

export const RatingValueSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const RatingSchema = z.object({
  tag: z.string(),
  rating: RatingValueSchema,
  at: IsoWithOffset,
});
export type Rating = z.infer<typeof RatingSchema>;

/**
 * Time the owner has already given away: a busy block from their calendar (times only, never titles)
 * or an ask Fewer already accepted. An ask overlapping one clashes (rule R1).
 */
export const TakenBlockSchema = z.object({
  start: IsoWithOffset,
  end: IsoWithOffset,
  /** "your calendar" for calendar blocks; the accepted ask's title otherwise. */
  label: z.string(),
  kind: z.enum(["calendar", "accepted"]),
});
export type TakenBlock = z.infer<typeof TakenBlockSchema>;

export const DecisionContextSchema = z.object({
  now: IsoWithOffset,
  timeZone: z.string().refine(isValidTimeZone, "expected an IANA time zone, e.g. America/Los_Angeles"),
  eveningsOutThisWeek: z.number().int().min(0),
  wildcardUsedThisWeek: z.boolean(),
  ratings: z.array(RatingSchema),
  takenBlocks: z.array(TakenBlockSchema).optional(),
});
export type DecisionContext = z.infer<typeof DecisionContextSchema>;

// ---------- Decision (rules output) ----------

export const VerdictSchema = z.enum(["BLOCKED", "NO", "ASK_ONE", "YES", "SMALLER", "WILDCARD"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const RuleIdSchema = z.enum(["R0", "R1", "R2", "R3", "R4", "R5", "R6"]);
export type RuleId = z.infer<typeof RuleIdSchema>;

export const DecisionSchema = z.object({
  verdict: VerdictSchema,
  rule: RuleIdSchema,
  reasons: z.array(z.string()),
  question: z.string().optional(),
  smallerOffer: z.string().optional(),
  cost: z.object({
    hours: z.number(),
    pushesOut: z.string().optional(),
  }),
  verifiedClaims: z.number().int().min(0),
  effectiveFit: z.array(FitSchema),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ---------- Small shared helper (pure, no deps) ----------

/** "Rahul <R@X.com>" -> "r@x.com"; "  r@x.com " -> "r@x.com". */
export function normalizeEmail(input: string): string {
  const angled = /<([^<>]+)>/.exec(input);
  const raw = angled?.[1] ?? input;
  return raw.trim().replace(/^mailto:/i, "").toLowerCase();
}
