"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Verdict } from "@/core/contracts";
import type { AskCardData } from "./types";
import { VERDICTS } from "./tokens";
import { clockTime } from "./format";
import { VerdictCard } from "./VerdictCard";

/** Flag: set false to hide the Week tab without touching the Desk. */
export const SHOW_WEEK = true;

const START_MIN = 8 * 60; // 8 AM
const END_MIN = 23 * 60; // 11 PM
const SLOT = 30; // minutes per row
const ROW_PX = 24;
const GRID_PX = ((END_MIN - START_MIN) / SLOT) * ROW_PX;
const DECLINED: Verdict[] = ["NO", "BLOCKED"];

type Busy = { start: string; end: string };

// ---------- calendar-date helpers (owner's time zone; day keys are YYYY-MM-DD) ----------
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zoned(ms: number, timeZone: string): { key: string; min: number } {
  let f = fmtCache.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
    fmtCache.set(timeZone, f);
  }
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { key: `${o.year}-${o.month}-${o.day}`, min: Number(o.hour) * 60 + Number(o.minute) };
}
function keyToUTC(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(key: string, n: number): string {
  const d = keyToUTC(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(key: string): string {
  const dow = keyToUTC(key).getUTCDay(); // 0 Sun .. 6 Sat
  return addDays(key, -((dow + 6) % 7));
}
function dayLabel(key: string, style: "short" | "long") {
  const d = keyToUTC(key);
  return {
    wd: d.toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" }),
    md: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}
const hourLabel = (min: number) => {
  const h = Math.floor(min / 60);
  return `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
};

type Placed = { ask: AskCardData; s: number; e: number; col: number; cols: number };

/** Google-Calendar-style columns: overlapping events in a cluster sit side by side. */
function layout(items: { ask: AskCardData; s: number; e: number }[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];
  const flush = () => {
    const cols = colEnds.length || 1;
    for (const p of cluster) p.cols = cols;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.s >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.e);
    } else colEnds[col] = it.e;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

const Block = memo(function Block({ p, timeZone, onOpen }: { p: Placed; timeZone: string; onOpen: (id: string) => void }) {
  const v = p.ask.verdict ? VERDICTS[p.ask.verdict] : null;
  const top = ((Math.max(p.s, START_MIN) - START_MIN) / SLOT) * ROW_PX;
  const height = Math.max(((Math.min(p.e, END_MIN) - Math.max(p.s, START_MIN)) / SLOT) * ROW_PX - 2, 22);
  const tall = height >= 44;
  return (
    <button
      type="button"
      onClick={() => onOpen(p.ask.id)}
      title={`${p.ask.title}${v ? ` · ${v.label}` : ""}`}
      className={cn(
        "absolute overflow-hidden rounded-lg px-1.5 py-0.5 text-left text-[11.5px] leading-tight shadow-[0_1px_0_rgba(27,31,35,0.15)] ring-1 ring-surface hover:z-10 hover:brightness-110 focus-visible:z-10",
        v ? v.solid : "bg-line-strong text-ink",
      )}
      style={{ top, height, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)` }}
    >
      <span className="block truncate font-semibold">
        {p.ask.startsAt ? clockTime(p.ask.startsAt, timeZone) : ""} {tall ? "" : p.ask.title}
      </span>
      {tall ? <span className="block truncate font-semibold">{p.ask.title}</span> : null}
      {tall && v ? <span className="block truncate opacity-95">{v.label}</span> : null}
    </button>
  );
});

/**
 * Week / Day calendar of the asks on the Desk: blocks from startsAt + durationMin, colored by the solid verdict accent,
 * overlapping blocks side by side, busy commitments hatched. Click a block for its details.
 */
export function WeekView({
  asks,
  timeZone,
  commitments,
}: {
  asks: AskCardData[];
  timeZone: string;
  commitments?: Busy[] | null;
}) {
  const [userMode, setUserMode] = useState<"week" | "day" | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [userKey, setUserKey] = useState<string | null>(null);
  const [showDeclined, setShowDeclined] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    const t = setTimeout(update, 0);
    mq.addEventListener("change", update);
    return () => {
      clearTimeout(t);
      mq.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!openId) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const mode = userMode ?? (narrow ? "day" : "week");
  const [loadedAt] = useState(() => Date.now());
  const today = zoned(loadedAt, timeZone).key;

  // Placed events per day key, computed once per payload.
  const { byDay, firstUpcoming } = useMemo(() => {
    const map = new Map<string, { ask: AskCardData; s: number; e: number }[]>();
    let first: string | null = null;
    for (const a of asks) {
      if (!a.startsAt) continue;
      const t = Date.parse(a.startsAt);
      if (!Number.isFinite(t)) continue;
      if (!showDeclined && a.verdict && DECLINED.includes(a.verdict)) continue;
      const { key, min } = zoned(t, timeZone);
      const e = min + Math.max(15, a.durationMin ?? 60);
      if (e <= START_MIN || min >= END_MIN) continue;
      const list = map.get(key) ?? [];
      list.push({ ask: a, s: min, e: Math.min(e, 24 * 60) });
      map.set(key, list);
      if (key >= today && (!first || key < first)) first = key;
    }
    const placed = new Map<string, Placed[]>();
    for (const [k, list] of map) placed.set(k, layout(list));
    return { byDay: placed, firstUpcoming: first };
  }, [asks, timeZone, showDeclined, today]);

  const busyByDay = useMemo(() => {
    const map = new Map<string, { s: number; e: number }[]>();
    for (const c of commitments ?? []) {
      const s = Date.parse(c.start);
      const e = Date.parse(c.end);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      const zs = zoned(s, timeZone);
      const ze = zoned(e, timeZone);
      const end = ze.key === zs.key ? ze.min : 24 * 60;
      const list = map.get(zs.key) ?? [];
      list.push({ s: zs.min, e: end });
      map.set(zs.key, list);
    }
    return map;
  }, [commitments, timeZone]);

  const focus = userKey ?? firstUpcoming ?? today;
  const days = mode === "week" ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(focus), i)) : [focus];
  const step = mode === "week" ? 7 : 1;
  const rangeLabel =
    mode === "week"
      ? `${dayLabel(days[0], "short").md} to ${dayLabel(days[6], "short").md}`
      : `${dayLabel(focus, "long").wd}, ${dayLabel(focus, "long").md}`;
  const opened = openId ? asks.find((a) => a.id === openId) ?? null : null;
  const hours = Array.from({ length: (END_MIN - START_MIN) / 60 + 1 }, (_, i) => START_MIN + i * 60);

  const pill = (on: boolean) =>
    cn("h-9 rounded-lg px-3.5 text-[14px] transition-colors", on ? "bg-ink font-semibold text-action-ink" : "text-muted hover:text-ink");
  const iconBtn =
    "grid size-11 place-items-center rounded-xl border border-line-strong bg-surface text-ink transition-transform duration-100 hover:border-ink active:scale-[0.96] motion-reduce:transition-none";

  return (
    <div className="space-y-3">
      {/* toolbar: Week | Day, prev / next, range, legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Calendar view" className="inline-flex rounded-xl border border-line-strong bg-surface p-1">
            <button type="button" role="radio" aria-checked={mode === "week"} onClick={() => setUserMode("week")} className={pill(mode === "week")}>
              Week
            </button>
            <button type="button" role="radio" aria-checked={mode === "day"} onClick={() => setUserMode("day")} className={pill(mode === "day")}>
              Day
            </button>
          </div>
          <button type="button" className={iconBtn} aria-label={mode === "week" ? "Previous week" : "Previous day"} onClick={() => setUserKey(addDays(focus, -step))}>
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <button type="button" className={iconBtn} aria-label={mode === "week" ? "Next week" : "Next day"} onClick={() => setUserKey(addDays(focus, step))}>
            <ChevronRight aria-hidden className="size-5" />
          </button>
          <p className="text-[16px] font-semibold text-ink" aria-live="polite">
            {rangeLabel}
          </p>
          {focus !== today ? (
            <button type="button" onClick={() => setUserKey(today)} className="h-11 rounded-xl px-3 text-[14px] font-medium text-ink underline underline-offset-2">
              Today
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink">
          {(["YES", "SMALLER", "ASK_ONE", "NO"] as Verdict[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`size-3 rounded-sm ${VERDICTS[k].bar}`} />
              {VERDICTS[k].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-sm border border-line-strong busy-hatch" />
            Busy
          </span>
          <button
            type="button"
            aria-pressed={showDeclined}
            onClick={() => setShowDeclined((s) => !s)}
            className={cn(
              "h-9 rounded-lg border px-3 text-[13px] font-medium",
              showDeclined ? "border-ink bg-ink text-action-ink" : "border-line-strong bg-surface text-ink hover:border-ink",
            )}
          >
            Show declined
          </button>
        </div>
      </div>

      {/* grid */}
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="grid border-b border-line" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((k) => {
            const { wd, md } = dayLabel(k, mode === "day" ? "long" : "short");
            const isToday = k === today;
            return (
              <div key={k} className="border-l border-line px-2 py-2 text-center" aria-current={isToday ? "date" : undefined}>
                <p className={cn("text-[13px]", isToday ? "font-bold text-ink" : "text-muted")}>{wd}</p>
                <p className={cn("text-[15px] font-semibold", isToday ? "text-ink" : "text-ink")}>
                  {isToday ? <span className="rounded-full bg-ink px-2 py-0.5 text-action-ink">{md}</span> : md}
                </p>
              </div>
            );
          })}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* time gutter */}
          <div className="relative" style={{ height: GRID_PX }}>
            {hours.map((m) => (
              <span
                key={m}
                className="absolute right-2 -translate-y-1/2 text-[11.5px] text-muted tabular-nums"
                style={{ top: ((m - START_MIN) / SLOT) * ROW_PX }}
              >
                {m === START_MIN ? "" : hourLabel(m)}
              </span>
            ))}
          </div>
          {days.map((k) => {
            const placed = byDay.get(k) ?? [];
            const busy = busyByDay.get(k) ?? [];
            return (
              <div
                key={k}
                className="calendar-lines relative border-l border-line"
                style={{ height: GRID_PX }}
                aria-label={`${dayLabel(k, "long").wd}, ${placed.length} events`}
                role="group"
              >
                {busy.map((b, i) => {
                  const s = Math.max(b.s, START_MIN);
                  const e = Math.min(b.e, END_MIN);
                  if (e <= s) return null;
                  return (
                    <div
                      key={`busy-${i}`}
                      className="busy-hatch absolute inset-x-0.5 rounded-md border border-line-strong px-1.5 text-[11px] font-medium text-muted"
                      style={{ top: ((s - START_MIN) / SLOT) * ROW_PX, height: ((e - s) / SLOT) * ROW_PX - 2 }}
                    >
                      Busy
                    </div>
                  );
                })}
                {placed.map((p) => (
                  <Block key={p.ask.id} p={p} timeZone={timeZone} onOpen={setOpenId} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {opened ? (
        <div className="fixed inset-0 z-40">
          <button type="button" aria-label="Close" tabIndex={-1} onClick={() => setOpenId(null)} className="absolute inset-0 bg-ink/20" />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={opened.title}
            tabIndex={-1}
            className="drawer-in absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-line-strong bg-paper outline-none"
          >
            <div className="flex items-center justify-end border-b border-line px-4 py-2.5">
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className="grid size-11 place-items-center rounded-xl text-muted transition hover:bg-line hover:text-ink"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <VerdictCard card={opened} timeZone={timeZone} isNew={false} defaultExpanded />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
