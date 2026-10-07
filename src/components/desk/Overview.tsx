"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, FlaskConical, Loader2, Play, Terminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumberRoll } from "@/components/ui/number-roll";
import type { Verdict } from "@/core/contracts";
import type { DeskData } from "./types";
import { VERDICTS } from "./tokens";
import { formatHours, formatRemaining } from "./format";
import { FLOW_STEPS, FLOW_STEP5_DEMO, demoStepFor } from "./stages";
import { useCountdown } from "./useCountdown";

const COUNT_ORDER: Verdict[] = ["NO", "SMALLER", "ASK_ONE", "YES", "WILDCARD", "BLOCKED"];

/** "DEMO · nothing is emailed": shown whenever the Desk holds demo asks. */
export function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.04em] text-action-ink">
      <FlaskConical aria-hidden className="size-3.5" />
      Demo · replies go to your work inbox only
    </span>
  );
}

type RunState = { kind: "idle" } | { kind: "busy" } | { kind: "hint" } | { kind: "note"; text: string; problem: boolean };
type RunProgress = { inserted: number; total: number; running: boolean };

async function readDemoProgress(): Promise<RunProgress | null> {
  try {
    const res = await fetch("/api/demo/run", { cache: "no-store" });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { inserted?: unknown; total?: unknown; running?: unknown };
    if (typeof d.inserted !== "number" || typeof d.total !== "number" || d.total <= 0) return null;
    // Only the server knows whether a run is going: 0 of 5 with no run is an empty demo, not a stuck one.
    return { inserted: d.inserted, total: d.total, running: d.running === true };
  } catch {
    return null;
  }
}

/**
 * Primary "Run demo" control. POSTs /api/demo/run (202 {total}); while the asks arrive one by one it polls
 * GET /api/demo/run every 1.5 s, shows "2 of 5 asks arrived" and stays disabled, then stops polling.
 * A 404 shows how to prepare the demo from the terminal instead of failing silently.
 */
export function RunDemoButton({ onRan }: { onRan: () => void }) {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [runId, setRunId] = useState(0);
  const seen = useRef(-1);
  const running = progress !== null && progress.running;

  // Poll only while a run is in progress (on load this also picks up a run that is already going).
  useEffect(() => {
    let stopped = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const p = await readDemoProgress();
      if (stopped) return;
      if (p && p.running) {
        setProgress(p);
        if (p.inserted !== seen.current) {
          seen.current = p.inserted;
          onRan();
        }
        t = setTimeout(tick, 1500);
      } else {
        if (seen.current >= 0) onRan();
        seen.current = -1;
        setProgress(null);
      }
    };
    t = setTimeout(tick, runId === 0 ? 0 : 1500);
    return () => {
      stopped = true;
      if (t) clearTimeout(t);
    };
  }, [runId, onRan]);

  useEffect(() => {
    if (state.kind !== "hint" && state.kind !== "note") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState({ kind: "idle" });
    };
    window.addEventListener("keydown", onKey);
    const t = state.kind === "note" ? setTimeout(() => setState({ kind: "idle" }), 6000) : undefined;
    return () => {
      window.removeEventListener("keydown", onKey);
      if (t) clearTimeout(t);
    };
  }, [state]);

  async function run() {
    if (running) return;
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/demo/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.status === 404 || res.status === 405) {
        setState({ kind: "hint" });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; total?: number; asks?: number };
      if (res.ok && data.ok !== false) {
        const total = typeof data.total === "number" ? data.total : typeof data.asks === "number" ? data.asks : 0;
        setState({ kind: "idle" });
        if (total > 0) {
          seen.current = 0;
          setProgress({ inserted: 0, total, running: true });
        }
        setRunId((n) => n + 1);
        onRan();
      } else {
        setState({ kind: "note", text: data.error ?? "Couldn't start the demo.", problem: true });
      }
    } catch {
      setState({ kind: "hint" });
    }
  }

  return (
    <div className="relative flex flex-wrap items-center justify-end gap-3">
      {running && progress ? (
        <span role="status" className="text-[14px] font-medium text-ink tabular-nums">
          {progress.inserted < progress.total ? `${progress.inserted} of ${progress.total} asks arrived` : "All arrived · deciding"}
        </span>
      ) : null}
      <button
        type="button"
        onClick={run}
        disabled={state.kind === "busy" || running}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-action px-4 text-[14px] font-semibold text-action-ink transition-transform duration-100 hover:bg-black active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100 motion-reduce:transition-none"
      >
        {state.kind === "busy" || running ? (
          <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Play aria-hidden className="size-4 fill-current" />
        )}
        Run demo
      </button>
      {state.kind === "hint" || state.kind === "note" ? (
        <div
          role="status"
          className="absolute right-0 top-full z-30 mt-2 w-[min(300px,calc(100vw-32px))] rounded-xl border border-line-strong bg-surface p-3 text-[13px] text-ink shadow-[0_12px_32px_-16px_rgba(27,31,35,0.45)]"
        >
          <div className="flex items-start gap-2">
            {state.kind === "hint" ? (
              <Terminal aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
            ) : state.problem ? (
              <X aria-hidden className="mt-0.5 size-4 shrink-0 text-blocked-fg" />
            ) : (
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-yes-fg" />
            )}
            <p className="min-w-0 flex-1">
              {state.kind === "hint" ? (
                <>
                  Run <code className="rounded bg-paper px-1 py-0.5 font-mono text-[12.5px]">npm run demo:prep</code> in the terminal.
                </>
              ) : (
                state.text
              )}
            </p>
            <button
              type="button"
              onClick={() => setState({ kind: "idle" })}
              aria-label="Close"
              className="-m-1 grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-paper hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The whole loop with the live step highlighted and a caption that explains it without narration. */
export function DemoSteps({ desk }: { desk: DeskData | null }) {
  const { step, caption, demo } = demoStepFor(desk);
  const labels = FLOW_STEPS.map((l, i) => (i === 4 && demo ? FLOW_STEP5_DEMO : l));
  return (
    <div className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5" aria-label="How Fewer works">
        {labels.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <li key={label} className="flex items-center gap-1.5" aria-current={active ? "step" : undefined}>
              <span
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[12.5px]",
                  active ? "bg-ink font-semibold text-action-ink" : done ? "bg-paper text-ink" : "bg-paper text-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[11px] font-bold tabular-nums",
                    active ? "bg-surface text-ink" : done ? "bg-ink text-action-ink" : "border border-line-strong text-muted",
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={3} /> : n}
                </span>
                <span className={cn(active ? "" : "hidden md:inline")}>{label}</span>
                <span className="sr-only">{done ? " (done)" : active ? " (now)" : ""}</span>
              </span>
              {n < labels.length ? <span aria-hidden className="hidden h-px w-2.5 bg-line-strong md:block" /> : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-1.5 text-[14px] font-medium text-ink" aria-live="polite">
        {caption}
      </p>
    </div>
  );
}

function Tile({
  label,
  children,
  sub,
  compact,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-paper/60 px-4 py-2">
        <div className="shrink-0 font-serif text-[28px] leading-none tracking-tight text-ink tabular-nums">{children}</div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
          {sub ? <div className="text-[12px] text-muted">{sub}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0 rounded-xl border border-line bg-paper/60 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
      <div className="mt-1 font-serif text-[40px] leading-none tracking-tight text-ink tabular-nums">{children}</div>
      {sub ? <div className="mt-1.5 min-h-[18px] text-[12.5px] text-muted">{sub}</div> : null}
    </div>
  );
}

function PendingSub({ pending }: { pending: NonNullable<DeskData["pending"]> }) {
  const { remainingMs } = useCountdown(pending.expiresAt, pending.createdAt);
  return (
    <span className="tabular-nums">
      Code <span className="font-mono font-semibold tracking-[0.12em] text-ink">{pending.code}</span>
      {remainingMs !== null ? ` · ${formatRemaining(remainingMs)} left` : ""}
    </span>
  );
}

/** Three big numbers, all straight from /api/desk. Nothing is estimated or invented here. */
export function StatTiles({
  desk,
  compact = false,
  filter = null,
  onFilter,
}: {
  desk: DeskData | null;
  compact?: boolean;
  filter?: Verdict | null;
  onFilter?: (v: Verdict | null) => void;
}) {
  if (!desk) {
    return (
      <div className="grid gap-3 sm:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-line bg-paper/60 px-4 py-3">
            <div className="skeleton-bar h-3 w-24 rounded-full bg-line" />
            <div className="skeleton-bar mt-2 h-9 w-16 rounded-lg bg-line" />
          </div>
        ))}
      </div>
    );
  }
  const counts = COUNT_ORDER.map((verdict) => ({ verdict, n: desk.asks.filter((a) => a.verdict === verdict).length })).filter(
    (c) => c.n > 0,
  );
  const pendingN = desk.pending?.drafts.length ?? 0;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile
        compact={compact}
        label="On the desk"
        sub={
          counts.length ? (
            <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
              {counts.map(({ verdict, n }) => (
                <button
                  key={verdict}
                  type="button"
                  aria-pressed={filter === verdict}
                  title={filter === verdict ? "Show all asks" : `Show only ${VERDICTS[verdict].label}`}
                  onClick={() => onFilter?.(filter === verdict ? null : verdict)}
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:bg-surface ${
                    filter === verdict ? "bg-surface ring-1 ring-ink" : ""
                  }`}
                >
                  <span aria-hidden className={`size-2 rounded-full ${VERDICTS[verdict].bar}`} />
                  <span className={`font-semibold ${VERDICTS[verdict].text}`}>{VERDICTS[verdict].label}</span>
                  <span className="tabular-nums">{n}</span>
                </button>
              ))}
            </span>
          ) : (
            "No asks yet"
          )
        }
      >
        <NumberRoll value={desk.asks.length} locales="en-US" />
        {compact ? null : <span className="ml-1.5 font-sans text-[15px] font-medium text-muted">{desk.asks.length === 1 ? "ask" : "asks"}</span>}
      </Tile>
      <Tile compact={compact} label="Waiting for you" sub={desk.pending ? <PendingSub pending={desk.pending} /> : "Nothing waiting"}>
        <NumberRoll value={pendingN} locales="en-US" />
        {compact ? null : <span className="ml-1.5 font-sans text-[15px] font-medium text-muted">{pendingN === 1 ? "reply" : "replies"}</span>}
      </Tile>
      <Tile compact={compact} label="Hours saved" sub="This week">
        <span className="sr-only">{formatHours(desk.ledger.hoursProtected)} hours</span>
        <NumberRoll aria-hidden value={desk.ledger.hoursProtected} format={{ maximumFractionDigits: 1 }} locales="en-US" />
        <span aria-hidden className="ml-1 font-sans text-[15px] font-medium text-muted">
          h
        </span>
      </Tile>
    </div>
  );
}

/** Inline inbox address with a copy button, for the overview header. */
export function InboxLine({ inbox }: { inbox: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!inbox) return null;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
      <span className="shrink-0">Email asks to</span>
      <span className="min-w-0 truncate font-mono text-ink select-all">{inbox}</span>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(inbox);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            /* selectable text anyway */
          }
        }}
        aria-label={copied ? "Address copied" : "Copy inbox address"}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-line hover:text-ink"
      >
        {copied ? <Check aria-hidden className="size-3.5 text-yes-fg" /> : <Copy aria-hidden className="size-3.5" />}
      </button>
    </p>
  );
}
