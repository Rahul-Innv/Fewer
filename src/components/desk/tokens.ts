import type { Verdict } from "@/core/contracts";

/**
 * Single source for verdict + surface colors (role-named). globals.css mirrors these
 * hex values inside `@theme`; tokens.test.ts recomputes WCAG contrast and checks drift.
 * Class strings are written out in full so Tailwind can see them.
 */
export const SURFACES = {
  paper: "#f6f4ef",
  surface: "#ffffff",
  ink: "#1b1f23",
  muted: "#566070",
  line: "#e4dfd5",
  lineStrong: "#cbc4b4",
  focus: "#2b59c3",
  action: "#1b1f23",
  actionInk: "#f6f4ef",
  warnBg: "#fff4d6",
  warnFg: "#6b4300",
} as const;

export type VerdictToken = {
  label: string;
  /** What the verdict means, in plain words (used as tooltip / sr text). */
  meaning: string;
  bg: string;
  fg: string;
  accent: string;
  /** Pastel chip (bg/fg). Kept for tinted surfaces such as the week ledger. */
  chip: string;
  /** Solid chip: white on accent. Survives compressed video where the pastel chip vanishes. */
  solid: string;
  bar: string;
  edge: string;
  text: string;
  /** The one-word verdict shown large on the card. */
  word: string;
};

export const VERDICTS: Record<Verdict, VerdictToken> = {
  YES: {
    label: "Yes",
    meaning: "Worth your time",
    bg: "#dcf2e3",
    fg: "#0b5a29",
    accent: "#15803d",
    chip: "bg-yes-bg text-yes-fg",
    solid: "bg-yes-accent text-white",
    bar: "bg-yes-accent",
    edge: "border-l-yes-accent",
    text: "text-yes-fg",
    word: "Yes.",
  },
  WILDCARD: {
    label: "Wildcard",
    meaning: "This week's one exploratory yes",
    bg: "#ebe3fb",
    fg: "#4a2a99",
    accent: "#6d28d9",
    chip: "bg-wildcard-bg text-wildcard-fg",
    solid: "bg-wildcard-accent text-white",
    bar: "bg-wildcard-accent",
    edge: "border-l-wildcard-accent",
    text: "text-wildcard-fg",
    word: "Wildcard.",
  },
  SMALLER: {
    label: "Shorter",
    meaning: "Yes to a smaller version",
    bg: "#fbe9c6",
    fg: "#774700",
    accent: "#b45309",
    chip: "bg-smaller-bg text-smaller-fg",
    solid: "bg-smaller-accent text-white",
    bar: "bg-smaller-accent",
    edge: "border-l-smaller-accent",
    text: "text-smaller-fg",
    word: "Shorter.",
  },
  ASK_ONE: {
    label: "One question",
    meaning: "One question before deciding",
    bg: "#dbe9fb",
    fg: "#0e3d8a",
    accent: "#1d4ed8",
    chip: "bg-askone-bg text-askone-fg",
    solid: "bg-askone-accent text-white",
    bar: "bg-askone-accent",
    edge: "border-l-askone-accent",
    text: "text-askone-fg",
    word: "One question.",
  },
  NO: {
    label: "No",
    meaning: "A kind no",
    bg: "#e6e9ed",
    fg: "#323c49",
    accent: "#475569",
    chip: "bg-no-bg text-no-fg",
    solid: "bg-no-accent text-white",
    bar: "bg-no-accent",
    edge: "border-l-no-accent",
    text: "text-no-fg",
    word: "No.",
  },
  BLOCKED: {
    label: "Blocked",
    meaning: "Quarantined, nothing sent",
    bg: "#fadcdc",
    fg: "#861414",
    accent: "#b91c1c",
    chip: "bg-blocked-bg text-blocked-fg",
    solid: "bg-blocked-accent text-white",
    bar: "bg-blocked-accent",
    edge: "border-l-blocked-accent",
    text: "text-blocked-fg",
    word: "Blocked.",
  },
};

export const VERDICT_ORDER: Verdict[] = ["YES", "WILDCARD", "SMALLER", "NO", "ASK_ONE", "BLOCKED"];

/** What each rule id means, shown beside "Rules decide". */
export const RULE_NAMES: Record<string, string> = {
  R0: "Quarantine: injection or blocked sender",
  R1: "Absolute boundary",
  R2: "Missing detail: ask one question",
  R3: "Top-two goal, claims verified",
  R4: "Big ask, offer a smaller one",
  R5: "One exploratory yes a week",
  R6: "No strong link to your goals",
};

/** Short, uppercase rule label for the card header: "R4" -> "BIG ASK" (the part of RULE_NAMES before the first comma or colon). */
export function ruleShortName(rule: string | null | undefined): string | null {
  const full = rule ? RULE_NAMES[rule] : null;
  if (!full) return null;
  return full.split(/[,:]/)[0].trim().toUpperCase();
}
