"use client";

import { useCallback, useEffect, useState } from "react";
import { Sunrise } from "lucide-react";
import { clockTime, plural, relativeTime } from "./format";

/**
 * "Proactive": Fewer guards the owner's time on its own. Shows the latest morning brief it emailed and one
 * labeled demo button that runs the two proactive jobs now (follow-up on an ended yes, then the brief).
 * Data comes from GET/POST /api/proactive, so no other lane's types or read model are touched.
 */

type LatestBrief = { summary: string; at: string; date: string | null; demo: boolean };
type RunResult = { ok?: boolean; checkins?: number; brief?: string | null; briefSent?: boolean; error?: string };

const REFRESH_MS = 60_000;

export function ProactivePanel({ timeZone }: { timeZone?: string }) {
  const [latest, setLatest] = useState<LatestBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const res = await fetch("/api/proactive", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { brief?: LatestBrief | null };
      setLatest(data.brief ?? null);
    } catch {
      /* the panel keeps showing the last brief it had */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void loadLatest(), 0);
    const timer = setInterval(() => {
      if (!document.hidden) void loadLatest();
    }, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loadLatest]);

  async function runNow() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/proactive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as RunResult;
      if (!res.ok) {
        setNote({ text: data.error ?? "The proactive check failed. Nothing was sent.", problem: true });
      } else {
        const followUps =
          typeof data.checkins === "number" && data.checkins > 0
            ? `Sent ${plural(data.checkins, "check-in")}: “Was it worth it? 1 to 5”.`
            : "No check-ins due right now.";
        const brief = data.briefSent ? "Morning brief emailed (demo run)." : "";
        const problem = data.error ? ` ${data.error}` : "";
        setNote({ text: `${followUps} ${brief}${problem}`.trim(), problem: Boolean(data.error) });
      }
    } catch {
      setNote({ text: "The proactive check failed. Network error.", problem: true });
    } finally {
      setBusy(false);
      void loadLatest();
    }
  }

  return (
    <section aria-label="Proactive" className="rounded-xl border border-line bg-surface p-4">
      <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        <span aria-hidden className="text-muted">
          <Sunrise className="size-3.5" />
        </span>
        Proactive
      </h3>

      {latest ? (
        <div>
          <p className="text-[12.5px] text-muted">
            Latest morning brief · {clockTime(latest.at, timeZone)} · {relativeTime(latest.at)}
            {latest.demo ? " · demo run" : ""}
          </p>
          <p className="mt-1 text-[14px] leading-snug text-ink">{latest.summary}</p>
        </div>
      ) : (
        <p className="text-[13px] text-muted">No morning brief yet. Fewer emails one at 8:00 AM your time.</p>
      )}

      <p className="mt-3 text-[12.5px] leading-snug text-muted">
        Once an approved yes has ended, Fewer asks “Was it worth it?” by itself.
      </p>

      <button
        type="button"
        onClick={runNow}
        disabled={busy}
        className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-action px-4 text-[14px] font-semibold text-action-ink transition hover:bg-black motion-reduce:transition-none disabled:opacity-60"
      >
        {busy ? "Checking…" : "Run proactive check now (demo)"}
      </button>

      <div role="status" aria-live="polite" className="mt-2 min-h-5 text-[13px] leading-snug">
        {note ? (
          <p className={note.problem ? "rounded-lg bg-warn-bg px-3 py-2 text-warn-fg" : "text-muted"}>{note.text}</p>
        ) : null}
      </div>
    </section>
  );
}
