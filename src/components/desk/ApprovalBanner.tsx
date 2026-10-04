"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BellRing, Check, Hourglass, Loader2, Mail, Pause, TriangleAlert } from "lucide-react";
import type { ApproveResponse, DeclineResponse, PendingApprovalView } from "./types";
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

const RECEIPT_STYLE: Record<ReceiptTone, { box: string; Icon: typeof Check }> = {
  yes: { box: "border-yes-accent/40 bg-yes-bg text-yes-fg", Icon: Check },
  no: { box: "border-no-accent/40 bg-no-bg text-no-fg", Icon: Pause },
  warn: { box: "border-smaller-accent/40 bg-warn-bg text-warn-fg", Icon: TriangleAlert },
};

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

function ReceiptRow({ receipt }: { receipt: Receipt }) {
  const { box, Icon } = RECEIPT_STYLE[receipt.tone];
  return (
    <p className={`flex items-center gap-2 rounded-2xl border px-5 py-3 text-[14px] font-medium ${box}`}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {receipt.text}
    </p>
  );
}

function ApprovalCard({
  pending,
  live,
  approver,
  onChanged,
  timeZone,
  className,
}: {
  pending: PendingApprovalView;
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
  const n = pending.drafts.length;

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
  const receiptOpen = phase.kind === "receipt" && !phase.leaving;
  const nothingToSend = n === 0;

  function showReceipt(r: Receipt) {
    setPhase({ kind: "receipt", receipt: r, leaving: false });
  }

  async function approve() {
    setPhase({ kind: "busy", action: "approve" });
    setError(null);
    const { ok, data } = await post<ApproveResponse>("/api/approve", { code: pending.code });
    const time = clockTime(new Date().toISOString(), timeZone);
    const sent = typeof data.sent === "number" ? data.sent : null;

    if (ok) {
      const what = sent === null ? "Approved" : sent > 0 ? `Sent ${plural(sent, "reply", "replies")}` : "Nothing new sent";
      showReceipt({ tone: "yes", text: `${what} · ${time} · code used`, holdMs: RECEIPT_MS });
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

  const btnBase =
    "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13.5px] transition duration-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

  return (
    <div className={className}>
      <div role="status" aria-live="polite">
        <Collapse open={receiptOpen}>{receipt ? <ReceiptRow receipt={receipt} /> : null}</Collapse>
      </div>

      <Collapse open={phase.kind !== "receipt"}>
        <section
          aria-labelledby="approval-h"
          className={`overflow-hidden rounded-2xl border bg-surface ${
            dead
              ? "border-line-strong"
              : "border-askone-accent/50 shadow-[0_8px_30px_-12px_color-mix(in_srgb,var(--color-askone-accent)_35%,transparent)]"
          }`}
        >
          <div
            className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${dead ? "bg-no-bg text-no-fg" : "bg-askone-bg text-askone-fg"}`}
          >
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full text-white ${
                dead ? "bg-no-accent" : "live-dot bg-askone-accent"
              }`}
            >
              <BellRing aria-hidden className="size-4" />
            </span>
            <h2 id="approval-h" className="text-[14.5px] font-semibold">
              {dead ? "This brief is no longer awaiting a yes" : "1 brief awaiting your yes"}
            </h2>
          </div>

          {fraction !== null ? (
            <div aria-hidden className="h-0.5 bg-line">
              <div
                className="h-full bg-askone-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${(dead ? 0 : fraction) * 100}%` }}
              />
            </div>
          ) : null}

          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
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
              <span
                role="timer"
                aria-live="off"
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium tabular-nums ${
                  dead ? "bg-no-bg text-no-fg" : "bg-askone-bg text-askone-fg"
                }`}
              >
                <Hourglass aria-hidden className="size-4" />
                {remainingMs === null
                  ? "No expiry"
                  : dead
                    ? expired
                      ? "Expired"
                      : "Closed"
                    : `${formatRemaining(remainingMs)} left`}
              </span>
            </div>

            <ul className="mt-4 divide-y divide-line border-y border-line">
              {pending.drafts.map((d) => (
                <li key={d.id} className="py-3">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                    <span className="font-medium text-ink">{d.askTitle}</span>
                    <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
                      <Mail aria-hidden className="size-3" />
                      {d.to}
                    </span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{d.body}</p>
                </li>
              ))}
            </ul>

            {deadText !== null ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-paper px-3 py-2 text-[13px] text-muted">
                <p>{deadText}</p>
                <button
                  type="button"
                  onClick={dismiss}
                  className="font-medium text-ink underline underline-offset-2 transition-colors duration-100 hover:text-muted"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[13px] text-ink">
                    Approving sends exactly these {n} {n === 1 ? "draft" : "drafts"}, once.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={hold}
                      disabled={busy !== null}
                      className={`${btnBase} border border-line-strong bg-surface font-medium text-ink hover:bg-paper`}
                    >
                      {busy === "hold" ? (
                        <Loader2 aria-hidden className="size-4 animate-spin" />
                      ) : (
                        <Pause aria-hidden className="size-4" />
                      )}
                      Hold
                    </button>
                    <button
                      type="button"
                      onClick={approve}
                      disabled={busy !== null || nothingToSend}
                      aria-describedby={nothingToSend ? "approval-why-disabled" : undefined}
                      className={`${btnBase} bg-action font-semibold text-action-ink hover:bg-black`}
                    >
                      {busy === "approve" ? (
                        <Loader2 aria-hidden className="size-4 animate-spin" />
                      ) : (
                        <Check aria-hidden className="size-4" />
                      )}
                      {busy === "approve"
                        ? `Sending ${plural(n, "reply", "replies")}…`
                        : `Approve & send ${plural(n, "reply", "replies")}`}
                    </button>
                  </div>
                </div>
                {nothingToSend ? (
                  <p id="approval-why-disabled" className="mt-2 text-[13px] text-muted">
                    This brief has no drafts, so there is nothing to approve.
                  </p>
                ) : null}
                <p
                  role="status"
                  aria-live="polite"
                  className={error ? "mt-2.5 text-[13px] text-blocked-fg" : "sr-only"}
                >
                  {error ?? ""}
                </p>
                <p className="mt-2.5 text-[12.5px] text-muted">
                  Or reply <span className="font-mono text-ink">YES {pending.code}</span>
                  {approver ? (
                    <>
                      {" "}
                      from <span className="font-mono">{approver}</span>
                    </>
                  ) : null}
                  . The code works once.
                </p>
              </>
            )}
          </div>
        </section>
      </Collapse>
    </div>
  );
}

/**
 * Pending brief: one container with the single-use code as the hero, a bar that drains
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
}: {
  pending: PendingApprovalView | null;
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
    <ApprovalCard
      key={shown.id}
      pending={shown}
      live={pending !== null}
      approver={approver}
      onChanged={onChanged}
      timeZone={timeZone}
      className={className}
    />
  );
}
