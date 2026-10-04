"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, Loader2, Mail, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Verdict } from "@/core/contracts";
import type { JourneyView } from "./types";
import { VERDICTS } from "./tokens";
import { plural } from "./format";

/**
 * Does a route exist yet? A GET to a POST-only App Router route answers 405; a missing route answers 404.
 * Never POSTs, so probing can't send anything.
 */
export function useRouteReady(path: string): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = async () => {
      try {
        const res = await fetch(path, { method: "GET", cache: "no-store" });
        if (!stopped) setReady(res.status !== 404);
        if (!stopped && res.status === 404) timer = setTimeout(probe, 15_000);
      } catch {
        if (!stopped) timer = setTimeout(probe, 15_000);
      }
    };
    void probe();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [path]);
  return ready;
}

/** A passing message for outcomes (assistant-ui design-kit toast pattern): bottom center, fades, auto-dismisses. */
export function Toast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      {text ? (
        <p className="receipt-in pointer-events-auto flex max-w-[560px] items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[14px] font-medium text-action-ink shadow-[0_12px_32px_-12px_rgba(27,31,35,0.6)]">
          <Check aria-hidden className="size-4 shrink-0" />
          {text}
        </p>
      ) : null}
    </div>
  );
}

/** Error callout under a control: a reason from the server, shown as given. */
export function Callout({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2 text-[13px] text-warn-fg">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="-m-0.5 grid size-6 place-items-center rounded hover:bg-surface/60">
        <X aria-hidden className="size-3.5" />
      </button>
    </p>
  );
}

type PlanResponse = { ok?: boolean; sentTo?: string; going?: number; smaller?: number; askOne?: number; error?: string; reason?: string };

/** "Email me my plan": POST /api/plan/email {scope}. Disabled until the route exists. */
export function EmailPlanButton({
  scope,
  onToast,
  className,
  small = false,
}: {
  scope: "live" | "demo";
  onToast: (text: string) => void;
  className?: string;
  /** Tool-bar size (h-9). */
  small?: boolean;
}) {
  const ready = useRouteReady("/api/plan/email");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/plan/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = (await res.json().catch(() => ({}))) as PlanResponse;
      if (res.ok && data.ok !== false) {
        const n = (x: unknown) => (typeof x === "number" ? x : 0);
        const askOne = n(data.askOne);
        onToast(
          `Plan sent to ${data.sentTo || "your work inbox"}: ${n(data.going)} going, ${n(data.smaller)} shorter, ${askOne} need${askOne === 1 ? "s" : ""} an answer`,
        );
      } else {
        setProblem(data.error || data.reason || `Couldn't send the plan (${res.status}).`);
      }
    } catch {
      setProblem("Couldn't reach the Desk. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <button
        type="button"
        onClick={send}
        disabled={!ready || busy}
        title={ready ? undefined : "Coming in a moment"}
        aria-describedby={ready ? undefined : `plan-soon-${scope}`}
        className={`inline-flex items-center gap-2 rounded-xl border border-line-strong bg-surface font-semibold text-ink ${small ? "h-9 px-3 text-[13px]" : "h-11 px-4 text-[14px]"} transition-transform duration-100 hover:border-ink active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none`}
      >
        {busy ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <Mail aria-hidden className="size-4 text-muted" />}
        {scope === "demo" ? "Email demo plan" : "Email my plan"}
      </button>
      {!ready ? (
        <span id={`plan-soon-${scope}`} className="sr-only">
          Coming in a moment
        </span>
      ) : null}
      {problem ? <Callout text={problem} onClose={() => setProblem(null)} /> : null}
    </div>
  );
}

export type VerdictChange = { askId: string; from: Verdict | null; to: Verdict | null };

/**
 * The owner's goals as a ranked list with up/down buttons. Each press POSTs /api/journeys/order {ids}
 * and reports which verdicts changed. Disabled until the route exists.
 */
export function GoalOrder({
  journeys,
  onChanged,
  onToast,
  stacked = false,
}: {
  journeys: JourneyView[];
  onChanged: (changes: VerdictChange[]) => void;
  onToast: (text: string) => void;
  /** One goal per row (inside a sheet) instead of three across. */
  stacked?: boolean;
}) {
  const ready = useRouteReady("/api/journeys/order");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Optimistic order: chips move on click; one POST goes out 600 ms after the last click.
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const server = [...journeys].sort((a, b) => a.rank - b.rank);
  const byId = new Map(server.map((g) => [g.id, g]));
  const ordered =
    optimistic && optimistic.length === server.length && optimistic.every((id) => byId.has(id))
      ? optimistic.map((id) => byId.get(id)!)
      : server;

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ordered.length || busy) return;
    const ids = ordered.map((g) => g.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOptimistic(ids);
    setProblem(null);
    setWaiting(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setWaiting(false);
      void send(ids);
    }, 600);
  }

  async function send(ids: string[]) {
    setBusy(true);
    try {
      const res = await fetch("/api/journeys/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; changed?: VerdictChange[]; error?: string };
      if (res.ok && data.ok !== false) {
        const changed = Array.isArray(data.changed) ? data.changed : [];
        onChanged(changed);
        onToast(
          changed.length
            ? `Priorities updated: ${plural(changed.length, "verdict")} changed`
            : "Priorities updated: no verdicts changed",
        );
      } else {
        setOptimistic(null);
        setProblem(data.error || `Couldn't reorder the goals (${res.status}).`);
      }
    } catch {
      setOptimistic(null);
      setProblem("Couldn't reach the Desk. The order is unchanged.");
    } finally {
      setBusy(false);
    }
  }

  if (ordered.length === 0) return null;
  const btn =
    "grid size-7 place-items-center rounded-md border border-line-strong bg-surface text-ink transition-transform duration-100 hover:border-ink active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none";
  return (
    <section aria-label="Your goals, in priority order">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] text-muted">
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Your goals</span>
          Every ask is checked against these, in order.
        </p>
        {busy || waiting ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
            <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
            Re-checking your asks…
          </span>
        ) : null}
      </div>
      <ol className={cn("mt-2 grid gap-2", stacked ? "" : "md:grid-cols-3")}>
        {ordered.map((g, i) => (
          <li key={g.id} className="flex items-center gap-2 rounded-2xl border border-line bg-paper/70 px-2.5 py-2">
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-action-ink tabular-nums">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink">
              <span className="sr-only">Priority {i + 1}: </span>
              {g.title}
            </span>
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                className={btn}
                disabled={!ready || busy || i === 0}
                title={ready ? undefined : "Coming in a moment"}
                aria-label={`Move ${g.title} up`}
                onClick={() => move(i, -1)}
              >
                <ArrowUp aria-hidden className="size-3.5" />
              </button>
              <button
                type="button"
                className={btn}
                disabled={!ready || busy || i === ordered.length - 1}
                title={ready ? undefined : "Coming in a moment"}
                aria-label={`Move ${g.title} down`}
                onClick={() => move(i, 1)}
              >
                <ArrowDown aria-hidden className="size-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {problem ? (
        <div className="mt-2">
          <Callout text={problem} onClose={() => setProblem(null)} />
        </div>
      ) : null}
    </section>
  );
}

/** "No → Yes" shown on a card whose verdict just changed after a reorder. Stamps in once (fade under reduced motion). */
export function VerdictChangeBadge({ change }: { change: VerdictChange }) {
  const from = change.from ? VERDICTS[change.from] : null;
  const to = change.to ? VERDICTS[change.to] : null;
  return (
    <p className="verdict-word inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[12px] font-semibold text-action-ink" role="status">
      <span className="sr-only">Verdict changed: </span>
      {from ? from.word.replace(".", "") : "None"}
      <ArrowRight aria-hidden className="size-3.5" />
      <span className="sr-only">to</span>
      {to ? to.word.replace(".", "") : "None"}
    </p>
  );
}
