"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Loader2, RotateCcw } from "lucide-react";
import { Callout } from "./Actions";

/**
 * Is a local-only route usable here? Probes with GET (never POST, so probing changes nothing).
 * 404: not built yet, probe again in 15 s. 403: the deployed app forbids it, hide for good. Anything else: show.
 */
function useAvailable(path: string): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let stopped = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const probe = async () => {
      try {
        const res = await fetch(path, { method: "GET", cache: "no-store" });
        if (stopped) return;
        if (res.status === 403) return setOk(false);
        if (res.status === 404) {
          setOk(false);
          t = setTimeout(probe, 15_000);
          return;
        }
        setOk(true);
      } catch {
        if (!stopped) t = setTimeout(probe, 15_000);
      }
    };
    void probe();
    return () => {
      stopped = true;
      if (t) clearTimeout(t);
    };
  }, [path]);
  return ok;
}

async function postJson(path: string, body: unknown) {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; total?: number };
    return { status: res.status, ok: res.ok && data.ok !== false, data };
  } catch {
    return { status: 0, ok: false, data: { error: "Couldn't reach the Desk." } as { ok?: boolean; error?: string; total?: number } };
  }
}

const secondaryBtn =
  "inline-flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink transition-transform duration-100 hover:border-ink active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none";
const primaryBtn =
  "inline-flex h-11 items-center gap-2 rounded-xl bg-action px-4 text-[14px] font-semibold text-action-ink transition-transform duration-100 hover:bg-black active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none";

/** "Reset demo": clears demo rows only (POST /api/demo/reset). Hidden until the route exists; never a dead button. */
export function ResetDemoButton({ onDone, onToast }: { onDone: () => void; onToast: (text: string) => void }) {
  const available = useAvailable("/api/demo/reset");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);

  // A reset mid-run would delete asks as they land: watch GET /api/demo/run while this button is on screen.
  useEffect(() => {
    if (!available) return;
    let stopped = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch("/api/demo/run", { cache: "no-store" });
        const d = (await res.json().catch(() => ({}))) as { inserted?: unknown; total?: unknown };
        if (!stopped) setDemoRunning(typeof d.inserted === "number" && typeof d.total === "number" && d.inserted < d.total);
      } catch {
        /* keep the last known state */
      }
      if (!stopped) t = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stopped = true;
      if (t) clearTimeout(t);
    };
  }, [available]);

  if (!available || hidden) return null;

  async function reset() {
    setBusy(true);
    setProblem(null);
    const r = await postJson("/api/demo/reset", {});
    setBusy(false);
    if (r.status === 403) return setHidden(true);
    if (r.ok) {
      onToast("Demo cleared");
      onDone();
    } else {
      setProblem(r.data.error || "Couldn't reset the demo.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={reset}
        disabled={busy || demoRunning}
        title={demoRunning ? "Wait for the demo to finish" : undefined}
        className={secondaryBtn}
      >
        {busy ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden className="size-4" />}
        Reset demo
        {demoRunning ? <span className="sr-only"> (wait for the demo to finish)</span> : null}
      </button>
      {problem ? <Callout text={problem} onClose={() => setProblem(null)} /> : null}
    </div>
  );
}

type Progress = { inserted: number; total: number; running?: boolean };

async function readImportProgress(): Promise<Progress | null> {
  try {
    const res = await fetch("/api/live/import-week", { cache: "no-store" });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { inserted?: unknown; total?: unknown; running?: unknown };
    if (typeof d.inserted !== "number" || typeof d.total !== "number" || d.total <= 0) return null;
    // `running` is authoritative when sent; otherwise "not all arrived yet" means running.
    const running = typeof d.running === "boolean" ? d.running : d.inserted < d.total;
    return { inserted: d.inserted, total: d.total, running };
  } catch {
    return null;
  }
}

/**
 * Live-scope controls, local only: "Import my week" (POST, then GET progress every 1.5 s while running) and
 * "Reset live" behind a confirm. Each hides when its route is missing or answers 403 (the deployed app).
 */
export function LiveControls({ onChanged, onToast }: { onChanged: () => void; onToast: (text: string) => void }) {
  const canReset = useAvailable("/api/live/reset");
  const canImport = useAvailable("/api/live/import-week");
  const [forbidden, setForbidden] = useState<{ reset: boolean; import: boolean }>({ reset: false, import: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<null | "reset" | "import">(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const seen = useRef(-1);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const running = progress !== null && progress.running !== false;

  // Import progress: poll only while a run is in progress (also resumes a run already going on load).
  useEffect(() => {
    if (!canImport) return;
    let stopped = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const p = await readImportProgress();
      if (stopped) return;
      if (p && p.running) {
        setProgress(p);
        if (p.inserted !== seen.current) {
          seen.current = p.inserted;
          onChanged();
        }
        t = setTimeout(tick, 1500);
      } else {
        if (seen.current >= 0) {
          onChanged();
          if (p) onToast(`${p.inserted} of ${p.total} arrived`);
        }
        seen.current = -1;
        setProgress(null);
        // Idle: keep an eye out for an import started elsewhere, so Reset live can't run over it.
        t = setTimeout(tick, 3000);
      }
    };
    t = setTimeout(tick, runId === 0 ? 0 : 1500);
    return () => {
      stopped = true;
      if (t) clearTimeout(t);
    };
  }, [runId, canImport, onChanged, onToast]);

  // Confirm dialog: focus Cancel, Escape closes.
  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  const showReset = canReset && !forbidden.reset;
  const showImport = canImport && !forbidden.import;
  if (!showReset && !showImport) return null;

  async function importWeek() {
    setBusy("import");
    setProblem(null);
    const r = await postJson("/api/live/import-week", {});
    setBusy(null);
    if (r.status === 403) return setForbidden((f) => ({ ...f, import: true }));
    if (r.ok) {
      seen.current = 0;
      if (typeof r.data.total === "number" && r.data.total > 0) setProgress({ inserted: 0, total: r.data.total, running: true });
      setRunId((n) => n + 1);
      onChanged();
    } else {
      setProblem(r.data.error || "Couldn't import your week.");
    }
  }

  async function clearLive() {
    setBusy("reset");
    setProblem(null);
    const r = await postJson("/api/live/reset", { confirm: "RESET LIVE" });
    setBusy(null);
    setConfirming(false);
    if (r.status === 403) return setForbidden((f) => ({ ...f, reset: true }));
    if (r.ok) {
      const n = (r.data as { deleted?: unknown }).deleted;
      onToast(typeof n === "number" ? `Cleared ${n} ${n === 1 ? "ask" : "asks"}` : "Cleared");
      onChanged();
    } else {
      setProblem(r.data.error || "Couldn't clear your live asks.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {running && progress ? (
          <span role="status" className="text-[14px] font-medium text-ink tabular-nums">
            {progress.inserted} of {progress.total} arrived
          </span>
        ) : null}
        {showReset ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy !== null || running}
            title={running ? "Wait for the import to finish" : undefined}
            className={secondaryBtn}
          >
            <RotateCcw aria-hidden className="size-4" />
            Reset live
            {running ? <span className="sr-only"> (wait for the import to finish)</span> : null}
          </button>
        ) : null}
        {showImport ? (
          <button type="button" onClick={importWeek} disabled={busy !== null || running} className={primaryBtn}>
            {busy === "import" || running ? (
              <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <CalendarPlus aria-hidden className="size-4" />
            )}
            Import my week
          </button>
        ) : null}
      </div>
      {problem ? <Callout text={problem} onClose={() => setProblem(null)} /> : null}

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <button type="button" aria-label="Cancel" tabIndex={-1} onClick={() => setConfirming(false)} className="absolute inset-0 bg-ink/30" />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-live-h"
            className="relative w-full max-w-sm rounded-[20px] border border-line bg-surface p-5 shadow-[0_24px_60px_-24px_rgba(27,31,35,0.5)]"
          >
            <h2 id="reset-live-h" className="text-[17px] font-semibold text-ink">
              Clear imported and pasted asks? Goals stay, and replies to real senders stay.
            </h2>
            <div className="mt-5 flex justify-end gap-2">
              <button ref={cancelRef} type="button" onClick={() => setConfirming(false)} className={secondaryBtn}>
                Cancel
              </button>
              <button
                type="button"
                onClick={clearLive}
                disabled={busy === "reset"}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-blocked-accent px-4 text-[14px] font-semibold text-white transition-transform duration-100 hover:bg-blocked-fg active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none"
              >
                {busy === "reset" ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
