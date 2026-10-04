"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, FlaskConical, Loader2, MessageSquareText, TriangleAlert } from "lucide-react";
import type { DeskData } from "./types";
import type { Verdict } from "@/core/contracts";
import { VERDICTS } from "./tokens";
import { ApprovalBanner } from "./ApprovalBanner";
import { BoundariesPanel, OutcomesPanel, WeekLedger } from "./LeftColumn";
import { AgendaList } from "./Agenda";
import { ProactivePanel } from "./ProactivePanel";
import { AskComposer } from "./AskComposer";
import { AgentNow } from "./AgentNow";
import { SHOW_WEEK, WeekView } from "./WeekView";
import { LiveControls, ResetDemoButton } from "./Controls";
import { DemoBadge, DemoSteps, InboxLine, RunDemoButton, StatTiles } from "./Overview";
import { LogoMark } from "./LogoMark";
import { EmailPlanButton, GoalOrder, Toast, type VerdictChange } from "./Actions";
import { ChatDrawer, ChatLauncher } from "../chat/ChatDrawer";
import { clockTime, plural, savedHoursForSmaller } from "./format";

const POLL_MS = 2500;

const SECTIONS = ["plan", "week", "goals", "activity"] as const;
type Scope = "live" | "demo";
type Section = (typeof SECTIONS)[number];

function EmptyState({ inbox, desk }: { inbox: string | null; desk: DeskData | null }) {
  const notConfigured = desk && !desk.configured;
  return (
    <section
      aria-labelledby="empty-h"
      className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center"
    >
      <h2 id="empty-h" className="font-serif text-[28px] leading-tight text-ink">
        No asks yet.
      </h2>
      {inbox ? (
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface py-1 pl-3 pr-1.5">
          <span className="select-all font-mono text-[14px] text-ink">{inbox}</span>
          <CopyInbox inbox={inbox} />
        </p>
      ) : (
        <p className="mt-4 font-mono text-[14px] text-muted">Set FEWER_INBOX to show the address</p>
      )}
      <p className="mt-3 text-[14px] text-muted">Import your week or add an ask.</p>
      {notConfigured ? (
        <p className="mx-auto mt-4 max-w-md rounded-lg bg-warn-bg px-3 py-2 text-[13px] text-warn-fg">
          The database isn’t connected yet (DATABASE_URL is not set), so the Desk is showing an empty state.
        </p>
      ) : null}
    </section>
  );
}

/** First-load placeholder shaped like a verdict card: edge, rule line, verdict word, title, two detail columns. */
function SkeletonCard() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface pl-[5px]">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[5px] bg-line-strong" />
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="skeleton-bar h-3 w-[40%] rounded-full bg-line" />
          <div className="skeleton-bar h-3 w-12 rounded-full bg-line" />
        </div>
        <div className="skeleton-bar mt-4 h-8 w-[60%] rounded-lg bg-line" />
        <div className="skeleton-bar mt-4 h-4 w-[90%] rounded-full bg-line" />
        <div className="skeleton-bar mt-2 h-3 w-[40%] rounded-full bg-line" />
        <div className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
          <div className="space-y-2.5">
            <div className="skeleton-bar h-3 w-[60%] rounded-full bg-line" />
            <div className="skeleton-bar h-3 w-[90%] rounded-full bg-line" />
            <div className="skeleton-bar h-3 w-[40%] rounded-full bg-line" />
          </div>
          <div className="space-y-2.5">
            <div className="skeleton-bar h-3 w-[90%] rounded-full bg-line" />
            <div className="skeleton-bar h-3 w-[60%] rounded-full bg-line" />
            <div className="skeleton-bar h-3 w-[40%] rounded-full bg-line" />
          </div>
        </div>
      </div>
      <div className="h-11 border-t border-line bg-paper/60" />
    </div>
  );
}

function CopyInbox({ inbox }: { inbox: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(inbox);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable: the address is selectable text anyway */
        }
      }}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted transition hover:bg-line hover:text-ink"
      aria-label={copied ? "Address copied" : "Copy inbox address"}
    >
      {copied ? <Check aria-hidden className="size-3.5 text-yes-fg" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}

export function Desk({ initialInbox, ownerName }: { initialInbox: string | null; ownerName: string }) {
  const [desk, setDesk] = useState<DeskData | null>(null);
  const [offline, setOffline] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [skipBusy, setSkipBusy] = useState(false);
  const [skipNote, setSkipNote] = useState<string | null>(null);
  const [skippedLocal, setSkippedLocal] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [view, setView] = useState<Section>("plan");
  // Live | Demo: everything on the page follows it except the shared goals. In the hash (#plan/demo) and localStorage.
  const [scope, setScope] = useState<Scope>("live");
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const [changes, setChanges] = useState<Record<string, VerdictChange>>({});
  useEffect(() => {
    const read = () => {
      const [h, sc] = window.location.hash.replace("#", "").split("/");
      if (SECTIONS.includes(h as Section)) setView(h as Section);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("fewer.scope");
      } catch {
        /* storage blocked */
      }
      const want = sc === "demo" || sc === "live" ? sc : h === "demo" ? "demo" : saved;
      if (want === "demo" || want === "live") setScope(want);
    };
    const t = setTimeout(read, 0);
    window.addEventListener("hashchange", read);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", read);
    };
  }, []);

  const firstLoad = useRef(true);
  // Last payload minus its `now` stamp: an unchanged Desk causes no state update and no re-render.
  const lastPayload = useRef("");
  const [filter, setFilter] = useState<Verdict | null>(null);
  // Before (every invite) | After (Fewer's plan). Defaults to After; remembered per browser.
  const [plan, setPlanState] = useState<"before" | "after">("after");
  const setPlan = useCallback((p: "before" | "after") => {
    setPlanState(p);
    try {
      localStorage.setItem("fewer.plan", p);
    } catch {
      /* storage blocked: the choice just isn't remembered */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem("fewer.plan") === "before") setPlanState("before");
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  // Ask ids present on the first load: those cards don't animate in. State, not a ref, because render reads it.
  const [initialIds, setInitialIds] = useState<Set<string> | null>(null);
  const announced = useRef<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/desk", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      const key = text.replace(/"now":"[^"]*",?/, "");
      if (key === lastPayload.current) {
        setOffline(false);
        return;
      }
      lastPayload.current = key;
      const data = JSON.parse(text) as DeskData;
      setDesk(data);
      setOffline(false);

      if (firstLoad.current) {
        firstLoad.current = false;
        setInitialIds(new Set(data.asks.map((a) => a.id)));
        for (const a of data.asks) announced.current.set(a.id, a.verdict ?? "");
      } else {
        const msgs: string[] = [];
        for (const a of data.asks) {
          const prev = announced.current.get(a.id);
          const now = a.verdict ?? "";
          if (prev === undefined || (prev === "" && now !== "")) {
            if (now) msgs.push(`${a.title}: ${VERDICTS[a.verdict!].label}`);
            else if (prev === undefined) msgs.push(`New ask: ${a.title}`);
          }
          announced.current.set(a.id, now);
        }
        if (msgs.length) setAnnounce(msgs.join(". "));
      }
    } catch {
      setOffline(true);
    }
  }, []);

  const onVerdictsChanged = useCallback(
    (list: VerdictChange[]) => {
      const byAsk = Object.fromEntries(list.map((c) => [c.askId, c]));
      setChanges(byAsk);
      // Flip the verdicts now; the next poll brings the rest (drafts, approvals).
      setDesk((prev) =>
        prev ? { ...prev, asks: prev.asks.map((a) => (byAsk[a.id] ? { ...a, verdict: byAsk[a.id].to } : a)) } : prev,
      );
      lastPayload.current = "";
      void load();
      setTimeout(() => setChanges({}), 8000);
    },
    [load],
  );

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      // Always do the first load, even in a background tab (screen recorders, hidden panes).
      if (!document.hidden || firstLoad.current) await load();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function timeSkip() {
    setSkipBusy(true);
    setSkipNote(null);
    try {
      const res = await fetch("/api/timeskip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: number; error?: string };
      if (res.ok && data.ok !== false) {
        setSkippedLocal(true);
        setSkipNote(
          data.sent
            ? `Tomorrow. Sent ${plural(data.sent, "check-in")}: “Was it worth it? 1 to 5”. Reply from the demo inbox.`
            : "Tomorrow. No sent YES asks are waiting for a check-in.",
        );
      } else {
        setSkipNote(data.error ?? "Time-skip failed.");
      }
    } catch {
      setSkipNote("Time-skip failed. Network error.");
    } finally {
      setSkipBusy(false);
      void load();
    }
  }

  const inbox = desk?.inbox ?? initialInbox;
  const owner = desk?.ownerName && desk.ownerName !== "you" ? desk.ownerName : ownerName;
  const tz = desk?.timeZone ?? "America/Los_Angeles";
  const asks = desk?.asks ?? [];
  const showTimeSkipBadge = skippedLocal || (desk?.checkinsSent ?? 0) > 0;
  const isFirstPaint = desk === null;

  // LIVE and DEMO never mix: the stats and the Live tab show real asks only.
  const liveAsks = asks.filter((a) => a.demo !== true);
  const demoAsks = asks.filter((a) => a.demo === true);
  const liveDesk = desk ? { ...desk, asks: liveAsks } : null;
  // Demo hours saved: from the demo asks themselves, the same arithmetic the read-model uses for the week ledger.
  const demoHours =
    Math.round(
      demoAsks.reduce(
        (h, a) =>
          h +
          (a.verdict === "NO" && a.costHours != null
            ? a.costHours
            : a.verdict === "SMALLER" && a.costHours != null
              ? savedHoursForSmaller(a.costHours, a.smallerOffer)
              : 0),
        0,
      ) * 10,
    ) / 10;
  const demoDesk = desk
    ? {
        ...desk,
        asks: demoAsks,
        pending: desk.pendingDemo ?? null,
        checkinsSent: 0,
        ledger: { ...desk.ledger, hoursProtected: demoHours },
      }
    : null;
  const verdictByDraft = Object.fromEntries(asks.flatMap((a) => (a.draft ? [[a.draft.id, a.verdict]] : [])));
  const cardsFor = (list: typeof asks) => (
    <AgendaList
      asks={filter ? list.filter((a) => a.verdict === filter) : list}
      timeZone={tz}
      initialIds={initialIds}
      changes={changes}
      filter={filter}
      onClearFilter={() => setFilter(null)}
      mode={plan}
    />
  );
  const planSwitch = (list: typeof asks) => {
    const c = (v: Verdict[]) => list.filter((a) => a.verdict !== null && v.includes(a.verdict)).length;
    const yes = c(["YES", "WILDCARD"]);
    const shorter = c(["SMALLER"]);
    const askOne = c(["ASK_ONE"]);
    const declined = c(["NO", "BLOCKED"]);
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="radiogroup" aria-label="Before or after Fewer" className="inline-flex rounded-xl border border-line bg-surface p-1">
          {(
            [
              ["before", `Before: all ${list.length} invites`],
              ["after", "After: your plan"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={plan === id}
              onClick={() => setPlan(id)}
              className={`h-8 rounded-lg px-3 text-[13px] transition-colors duration-200 ${
                plan === id ? "bg-ink font-semibold text-action-ink" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[13.5px] text-ink tabular-nums">
          {list.length} invites → <span className="font-semibold">{yes} {yes === 1 ? "yes" : "yeses"}</span> · {shorter} shorter
          {askOne ? ` · ${askOne} with one question` : ""} · {declined} declined
        </p>
      </div>
    );
  };
  const NAV: { id: Section; label: string }[] = [
    { id: "plan", label: "Plan" },
    ...(SHOW_WEEK ? [{ id: "week" as const, label: "Week" }] : []),
    { id: "goals", label: "Goals" },
    { id: "activity", label: "Activity" },
  ];
  const remember = (id: Section, sc: Scope) => {
    try {
      history.replaceState(null, "", `#${id}/${sc}`);
      localStorage.setItem("fewer.scope", sc);
    } catch {
      /* hash and storage are conveniences only */
    }
  };
  const go = (id: Section) => {
    setView(id);
    remember(id, scope);
  };
  const pickScope = (sc: Scope) => {
    setScope(sc);
    remember(view, sc);
  };
  const isDemoScope = scope === "demo";
  const scopeDesk = isDemoScope ? demoDesk : liveDesk;
  const scopeAsks = isDemoScope ? demoAsks : liveAsks;
  const scopePending = isDemoScope ? (desk?.pendingDemo ?? null) : (desk?.pending ?? null);

  return (
    <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-28 pt-3 sm:px-6">
      {/* ---------- header: logo, what Fewer is doing, the two always-there actions ---------- */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="flex items-center gap-2.5 font-serif text-[36px] leading-none tracking-tight text-ink">
            <LogoMark className="size-9" />
            Fewer
          </h1>
          <AgentNow desk={scopeDesk} offline={offline} />
          <p className="text-[13px] text-muted">
            {offline ? (desk ? "Live updates paused." : "Reconnecting…") : isFirstPaint ? "Loading…" : `Live for ${owner}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <EmailPlanButton scope={scope} onToast={setToast} />
          <button
            type="button"
            onClick={() => setChatOpen((o) => !o)}
            aria-expanded={chatOpen}
            aria-controls="ask-fewer-drawer"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-action px-4 text-[14px] font-semibold text-action-ink transition-transform duration-100 hover:bg-black active:scale-[0.97] motion-reduce:transition-none"
          >
            <MessageSquareText aria-hidden className="size-4" />
            Ask Fewer
          </button>
        </div>
      </header>

      {/* ---------- nav bar: one section at a time, in the URL hash ---------- */}
      <nav aria-label="Sections" className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
        <div role="tablist" aria-label="Sections" className="-mb-px flex gap-1 overflow-x-auto">
          {NAV.map(({ id, label }, i) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`nav-${id}`}
              aria-selected={view === id}
              aria-controls={`section-${id}`}
              tabIndex={view === id ? 0 : -1}
              onClick={() => go(id)}
              onKeyDown={(e) => {
                const k = e.key;
                if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
                e.preventDefault();
                const n = k === "Home" ? 0 : k === "End" ? NAV.length - 1 : (i + (k === "ArrowRight" ? 1 : -1) + NAV.length) % NAV.length;
                go(NAV[n].id);
                document.getElementById(`nav-${NAV[n].id}`)?.focus();
              }}
              className={`inline-flex h-12 items-center gap-1.5 whitespace-nowrap border-b-[3px] px-4 text-[15px] transition-colors ${
                view === id ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {label}
              {id === "plan" && scopePending ? (
                <span className="ml-1 rounded-full bg-ink px-1.5 text-[11.5px] font-bold text-action-ink tabular-nums">
                  {scopePending.drafts.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Live or demo" className="mb-1.5 inline-flex rounded-xl border border-line-strong bg-surface p-1">
          {(["live", "demo"] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              role="radio"
              aria-checked={scope === sc}
              onClick={() => pickScope(sc)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[14px] transition-colors ${
                scope === sc ? "bg-ink font-semibold text-action-ink" : "text-muted hover:text-ink"
              }`}
            >
              {sc === "demo" ? <FlaskConical aria-hidden className="size-4" /> : null}
              {sc === "live" ? "Live" : "Demo"}
            </button>
          ))}
        </div>
      </nav>

      {isDemoScope ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/25 bg-surface px-4 py-2.5">
          <DemoBadge />
          <div className="flex flex-wrap items-start gap-2">
            <ResetDemoButton onDone={load} onToast={setToast} />
            <RunDemoButton onRan={load} />
          </div>
        </div>
      ) : null}

      {offline && desk ? (
        <p role="status" className="mt-3 rounded-lg bg-warn-bg px-3.5 py-2 text-[13px] text-warn-fg">
          Reconnecting… showing {clockTime(desk.now, tz)}
        </p>
      ) : null}
      {desk?.error ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warn-bg px-3.5 py-2.5 text-[13.5px] text-warn-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {desk.error}
        </p>
      ) : null}

      {/* ---------- PLAN: goals, where we are, the one action, the agenda ---------- */}
      <section role="tabpanel" id="section-plan" aria-labelledby="nav-plan" hidden={view !== "plan"} className="pt-3">
        <GoalOrder journeys={desk?.journeys ?? []} onChanged={onVerdictsChanged} onToast={setToast} />
        <div className="mt-3 rounded-[20px] border border-line bg-surface p-4">
          <DemoSteps desk={scopeDesk} />
          <div className="mt-3">
            <StatTiles desk={scopeDesk} compact filter={filter} onFilter={setFilter} />
          </div>
        </div>
        {!scopePending && Object.keys(changes).length > 0 ? (
          <p role="status" className="mt-3 flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] text-muted">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Drafts updating…
          </p>
        ) : null}
        <ApprovalBanner
          key={scope}
          className="mt-3"
          pending={scopePending}
          approver={desk?.approver ?? null}
          timeZone={tz}
          onChanged={load}
          demo={isDemoScope}
          verdictByDraft={verdictByDraft}
        />
        {isDemoScope ? null : <AskComposer className="mt-3" onAdded={load} />}
        <main className="mt-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="font-serif text-[26px] leading-none text-ink">
              {isDemoScope ? "Demo events" : "Your events"}{" "}
              <span className="font-sans text-[14px] text-muted tabular">{scopeAsks.length > 0 ? `· ${scopeAsks.length}` : ""}</span>
            </h2>
            {isDemoScope ? null : <LiveControls onChanged={load} onToast={setToast} />}
          </div>
          {scopeAsks.length > 0 ? planSwitch(scopeAsks) : null}
          <div aria-live="polite" aria-relevant="additions" className="mt-3">
            {isFirstPaint ? (
              [0, 1].map((i) => (
                <div key={i} aria-hidden className="mb-3">
                  <SkeletonCard />
                </div>
              ))
            ) : scopeAsks.length === 0 ? (
              isDemoScope ? (
                <p className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-5 py-8 text-center text-[14px] text-muted">
                  Nothing asked yet. Press Run demo to start.
                </p>
              ) : (
                <EmptyState inbox={inbox} desk={desk} />
              )
            ) : (
              cardsFor(scopeAsks)
            )}
          </div>
        </main>
      </section>

      {/* ---------- GOALS: order and boundaries ---------- */}
      <section role="tabpanel" id="section-goals" aria-labelledby="nav-goals" hidden={view !== "goals"} className="space-y-4 pt-4">
        <div className="rounded-[20px] border border-line bg-surface p-4">
          <GoalOrder journeys={desk?.journeys ?? []} onChanged={onVerdictsChanged} onToast={setToast} stacked />
        </div>
        <BoundariesPanel boundaries={desk?.boundaries ?? []} />
        <InboxLine inbox={inbox} />
      </section>

      {/* ---------- ACTIVITY: what happened, follow-ups, proactive check ---------- */}
      {SHOW_WEEK ? (
        <section role="tabpanel" id="section-week" aria-labelledby="nav-week" hidden={view !== "week"} className="pt-4">
          {view === "week" ? <WeekView asks={scopeAsks} timeZone={tz} commitments={desk?.commitments ?? null} /> : null}
        </section>
      ) : null}

      <section role="tabpanel" id="section-activity" aria-labelledby="nav-activity" hidden={view !== "activity"} className="pt-4">
        <div className="grid gap-4 md:grid-cols-2">
          <WeekLedger ledger={desk?.ledger ?? null} />
          {(desk?.outcomes ?? []).length > 0 ? (
            <OutcomesPanel outcomes={desk?.outcomes ?? []} />
          ) : (
            <p className="rounded-xl border border-line bg-surface p-4 text-[13.5px] text-muted">No ratings yet.</p>
          )}
          <ProactivePanel timeZone={tz} />
          <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <p className="text-[13.5px] text-ink">Jump to tomorrow and ask how each yes went.</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={timeSkip}
                disabled={skipBusy}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-action px-4 text-[14px] font-semibold text-action-ink transition hover:bg-black disabled:opacity-60"
              >
                Skip to tomorrow (demo)
                <ArrowRight aria-hidden className="size-4" />
              </button>
              {showTimeSkipBadge ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper px-2.5 py-1 text-[12px] font-semibold text-ink">
                  <FlaskConical aria-hidden className="size-3.5" />
                  time-skip (demo)
                </span>
              ) : null}
            </div>
            {skipNote ? (
              <p role="status" className="text-[13px] text-ink">
                {skipNote}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
      <ChatLauncher open={chatOpen} onToggle={() => setChatOpen((o) => !o)} />
      <Toast text={toast} onDone={clearToast} />

      {/* ---------- footer ---------- */}
      <footer className="mt-10 border-t border-line pt-5 text-[12.5px] leading-relaxed text-muted">
        <p>Models via Neon AI Gateway · research by Exa · mail by AgentMail · agent by Mastra · UI by assistant-ui</p>
        <p className="mt-1">Demo persona and demo inboxes. Nothing real is booked.</p>
      </footer>
    </div>
  );
}
