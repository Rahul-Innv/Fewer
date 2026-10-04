"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BellRing, ChevronRight, Hourglass, Mail } from "lucide-react";
import { ApprovalCard, type ApprovalState } from "@/components/assistant-ui/elements/approval-card";
import type { Verdict } from "@/core/contracts";
import type { ApproveResponse, DeclineResponse, PendingApprovalView } from "./types";
import { VerdictChip } from "./VerdictChip";
import { draftHasNoAddress } from "./stages";
import { clockTime, formatRemaining, plural } from "./format";
import { useCountdown } from "./useCountdown";

const RECEIPT_MS = 2500;
const RECEIPT_WARN_MS = 6000;
const COLLAPSE_MS = 240;

type ReceiptTone = "yes" | "no" | "warn";
type Receipt = { tone: ReceiptTone; text: string; holdMs: number };

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; action: "approve" | "hold" }
  | { kind: "receipt"; receipt: Receipt; leaving: boolean }
  | { kind: "dead"; text: string }
  | { kind: "gone" };

function expiredCopy(expiresAt: string | null, timeZone?: string): string {
  const at = expiresAt ? clockTime(expiresAt, timeZone) : "";
  return at ? `Code expired at ${at}. Nothing was sent.` : "Code expired. Nothing was sent.";
}

/**
 * The exact `reason` strings approveByCode (src/server/pipeline.ts) returns when it refuses,
 * mapped to what the person sees. Every one of these means the approval can no longer be used.
 */
function refusalCopy(reason: string, expiresAt: string | null, timeZone?: string): string | null {
  switch (reason) {
    case "no pending approval with that code":
      return "This code is no longer pending. Nothing was sent.";
    case "code expired":
      return expiredCopy(expiresAt, timeZone);
    case "drafts changed since approval":
      return "The drafts changed after this brief was made, so the code was withdrawn. Nothing was sent.";
    case "approval already used or expired":
      return "This code was already used or has expired. Nothing was sent from here.";
    default:
      return null;
  }
}

async function post<T extends { ok: boolean; error?: string }>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; data: Partial<T> & { error?: string } }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<T>;
    return { ok: res.ok && data.ok !== false, data };
  } catch {
    return { ok: false, data: { error: "Couldn't reach the Desk. Check the cards below before trying again." } as Partial<T> };
  }
}

/** Grid-rows collapse (1fr to 0fr) so height animates without measuring. Closed content is inert. */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      {/* overflow stays visible while open so the card shadow is not clipped */}
      <div className={`min-h-0 ${open ? "" : "overflow-hidden"}`} inert={!open}>
        {children}
      </div>
    </div>
  );
}

function PendingBrief({
  pending,
  live,
  approver,
  onChanged,
  timeZone,
  className,
  verdictByDraft,
  demo = false,
}: {
  pending: PendingApprovalView;
  verdictByDraft?: Record<string, Verdict | null | undefined>;
  /** Demo brief: approving simulates the send; nothing is emailed. */
  demo?: boolean;
  /** false once the server stopped listing this approval as pending (we keep showing our own receipt or refusal). */
  live: boolean;
  approver: string | null;
  onChanged: () => void;
  timeZone?: string;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const { remainingMs, fraction, expired } = useCountdown(pending.expiresAt, pending.createdAt);
  // Copy-only drafts (no email address) are not "replies waiting": list only what will be emailed.
  const emailable = pending.drafts.filter((d) => !draftHasNoAddress({ draft: d }));
  const listed = emailable.length > 0 ? emailable : pending.drafts;
  const n = listed.length;
  // Desk asks added without a sender email: approving marks them ready to copy; nothing is emailed.
  const copyOnly = pending.drafts.filter((d) => draftHasNoAddress({ draft: d })).length;

  // Latch the expiry while the server still lists the approval, so the notice survives the poll that drops it.
  if (phase.kind === "idle" && expired && live) {
    setPhase({ kind: "dead", text: expiredCopy(pending.expiresAt, timeZone) });
  }

  useEffect(() => {
    if (phase.kind !== "receipt") return;
    if (!phase.leaving) {
      const t = setTimeout(() => {
        setPhase({ kind: "receipt", receipt: phase.receipt, leaving: true });
        onChanged();
      }, phase.receipt.holdMs);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setPhase({ kind: "gone" }), COLLAPSE_MS + 40);
    return () => clearTimeout(t);
  }, [phase, onChanged]);

  if (phase.kind === "gone") return null;
  if (!live && phase.kind === "idle") return null;

  const busy = phase.kind === "busy" ? phase.action : null;
  const deadText = phase.kind === "dead" ? phase.text : null;
  const dead = deadText !== null;
  const receipt = phase.kind === "receipt" ? phase.receipt : null;
  const leaving = phase.kind === "receipt" && phase.leaving;
  const nothingToSend = n === 0;

  function showReceipt(r: Receipt) {
    setPhase({ kind: "receipt", receipt: r, leaving: false });
  }

  async function approve() {
    if (busy !== null || nothingToSend) return;
    setPhase({ kind: "busy", action: "approve" });
    setError(null);
    const { ok, data } = await post<ApproveResponse>("/api/approve", { code: pending.code });
    const time = clockTime(new Date().toISOString(), timeZone);
    const sent = typeof data.sent === "number" ? data.sent : null;

    if (ok) {
      // Demo brief, or the server reports simulated sends: say plainly that nothing was emailed.
      const simulatedN = typeof data.simulated === "number" ? data.simulated : demo && !(sent && sent > 0) ? n : 0;
      if (simulatedN > 0 && !(sent && sent > 0)) {
        const reason = typeof data.reason === "string" && data.reason.trim() ? data.reason.trim() : null;
        showReceipt({
          tone: "no",
          text: reason ?? `Demo: ${plural(simulatedN, "reply", "replies")} approved. Nobody else was emailed.`,
          holdMs: RECEIPT_MS,
        });
        return;
      }
      const what = sent === null ? "Approved" : sent > 0 ? `Sent ${plural(sent, "reply", "replies")}` : copyOnly > 0 ? "Approved" : "Nothing new sent";
      const copyNote = copyOnly > 0 ? ` · ${plural(copyOnly, "reply", "replies")} ready to copy, not sent` : "";
      showReceipt({ tone: "yes", text: `${what}${copyNote} · ${time} · code used`, holdMs: RECEIPT_MS });
      return;
    }

    const reason = typeof data.reason === "string" ? data.reason : "";
    const refusal = refusalCopy(reason, pending.expiresAt, timeZone);
    if (refusal) {
      setPhase({ kind: "dead", text: refusal });
      return;
    }

    // approveByCode claimed the code, then some sends failed: "sent N, M failed". The code is spent.
    const partial = /^sent (\d+), (\d+) failed$/.exec(reason);
    if (partial) {
      const done = Number(partial[1]);
      const failed = Number(partial[2]);
      showReceipt({
        tone: "warn",
        text: `Sent ${done} of ${plural(done + failed, "reply", "replies")} · ${failed} failed, see the cards below · code used`,
        holdMs: RECEIPT_WARN_MS,
      });
      return;
    }

    setPhase({ kind: "idle" });
    setError(typeof data.error === "string" ? data.error : reason || "Could not approve. Nothing was sent.");
  }

  async function hold() {
    if (busy !== null) return;
    setPhase({ kind: "busy", action: "hold" });
    setError(null);
    const { ok, data } = await post<DeclineResponse>("/api/decline", { approvalId: pending.id });
    if (ok) {
      showReceipt({ tone: "no", text: "Held · nothing sent", holdMs: RECEIPT_MS });
      return;
    }
    setPhase({ kind: "idle" });
    setError(typeof data.error === "string" ? data.error : "Could not hold the brief.");
  }

  function dismiss() {
    setPhase({ kind: "gone" });
    onChanged();
  }

  const state: ApprovalState = receipt ? (receipt.tone === "no" ? "denied" : "done") : busy ? "running" : "request";
  const closed = dead || receipt !== null;
  const timerText =
    remainingMs === null ? "No expiry" : dead && expired ? "Expired" : closed ? "Closed" : `${formatRemaining(remainingMs)} left`;
  const sendLabel = plural(n, "reply", "replies");

  return (
    <div className={className}>
      <Collapse open={!leaving}>
        <ApprovalCard
          state={state}
          variant={dead ? "inactive" : "default"}
          icon={<BellRing className="size-4" />}
          title={dead ? "This is no longer waiting for you" : `${demo ? "Demo: " : ""}${sendLabel} waiting for you`}
          subtitle={
            demo
              ? "Only your work inbox gets a copy."
              : "Nothing is sent until you approve."
          }
          allowOnceLabel={demo ? "Approve demo" : "Approve"}
          denyLabel="Hold"
          onAllowOnce={nothingToSend ? undefined : approve}
          onDeny={hold}
          statusLabel={
            receipt
              ? receipt.text
              : busy === "approve"
                ? demo
                  ? "Approving the demo…"
                  : `Sending ${sendLabel}…`
                : busy === "hold"
                  ? "Holding…"
                  : undefined
          }
          statusTone={receipt?.tone}
          className={
            dead
              ? "border-line-strong"
              : "border-ink/25 shadow-[0_10px_30px_-14px_rgba(27,31,35,0.35)]"
          }
          aside={
            <span
              role="timer"
              aria-live="off"
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium tabular-nums ${
                closed ? "bg-no-bg text-no-fg" : "border border-line-strong bg-paper text-ink"
              }`}
            >
              <Hourglass aria-hidden className="size-4" />
              {timerText}
            </span>
          }
          progress={
            fraction !== null ? (
              <div aria-hidden className="h-0.5 bg-line">
                <div
                  className="h-full bg-ink transition-[width] duration-1000 ease-linear"
                  style={{ width: `${(closed ? 0 : fraction) * 100}%` }}
                />
              </div>
            ) : null
          }
          footer={
            deadText !== null ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-paper px-3 py-2 text-[13px] text-muted">
                <p>{deadText}</p>
                <button
                  type="button"
                  onClick={dismiss}
                  className="font-medium text-ink underline underline-offset-2 transition-colors duration-100 hover:text-muted"
                >
                  Dismiss
                </button>
              </div>
            ) : undefined
          }
          footnote={
            closed ? null : (
              <>
                {nothingToSend ? (
                  <p className="text-[13px] text-muted">This brief has no drafts, so there is nothing to approve.</p>
                ) : null}
                <p role="status" aria-live="polite" className={error ? "text-[13px] text-blocked-fg" : "sr-only"}>
                  {error ?? ""}
                </p>
                <details className="group text-[12.5px] text-muted">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md pr-2 font-medium hover:text-ink">
                    <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
                    Approve by email
                  </summary>
                  <p className="pb-1 pl-[18px]">
                    Or reply <span className="font-mono text-ink">YES {pending.code}</span>
                    {approver ? (
                      <>
                        {" "}
                        from <span className="font-mono">{approver}</span>
                      </>
                    ) : null}
                    . The code works once.
                  </p>
                </details>
              </>
            )
          }
        >
          <div className="min-w-0">
            <p className="text-[12px] text-muted">Single-use code</p>
            <p
              className={`mt-1.5 break-all font-mono text-[30px] leading-none tracking-[0.22em] tabular-nums ${
                dead ? "text-muted line-through" : "text-ink"
              }`}
            >
              {pending.code}
            </p>
          </div>

          <ul className="divide-y divide-line border-y border-line" aria-label="Drafts in this brief">
            {listed.map((d) => (
              <li key={d.id} className="py-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                  {verdictByDraft?.[d.id] ? <VerdictChip verdict={verdictByDraft[d.id]!} /> : null}
                  <span className="font-medium text-ink">{d.askTitle}</span>
                  <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
                    <Mail aria-hidden className="size-3" />
                    {draftHasNoAddress({ draft: d }) ? "No email address: you copy it after your yes" : d.to}
                  </span>
                </p>
                <p className="mt-0.5 line-clamp-1 text-[13px] leading-snug text-muted">{d.body}</p>
              </li>
            ))}
          </ul>
          {emailable.length > 0 && copyOnly > 0 ? (
            <p className="text-[13px] text-muted">
              {plural(copyOnly, "reply", "replies")} ready to copy after you approve. They are not emailed.
            </p>
          ) : null}
        </ApprovalCard>
      </Collapse>
    </div>
  );
}

/**
 * Pending brief, rendered with the assistant-ui Approval card element in standalone mode
 * (we own the state). One container with the single-use code as the hero, a bar that drains
 * with the real expires_at, a count in the CTA, and a receipt after approve or hold.
 *
 * `pending` may become null while this is mounted (approved here or by email): the last
 * brief is kept so the receipt, refusal or expiry notice can finish before it leaves.
 * The code is only ever sent to POST /api/approve.
 */
export function ApprovalBanner({
  pending,
  approver,
  onChanged,
  timeZone,
  className,
  verdictByDraft,
  demo = false,
}: {
  pending: PendingApprovalView | null;
  /** The pending brief holds demo drafts only: CTA and receipt say nothing is emailed. */
  demo?: boolean;
  /** Draft id -> the verdict of the ask it answers (from /api/desk asks[].draft.id). Shown as a solid badge per draft. */
  verdictByDraft?: Record<string, Verdict | null | undefined>;
  approver: string | null;
  onChanged: () => void;
  /** IANA zone for the clock times in receipts and expiry notices; defaults to the browser's. */
  timeZone?: string;
  /** Outer wrapper classes, e.g. "mt-5". Only applied while something is showing. */
  className?: string;
}) {
  const [last, setLast] = useState<PendingApprovalView | null>(pending);
  if (pending && pending.id !== last?.id) setLast(pending);
  const shown = pending ?? last;
  if (!shown) return null;
  return (
    <PendingBrief
      key={shown.id}
      pending={shown}
      live={pending !== null}
      approver={approver}
      onChanged={onChanged}
      timeZone={timeZone}
      className={className}
      verdictByDraft={verdictByDraft}
      demo={demo || shown.demo === true}
    />
  );
}
