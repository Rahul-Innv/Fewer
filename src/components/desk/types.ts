import type { Verdict } from "@/core/contracts";

/** JSON shape of GET /api/desk. Type-only module: safe to import from client components. */

export type FitLine = {
  journeyId: string;
  title: string;
  rank: number | null;
  /** What the model suggested. */
  score: 0 | 1 | 2 | 3;
  /** What the rules used after learned dislikes (only set when it differs). */
  effective?: 0 | 1 | 2 | 3;
  reason: string;
};

export type EvidenceChipData = {
  domain: string;
  verified: boolean;
  claim: string;
};

export type DraftView = {
  id: string;
  to: string;
  kind: string;
  body: string;
};

/** "ready": approved, but the draft has no email address, so nothing was sent; the owner copies it from the Desk. */
/** "simulated": a demo ask was approved; Fewer shows what it would send and emails nothing. */
export type CardStatus = "awaiting" | "sent" | "ready" | "simulated" | "held" | "blocked" | "working" | "error";

export type OutcomeView = {
  rating: number;
  note: string | null;
  result: string | null;
  at: string;
};

export type AskCardData = {
  id: string;
  title: string;
  from: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  kind: string | null;
  tag: string | null;
  startsAt: string | null;
  durationMin: number | null;
  inPerson: boolean | null;
  verdict: Verdict | null;
  rule: string | null;
  reasons: string[];
  question: string | null;
  smallerOffer: string | null;
  costHours: number | null;
  pushesOut: string | null;
  fits: FitLine[];
  evidence: EvidenceChipData[];
  verifiedClaims: number;
  draft: DraftView | null;
  status: CardStatus;
  statusLabel: string;
  sentAt: string | null;
  checkinSent: boolean;
  outcome: OutcomeView | null;
  /** true for asks inserted by Run demo (nothing is ever emailed for them). Optional until the API sends it. */
  demo?: boolean;
  /** Latest action status when the API sends it (e.g. "sent", "ready", "simulated"). */
  actionStatus?: string | null;
};

export type JourneyView = { id: string; rank: number; title: string };
export type BoundaryView = { id: string; strength: string; label: string };

export type LedgerView = {
  yes: number;
  wildcard: number;
  smaller: number;
  no: number;
  askOne: number;
  blocked: number;
  hoursProtected: number;
};

export type PendingApprovalView = {
  id: string;
  code: string;
  expiresAt: string | null;
  createdAt: string;
  drafts: { id: string; to: string; kind: string; askTitle: string; body: string; demo?: boolean }[];
  /** true when every draft in the brief belongs to a demo ask. Optional until the API sends it. */
  demo?: boolean;
};

/**
 * JSON shape of POST /api/approve: approveByCode's result, or an API error body.
 * `reason` is one of approveByCode's exact strings (see refusalCopy in ApprovalBanner.tsx) or "sent N" / "sent N, M failed".
 */
export type ApproveResponse = { ok: boolean; reason?: string; sent?: number; simulated?: number; error?: string };

/** JSON shape of POST /api/decline. */
export type DeclineResponse = { ok: boolean; error?: string };

export type OutcomeRowView = {
  id: number;
  askTitle: string;
  tag: string | null;
  rating: number;
  result: string | null;
  note: string | null;
  at: string;
};

export type DeskData = {
  /** false when DATABASE_URL is missing. */
  configured: boolean;
  /** Friendly message when the DB could not be read. Never contains secrets. */
  error: string | null;
  now: string;
  inbox: string | null;
  approver: string | null;
  ownerName: string;
  timeZone: string;
  journeys: JourneyView[];
  boundaries: BoundaryView[];
  ledger: LedgerView;
  pending: PendingApprovalView | null;
  /** The newest pending DEMO approval (Run demo). Never mixed with live drafts. */
  pendingDemo?: PendingApprovalView | null;
  asks: AskCardData[];
  outcomes: OutcomeRowView[];
  /** Count of check-ins sent so far (the demo time-skip or real ones). */
  checkinsSent: number;
  /** Calendar busy blocks (times only, never titles) from Monday of this week through the next 7 days. */
  commitments?: { start: string; end: string; source: string }[];
};
