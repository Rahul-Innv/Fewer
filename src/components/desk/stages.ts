import type { AskCardData, DeskData } from "./types";
import { plural } from "./format";

/**
 * Where an ask is in Fewer's pipeline, derived ONLY from fields /api/desk already sends
 * (verdict, status, evidence, draft). No new API fields, no guessing beyond them.
 *
 * `activeIndex` follows the assistant-ui Agent plan convention: steps before it are done,
 * the step at it is in progress, and activeIndex === steps.length means all done.
 */
export type StageTone = "working" | "waiting" | "done" | "stopped" | "failed";

export type StageModel = {
  steps: string[];
  activeIndex: number;
  tone: StageTone;
  /** One line for screen readers and narrow screens. */
  current: string;
};

export const STAGES = ["Received", "Reading", "Checking sources", "Decided", "Drafted", "Awaiting your yes", "Sent"];

/** Same address test the pipeline uses before sending (src/server/pipeline.ts EMAIL_RE). */
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The draft has no address Fewer could send to (a Desk ask added without a sender email). */
export function draftHasNoAddress(card: Pick<AskCardData, "draft">): boolean {
  return card.draft !== null && !EMAIL_RE.test(card.draft.to.trim());
}

/**
 * Approved, nothing sent, the owner copies the reply. Only the persisted `status: "ready"` counts, plus a
 * "sent" card whose draft has no address (older rows). Never inferred from a working/awaiting card.
 */
export function isReadyToCopy(card: Pick<AskCardData, "verdict" | "status" | "draft" | "statusLabel">): boolean {
  if (card.status === "ready") return true;
  // The read-model may label an approved copy-only ask "sent"; a draft with no address is never emailed (pipeline.ts).
  // Only an approved row: a no-address draft still in triage or awaiting approval is NOT ready.
  return card.status === "sent" && draftHasNoAddress(card);
}

/** A demo ask whose approval was simulated: Fewer would send it, but nothing was emailed. Defensive about field names. */
export function isSimulated(card: Partial<Pick<AskCardData, "status" | "statusLabel" | "demo" | "actionStatus">>): boolean {
  if (card.status === "simulated" || card.actionStatus === "simulated") return true;
  if (card.statusLabel && /simulat|would send|not emailed/i.test(card.statusLabel)) return true;
  return card.demo === true && card.status === "sent";
}

export function stagesFor(
  card: Pick<AskCardData, "verdict" | "status" | "evidence" | "draft"> &
    Partial<Pick<AskCardData, "statusLabel" | "demo" | "actionStatus">>,
): StageModel {
  if (isSimulated(card)) {
    const steps = [...STAGES.slice(0, 5), "Approved", "Review copy (demo)"];
    return { steps, activeIndex: steps.length, tone: "stopped", current: card.statusLabel || "Would send · demo, not emailed" };
  }
  if (isReadyToCopy({ statusLabel: "", ...card })) {
    const steps = [...STAGES.slice(0, 5), "Approved", "Ready to copy"];
    return { steps, activeIndex: steps.length, tone: "done", current: "Approved. Ready to copy. Nothing was sent." };
  }
  if (card.verdict === "BLOCKED" || card.status === "blocked") {
    const steps = ["Received", "Reading", "Quarantined", "Nothing sent"];
    return { steps, activeIndex: steps.length, tone: "stopped", current: "Quarantined. Nothing sent." };
  }
  switch (card.status) {
    case "sent":
      return { steps: STAGES, activeIndex: STAGES.length, tone: "done", current: "Sent" };
    case "held": {
      const steps = [...STAGES.slice(0, 6), "Held"];
      return { steps, activeIndex: steps.length, tone: "stopped", current: "Held. Nothing sent." };
    }
    case "awaiting":
      return { steps: STAGES, activeIndex: 5, tone: "waiting", current: "Awaiting your yes" };
    case "error":
      return {
        steps: STAGES,
        activeIndex: card.verdict ? 4 : card.evidence.length > 0 ? 2 : 1,
        tone: "failed",
        current: "Couldn't finish this one. Nothing was sent.",
      };
    case "working":
    default:
      if (card.verdict) return { steps: STAGES, activeIndex: card.draft ? 5 : 4, tone: "working", current: "Drafting the reply" };
      if (card.evidence.length > 0) return { steps: STAGES, activeIndex: 2, tone: "working", current: "Checking sources" };
      return { steps: STAGES, activeIndex: 1, tone: "working", current: "Reading the ask" };
  }
}

/** Same states as the assistant-ui Agent status element. */
export type AgentNowState = "working" | "waiting" | "done" | "failed";
export type AgentNowModel = { state: AgentNowState; label: string; since: string | null };

/** What Fewer is doing right now, derived only from the /api/desk payload (and whether polling is failing). */
export function agentNow(desk: DeskData | null, offline: boolean): AgentNowModel {
  if (offline) return { state: "waiting", label: "Reconnecting to the Desk", since: null };
  if (!desk) return { state: "working", label: "Opening the Desk", since: null };
  const reading = desk.asks.filter((a) => !a.verdict && a.status === "working");
  if (reading.length > 0) {
    const oldest = reading.reduce((a, b) => (a.receivedAt < b.receivedAt ? a : b));
    return { state: "working", label: `Reading ${plural(reading.length, "ask")}`, since: oldest.receivedAt };
  }
  const drafting = desk.asks.filter((a) => a.verdict && a.status === "working" && !isReadyToCopy(a));
  if (drafting.length > 0) return { state: "working", label: `Drafting ${plural(drafting.length, "reply", "replies")}`, since: null };
  if (desk.pending) return { state: "waiting", label: "Waiting for your yes", since: desk.pending.createdAt };
  return { state: "working", label: "Listening for asks", since: null };
}

export type DemoStep = { step: 1 | 2 | 3 | 4 | 5 | 6; caption: string; demo: boolean };

/** The whole loop, shown at the top in both tabs. Goals come first: every ask is checked against them. */
export const FLOW_STEPS = ["Your goals", "Asks arrive", "Fewer decides", "You approve", "Replies", "Follow-up & learn"] as const;
export const FLOW_STEP5_DEMO = "Review copy to your inbox";

/** Where the Desk is in the loop, from /api/desk only. Drives the highlighted step and its caption. */
export function demoStepFor(desk: Pick<DeskData, "asks" | "pending" | "checkinsSent"> | null): DemoStep {
  const asks = desk?.asks ?? [];
  const demo = asks.some((a) => a.demo === true) || desk?.pending?.demo === true;
  const reading = asks.filter((a) => !a.verdict && a.status === "working").length;
  const pendingN = desk?.pending?.drafts.length ?? 0;
  const checkins = (desk?.checkinsSent ?? 0) > 0 || asks.some((a) => a.checkinSent);
  const simulated = asks.filter((a) => isSimulated(a)).length;
  const sent = asks.filter((a) => a.status === "sent" && !isSimulated(a)).length;
  const decided = asks.filter((a) => a.verdict).length;
  const of = (n: number, text: string) => `Step ${n} of 6: ${text}`;
  if (asks.length === 0) return { step: 2, caption: of(2, "waiting for asks."), demo };
  if (reading > 0) return { step: 2, caption: of(2, `reading ${plural(reading, "ask")}.`), demo };
  if (pendingN > 0) {
    const what = demo
      ? `approve the demo (${plural(pendingN, "reply", "replies")}). Only your work inbox gets a copy.`
      : `approve to send ${plural(pendingN, "reply", "replies")}.`;
    return { step: 4, caption: of(4, what), demo };
  }
  if (checkins) return { step: 6, caption: of(6, "Fewer asks how each yes went."), demo };
  if (simulated > 0)
    return {
      step: 5,
      caption: of(5, `${plural(simulated, "reply", "replies")} approved. Only your work inbox got a copy. Nobody else was emailed.`),
      demo,
    };
  if (sent > 0) return { step: 5, caption: of(5, `${plural(sent, "reply", "replies")} sent.`), demo };
  if (decided > 0) return { step: 3, caption: of(3, `Fewer decided ${plural(decided, "ask")}.`), demo };
  return { step: 2, caption: of(2, "asks arrive."), demo };
}
