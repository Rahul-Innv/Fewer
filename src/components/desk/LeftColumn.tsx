"use client";

import { Anchor, Compass, Gauge, ShieldCheck, Star } from "lucide-react";
import type { Verdict } from "@/core/contracts";
import type { BoundaryView, JourneyView, LedgerView, OutcomeRowView } from "./types";
import { VERDICTS } from "./tokens";
import { formatHours, relativeTime } from "./format";
import { NumberRoll } from "@/components/ui/number-roll";

const STRENGTH: Record<string, { label: string; cls: string }> = {
  absolute: { label: "Absolute", cls: "bg-ink text-action-ink" },
  ask_first: { label: "Ask first", cls: "bg-warn-bg text-warn-fg" },
  preference: { label: "Preference", cls: "border border-line-strong bg-surface text-muted" },
};

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
      <span aria-hidden className="text-muted">
        {icon}
      </span>
      {children}
    </h3>
  );
}

/** Hours protected (assistant-ui Number Roll) and verdict counts. `ledger` is null until /api/desk answers: skeleton, never a placeholder 0. */
export function WeekLedger({ ledger: maybe }: { ledger: LedgerView | null }) {
  const ledger = maybe ?? { yes: 0, wildcard: 0, smaller: 0, no: 0, askOne: 0, blocked: 0, hoursProtected: 0 };
  const loading = maybe === null;
  const cells: { key: string; verdict: Verdict; count: number; note?: string }[] = [
    { key: "yes", verdict: "YES", count: ledger.yes + ledger.wildcard, note: ledger.wildcard ? `incl. ${ledger.wildcard} wildcard` : undefined },
    { key: "smaller", verdict: "SMALLER", count: ledger.smaller },
    { key: "no", verdict: "NO", count: ledger.no },
    { key: "ask", verdict: "ASK_ONE", count: ledger.askOne },
    { key: "blocked", verdict: "BLOCKED", count: ledger.blocked },
  ];
  return (
    <section aria-label="Week ledger" className="rounded-xl border border-line bg-surface p-4">
      <SectionTitle icon={<Gauge className="size-3.5" />}>Week ledger</SectionTitle>
      {loading ? (
        <div aria-hidden className="skeleton-bar h-11 w-24 rounded-lg bg-line" />
      ) : (
        <p className="font-serif text-[44px] leading-none tracking-tight text-ink tabular">
          <span className="sr-only">{formatHours(ledger.hoursProtected)} hours</span>
          <NumberRoll aria-hidden value={ledger.hoursProtected} format={{ maximumFractionDigits: 1 }} locales="en-US" />
          <span aria-hidden className="ml-1 font-sans text-base font-medium text-muted">
            h
          </span>
        </p>
      )}
      <p className="mt-1 text-[13px] text-muted">Hours protected this week</p>
      <ul className="mt-4 grid grid-cols-5 gap-1.5" aria-label="Verdicts this week">
        {cells.map((c) => {
          const v = VERDICTS[c.verdict];
          return (
            <li
              key={c.key}
              title={c.note}
              className={`flex flex-col items-center rounded-lg px-1 py-2 ${c.count > 0 ? v.chip : "bg-paper text-muted"}`}
            >
              <span className="text-lg font-semibold leading-none tabular">{loading ? "–" : c.count}</span>
              <span className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.06em]">{v.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function JourneysPanel({ journeys }: { journeys: JourneyView[] }) {
  return (
    <section aria-label="Journeys" className="rounded-xl border border-line bg-surface p-4">
      <SectionTitle icon={<Compass className="size-3.5" />}>Your 3 journeys</SectionTitle>
      {journeys.length === 0 ? (
        <p className="text-[13px] text-muted">Journeys appear here once the database is seeded.</p>
      ) : (
        <ol className="space-y-2">
          {journeys.map((j) => (
            <li key={j.id} className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold text-action-ink tabular"
              >
                {j.rank}
              </span>
              <span className="text-[14px] leading-snug text-ink">
                <span className="sr-only">Priority {j.rank}: </span>
                {j.title}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function BoundariesPanel({ boundaries }: { boundaries: BoundaryView[] }) {
  return (
    <section aria-label="Boundaries" className="rounded-xl border border-line bg-surface p-4">
      <SectionTitle icon={<Anchor className="size-3.5" />}>Boundaries</SectionTitle>
      {boundaries.length === 0 ? (
        <p className="text-[13px] text-muted">No boundaries yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {boundaries.map((b) => {
            const s = STRENGTH[b.strength] ?? STRENGTH.preference;
            return (
              <li key={b.id} className="flex items-start justify-between gap-3">
                <span className="text-[13.5px] leading-snug text-ink">{b.label}</span>
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${s.cls}`}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function OutcomesPanel({ outcomes }: { outcomes: OutcomeRowView[] }) {
  if (outcomes.length === 0) return null;
  return (
    <section aria-label="Check-in outcomes" className="rounded-xl border border-line bg-surface p-4">
      <SectionTitle icon={<Star className="size-3.5" />}>What you told Fewer</SectionTitle>
      <ul className="space-y-3">
        {outcomes.map((o) => (
          <li key={o.id} className="text-[13.5px] leading-snug">
            <p className="font-medium text-ink">
              Rated {o.rating}/5
              {o.note ? <span className="font-normal text-muted"> — “{o.note}”</span> : null}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {o.askTitle}
              {o.tag ? ` · ${o.tag}` : ""} · {relativeTime(o.at)}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Low ratings teach Fewer to say no to that kind of ask.
      </p>
    </section>
  );
}
