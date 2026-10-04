"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, FlaskConical, Inbox, MessageSquareText, TriangleAlert } from "lucide-react";
import type { Verdict } from "@/core/contracts";
import type { DeskData } from "./types";
import { VERDICTS } from "./tokens";
import { ApprovalBanner } from "./ApprovalBanner";
import { BoundariesPanel, JourneysPanel, OutcomesPanel, WeekLedger } from "./LeftColumn";
import { ProactivePanel } from "./ProactivePanel";
import { VerdictCard } from "./VerdictCard";
import { AskComposer } from "./AskComposer";
import { AgentNow } from "./AgentNow";
import { ChatDrawer } from "../chat/ChatDrawer";
import { clockTime, plural } from "./format";

const POLL_MS = 2500;

function EmptyState({ inbox, desk }: { inbox: string | null; desk: DeskData | null }) {
  const notConfigured = desk && !desk.configured;
  return (
    <section
      aria-labelledby="empty-h"
      className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center"
    >
      <h2 id="empty-h" className="font-serif text-[28px] leading-tight text-ink">
        Nothing asked of you yet.
      </h2>
      {inbox ? (
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface py-1 pl-3 pr-1.5">
          <span className="select-all font-mono text-[14px] text-ink">{inbox}</span>
          <CopyInbox inbox={inbox} />
        </p>
      ) : (
        <p className="mt-4 font-mono text-[14px] text-muted">Set FEWER_INBOX to show the address</p>
      )}
      <p className="mt-3 text-[14px] text-muted">Email it an ask. The verdict lands here.</p>
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

/** Left-to-right order of the "On the desk" counts (brief section 2, item 5). */
const COUNT_ORDER: Verdict[] = ["NO", "SMALLER", "ASK_ONE", "YES", "WILDCARD", "BLOCKED"];

/** Verdict counts over the asks currently on the desk. Counted from /api/desk asks, nothing invented. */
function DeskCounts({ asks }: { asks: DeskData["asks"] }) {
  const counts = COUNT_ORDER.map((verdict) => ({ verdict, n: asks.filter((a) => a.verdict === verdict).length })).filter(
    (c) => c.n > 0,
  );
  if (counts.length === 0) return null;
  return (
    <div role="group" aria-label="On the desk" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted tabular-nums">
      <span className="font-medium">On the desk</span>
      {counts.map(({ verdict, n }) => {
        const v = VERDICTS[verdict];
        return (
          <span key={verdict} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`size-2 rounded-full ${v.bar}`} />
            <span className={`font-semibold ${v.text}`}>{v.label}</span>
            <span>{n}</span>
          </span>
        );
      })}
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

  const firstLoad = useRef(true);
  // Ask ids present on the first load: those cards don't animate in. State, not a ref, because render reads it.
  const [initialIds, setInitialIds] = useState<Set<string> | null>(null);
  const announced = useRef<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/desk", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as DeskData;
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

  return (
    <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-10 pt-6 sm:px-6 sm:pt-8">
      {/* ---------- header ---------- */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-5">
        <div>
          <h1 className="font-serif text-[44px] leading-none tracking-tight text-ink sm:text-[52px]">Fewer</h1>
          <p className="mt-1.5 text-[15px] text-muted">Fewer yeses, better ones.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-line-strong bg-surface py-1.5 pl-3 pr-1.5">
            <Inbox aria-hidden className="size-4 text-muted" />
            <div className="leading-tight">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">Email asks to</p>
              <p className="font-mono text-[13.5px] text-ink select-all">{inbox ?? "set FEWER_INBOX"}</p>
            </div>
            {inbox ? <CopyInbox inbox={inbox} /> : null}
          </div>
          <button
            type="button"
            onClick={() => setChatOpen((o) => !o)}
            aria-expanded={chatOpen}
            aria-controls="ask-fewer-drawer"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-action px-4 text-[14px] font-semibold text-action-ink transition hover:bg-black"
          >
            <MessageSquareText aria-hidden className="size-4" />
            Ask Fewer
          </button>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <AgentNow desk={desk} offline={offline} />
        <p className="text-[12.5px] text-muted">
          {offline
            ? desk
              ? "Live updates paused."
              : "Reconnecting to the Desk…"
            : isFirstPaint
              ? "Loading the Desk…"
              : `Live for ${owner}. Updates every few seconds.`}
        </p>
      </div>

      {offline && desk ? (
        <p role="status" className="mt-3 rounded-lg bg-warn-bg px-3.5 py-2 text-[13px] text-warn-fg">
          Reconnecting… showing {clockTime(desk.now, tz)}
        </p>
      ) : null}

      {desk?.error ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-warn-bg px-3.5 py-2.5 text-[13.5px] text-warn-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {desk.error}
        </p>
      ) : null}

      <ApprovalBanner
        className="mt-5"
        pending={desk?.pending ?? null}
        approver={desk?.approver ?? null}
        timeZone={tz}
        onChanged={load}
        verdictByDraft={Object.fromEntries(asks.flatMap((a) => (a.draft ? [[a.draft.id, a.verdict]] : [])))}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ---------- left: this week ---------- */}
        <aside aria-label="This week" className="order-2 space-y-4 lg:order-1 lg:sticky lg:top-6 lg:self-start">
          <h2 className="font-serif text-[26px] leading-none text-ink">This week</h2>
          <WeekLedger ledger={desk?.ledger ?? null} />
          <JourneysPanel journeys={desk?.journeys ?? []} />
          <BoundariesPanel boundaries={desk?.boundaries ?? []} />
          <OutcomesPanel outcomes={desk?.outcomes ?? []} />
          <ProactivePanel timeZone={tz} />
        </aside>

        {/* ---------- main: verdict cards ---------- */}
        <main className="order-1 min-w-0 lg:order-2">
          <AskComposer onAdded={load} />
          <div className="mt-6" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-[26px] leading-none text-ink">
              Asks <span className="font-sans text-[14px] text-muted tabular">{asks.length > 0 ? `· ${asks.length}` : ""}</span>
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {showTimeSkipBadge ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-wildcard-accent/50 bg-wildcard-bg px-2.5 py-1 text-[11.5px] font-semibold text-wildcard-fg">
                  <FlaskConical aria-hidden className="size-3.5" />
                  time-skip (demo)
                </span>
              ) : null}
              <button
                type="button"
                onClick={timeSkip}
                disabled={skipBusy}
                title="Demo only: pretend it is tomorrow and send the check-ins now"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface px-3 text-[13px] font-medium text-ink transition hover:border-ink disabled:opacity-60"
              >
                Demo: skip to tomorrow
                <ArrowRight aria-hidden className="size-4" />
              </button>
            </div>
          </div>
          <DeskCounts asks={asks} />
          {skipNote ? (
            <p role="status" className="mt-2 text-[13px] text-muted">
              {skipNote}
            </p>
          ) : null}

          <div aria-live="polite" aria-relevant="additions" className="mt-4 space-y-4">
            {isFirstPaint ? (
              <div className="space-y-4" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : asks.length === 0 ? (
              <EmptyState inbox={inbox} desk={desk} />
            ) : (
              asks.map((card) => (
                <VerdictCard key={card.id} card={card} timeZone={tz} isNew={initialIds !== null && !initialIds.has(card.id)} />
              ))
            )}
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>
        </main>
      </div>

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />

      {/* ---------- footer ---------- */}
      <footer className="mt-12 border-t border-line pt-5 text-[12.5px] leading-relaxed text-muted">
        <p>Models via Neon AI Gateway · research by Exa · mail by AgentMail · agent by Mastra · UI by assistant-ui</p>
        <p className="mt-1">Demo persona and demo inboxes. Nothing real is booked.</p>
      </footer>
    </div>
  );
}
