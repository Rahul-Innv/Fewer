"use client";

import { ChevronRight, Layers, X } from "lucide-react";
import { clockTime, plural } from "./format";
import type { Verdict } from "@/core/contracts";
import type { AskCardData } from "./types";
import { VERDICTS } from "./tokens";
import type { VerdictChange } from "./Actions";
import { VerdictCard } from "./VerdictCard";

function dayKey(iso: string, timeZone: string): { key: string; label: string } {
  const d = new Date(iso);
  let label: string;
  let key: string;
  try {
    label = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone });
    key = d.toLocaleDateString("en-CA", { timeZone }); // YYYY-MM-DD, sorts as text
  } catch {
    label = d.toDateString();
    key = d.toISOString().slice(0, 10);
  }
  return { key, label };
}

/** Asks as an agenda: one group per day (sticky header), sorted by start time; undated asks last. */
export function AgendaList({
  asks,
  timeZone,
  initialIds,
  changes,
  filter,
  onClearFilter,
  mode = "before",
}: {
  /** before: every invite, clashes marked. after: Fewer's plan (yes first, then shorter, then needs an answer). */
  mode?: "before" | "after";
  asks: AskCardData[];
  timeZone: string;
  initialIds: Set<string> | null;
  changes: Record<string, VerdictChange>;
  filter: Verdict | null;
  onClearFilter: () => void;
}) {
  const groups = new Map<string, { label: string; items: AskCardData[] }>();
  const undated: AskCardData[] = [];
  for (const a of asks) {
    const t = a.startsAt ? Date.parse(a.startsAt) : Number.NaN;
    if (!Number.isFinite(t)) {
      undated.push(a);
      continue;
    }
    const { key, label } = dayKey(a.startsAt!, timeZone);
    const g = groups.get(key) ?? { label, items: [] };
    g.items.push(a);
    groups.set(key, g);
  }
  const days = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [, g] of days) g.items.sort((x, y) => Date.parse(x.startsAt!) - Date.parse(y.startsAt!));
  if (undated.length) days.push(["~", { label: "No date yet", items: undated }]);

  const row = (card: AskCardData) => (
    <div key={card.id} className="relative pl-6">
      <span
        aria-hidden
        className={`absolute left-[3px] top-[22px] size-[11px] rounded-full ring-[3px] ring-paper ${card.verdict ? VERDICTS[card.verdict].bar : "bg-line-strong"}`}
      />
      <VerdictCard
      key={card.id}
      card={card}
      timeZone={timeZone}
      isNew={initialIds !== null && !initialIds.has(card.id)}
      change={changes[card.id]}
      />
    </div>
  );

  const today = dayKey(new Date().toISOString(), timeZone).key;
  const endOf = (a: AskCardData) => Date.parse(a.startsAt!) + (a.durationMin ?? 60) * 60_000;
  /** Groups of 2+ asks whose times overlap, for the Before view's clash markers. */
  const clashes = (items: AskCardData[]) => {
    const out: { from: number; to: number; n: number }[] = [];
    let cur: { from: number; to: number; n: number } | null = null;
    for (const a of items) {
      const s = Date.parse(a.startsAt!);
      const e = endOf(a);
      if (cur && s < cur.to) {
        cur.to = Math.max(cur.to, e);
        cur.n += 1;
      } else {
        if (cur && cur.n > 1) out.push(cur);
        cur = { from: s, to: e, n: 1 };
      }
    }
    if (cur && cur.n > 1) out.push(cur);
    return out;
  };
  const sub = (title: string, items: AskCardData[]) =>
    items.length ? (
      <details className="group mt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-2 text-[14px] font-semibold text-ink hover:bg-surface">
          <ChevronRight aria-hidden className="size-4 text-muted transition-transform group-open:rotate-90" />
          {title} ({items.length})
        </summary>
        <div className="mt-1.5 space-y-2">{items.map(row)}</div>
      </details>
    ) : null;

  return (
    <div key={mode} className="status-in space-y-4">
      {filter ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          Showing only <span className={`font-semibold ${VERDICTS[filter].text}`}>{VERDICTS[filter].label}</span> ({asks.length})
          <button
            type="button"
            onClick={onClearFilter}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-ink hover:bg-surface"
          >
            <X aria-hidden className="size-3.5" />
            Show all
          </button>
        </p>
      ) : null}
      {days.length === 0 ? <p className="text-[13.5px] text-muted">No asks match.</p> : null}
      {days.some(([k]) => k !== "~") ? (
        <nav aria-label="Jump to a day" className="flex gap-2 overflow-x-auto pb-1">
          {days
            .filter(([k]) => k !== "~")
            .map(([k, g]) => {
              const yes = g.items.filter((a) => a.verdict === "YES" || a.verdict === "WILDCARD").length;
              const [wd, md] = [g.label.split(",")[0].slice(0, 3), g.label.split(", ")[1]?.split(" ")[1] ?? ""];
              const isToday = k === today;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => document.getElementById(`day-${k}`)?.scrollIntoView({ block: "start" })}
                  aria-current={isToday ? "date" : undefined}
                  className={`flex min-h-11 shrink-0 flex-col items-start rounded-xl border px-3 py-1.5 text-left ${
                    isToday ? "border-ink bg-ink text-action-ink" : "border-line bg-surface text-ink hover:border-ink"
                  }`}
                >
                  <span className="text-[13.5px] font-semibold">
                    {wd} {md}
                  </span>
                  <span className={`text-[12px] tabular-nums ${isToday ? "text-action-ink" : "text-muted"}`}>
                    {yes} yes
                  </span>
                </button>
              );
            })}
        </nav>
      ) : null}
      {days.map(([key, g]) => (
        <section key={key} id={`day-${key}`} aria-label={g.label} className="scroll-mt-2">
          <h3 className="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 bg-paper/95 px-1 py-2 backdrop-blur-sm">
            <span className="text-[19px] font-semibold text-ink">{key === "~" ? g.label : g.label.split(",")[0]}</span>
            {key === "~" ? null : <span className="text-[13px] text-muted">{g.label.split(", ").slice(1).join(", ")}</span>}
          </h3>
          {mode === "after" ? (
            <>
              {g.items.some((a) => a.verdict === "YES" || a.verdict === "WILDCARD" || !a.verdict) ? (
                <div className="timeline mt-1.5 space-y-2">
                  {g.items.filter((a) => a.verdict === "YES" || a.verdict === "WILDCARD" || !a.verdict).map(row)}
                </div>
              ) : (
                <p className="mt-1 px-1 text-[14px] text-muted">Nothing planned</p>
              )}
              {sub("Shorter", g.items.filter((a) => a.verdict === "SMALLER"))}
              {sub("One question", g.items.filter((a) => a.verdict === "ASK_ONE"))}
              {sub("No", g.items.filter((a) => a.verdict === "NO" || a.verdict === "BLOCKED"))}
            </>
          ) : (
            <>
              {key !== "~"
                ? clashes(g.items).map((c) => (
                    <p key={c.from} className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-warn-bg px-2.5 py-0.5 text-[12px] font-medium text-warn-fg">
                      <Layers aria-hidden className="size-3.5" />
                      {clockTime(new Date(c.from).toISOString(), timeZone)} to {clockTime(new Date(c.to).toISOString(), timeZone)}:{" "}
                      {plural(c.n, "event", "events")} at the same time
                    </p>
                  ))
                : null}
              <div className="timeline mt-1.5 space-y-2">{g.items.map(row)}</div>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
