import { describe, expect, it } from "vitest";
import { STAGES, agentNow, draftHasNoAddress, isReadyToCopy, stagesFor } from "./stages";
import type { AskCardData, DeskData } from "./types";

const base = { verdict: null, status: "working", evidence: [], draft: null } as Pick<
  AskCardData,
  "verdict" | "status" | "evidence" | "draft"
>;
const draft = { id: "d", to: "a@b.c", kind: "reply", body: "x" };
const ev = [{ domain: "example.com", verified: true, claim: "c" }];

describe("stagesFor: derived only from verdict, status, evidence, draft", () => {
  it("a new ask with nothing yet is reading", () => {
    const m = stagesFor(base);
    expect(m.steps).toEqual(STAGES);
    expect(m.steps[m.activeIndex]).toBe("Reading");
    expect(m.tone).toBe("working");
  });
  it("evidence before a verdict means checking sources", () => {
    expect(stagesFor({ ...base, evidence: ev }).activeIndex).toBe(2);
  });
  it("a verdict while still working is drafting", () => {
    const m = stagesFor({ ...base, verdict: "NO" });
    expect(m.steps[m.activeIndex]).toBe("Drafted");
  });
  it("awaiting stops at 'Awaiting your yes'", () => {
    const m = stagesFor({ ...base, verdict: "SMALLER", status: "awaiting", draft });
    expect(m.steps[m.activeIndex]).toBe("Awaiting your yes");
    expect(m.tone).toBe("waiting");
  });
  it("sent completes every step", () => {
    const m = stagesFor({ ...base, verdict: "YES", status: "sent", draft });
    expect(m.activeIndex).toBe(m.steps.length);
  });
  it("held ends on Held, nothing sent", () => {
    const m = stagesFor({ ...base, verdict: "NO", status: "held", draft });
    expect(m.steps.at(-1)).toBe("Held");
    expect(m.activeIndex).toBe(m.steps.length);
  });
  it("blocked never shows a drafted or sent step", () => {
    const m = stagesFor({ ...base, verdict: "BLOCKED", status: "blocked" });
    expect(m.steps).not.toContain("Drafted");
    expect(m.steps).not.toContain("Sent");
  });
  it("error marks the step it stopped on as failed", () => {
    const m = stagesFor({ ...base, status: "error" });
    expect(m.tone).toBe("failed");
    expect(m.activeIndex).toBe(1);
  });
});

describe("agentNow: what Fewer is doing, from the payload", () => {
  const desk = (patch: Partial<DeskData>): DeskData =>
    ({ asks: [], pending: null, ...patch }) as unknown as DeskData;
  const ask = (patch: Partial<AskCardData>) => ({ ...base, receivedAt: "2026-10-04T20:00:00Z", ...patch }) as AskCardData;

  it("listening when nothing is in flight", () => {
    expect(agentNow(desk({}), false).label).toBe("Listening for asks");
  });
  it("reading counts asks with no verdict yet", () => {
    expect(agentNow(desk({ asks: [ask({}), ask({})] }), false).label).toBe("Reading 2 asks");
  });
  it("waiting for your yes when a brief is pending", () => {
    const pending = { id: "p", code: "X", expiresAt: null, createdAt: "2026-10-04T20:00:00Z", drafts: [] };
    const now = agentNow(desk({ pending, asks: [ask({ verdict: "NO", status: "awaiting" })] }), false);
    expect(now.label).toBe("Waiting for your yes");
    expect(now.state).toBe("waiting");
  });
  it("offline says reconnecting", () => {
    expect(agentNow(null, true).label).toBe("Reconnecting to the Desk");
  });
});

describe("ready to copy (Desk ask with no sender email, approved, nothing sent)", () => {
  const noAddr = { id: "d", to: "", kind: "reply", body: "Thanks, I can't make it." };
  it("a draft without an email address is copy-only", () => {
    expect(draftHasNoAddress({ draft: noAddr })).toBe(true);
    expect(draftHasNoAddress({ draft })).toBe(false);
  });
  it("a 'sent' card whose draft has no address is ready to copy, a real sent card is not", () => {
    expect(isReadyToCopy({ verdict: "YES", status: "sent", draft: noAddr, statusLabel: "Approved. Ready to copy; Fewer sent nothing." })).toBe(true);
    expect(isReadyToCopy({ verdict: "YES", status: "sent", draft, statusLabel: "Sent" })).toBe(false);
  });
    it("explicit status 'ready' is ready", () => {
    expect(isReadyToCopy({ verdict: "NO", status: "ready", draft: noAddr, statusLabel: "Ready" })).toBe(true);
  });
  it("today's read-model shape (working, verdict, no-address draft) is ready, but drafting is not", () => {
    expect(isReadyToCopy({ verdict: "NO", status: "working", draft: noAddr, statusLabel: "Reading the ask" })).toBe(true);
    expect(isReadyToCopy({ verdict: "NO", status: "working", draft: noAddr, statusLabel: "Drafting your brief" })).toBe(false);
    expect(isReadyToCopy({ verdict: "NO", status: "awaiting", draft: noAddr, statusLabel: "Awaiting your yes" })).toBe(false);
  });
  it("the rail ends on 'Ready to copy', all done, no 'Sent' step", () => {
    const m = stagesFor({ verdict: "SMALLER", status: "ready", evidence: [], draft: noAddr });
    expect(m.steps.at(-1)).toBe("Ready to copy");
    expect(m.steps).not.toContain("Sent");
    expect(m.activeIndex).toBe(m.steps.length);
  });
});
