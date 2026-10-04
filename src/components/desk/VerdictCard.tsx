"use client";

import { useId, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  CircleHelp,
  Clock,
  HandHelping,
  Hourglass,
  Mail,
  PauseCircle,
  Send,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { AskCardData, CardStatus, FitLine } from "./types";
import { RULE_NAMES, VERDICTS, ruleShortName } from "./tokens";
import { clockTime, formatHours, relativeTime, savedHoursForSmaller, whenLabel } from "./format";

const STATUS_STYLE: Record<CardStatus, { icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; cls: string }> = {
  awaiting: { icon: Hourglass, cls: "bg-askone-bg text-askone-fg" },
  sent: { icon: BadgeCheck, cls: "bg-yes-bg text-yes-fg" },
  held: { icon: PauseCircle, cls: "bg-no-bg text-no-fg" },
  blocked: { icon: ShieldAlert, cls: "bg-blocked-bg text-blocked-fg" },
  working: { icon: Clock, cls: "bg-paper text-muted border border-line" },
  error: { icon: TriangleAlert, cls: "bg-warn-bg text-warn-fg" },
};

/** End a sentence with a period unless it already ends in punctuation. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.?!…”"]$/.test(t) ? t : `${t}.`;
}

/** The one "why" sentence next to the verdict word. Built only from fields /api/desk already sends. */
function whyFor(card: AskCardData, ruleName: string | null): string {
  const h = card.costHours;
  const fallback = ruleName ?? card.reasons[0] ?? "";
  switch (card.verdict) {
    case "SMALLER": {
      const saved = h != null ? `Saves ~${formatHours(savedHoursForSmaller(h, card.smallerOffer))}h.` : "";
      const text = [saved, card.smallerOffer ? sentence(card.smallerOffer) : ""].filter(Boolean).join(" ");
      return text || fallback;
    }
    case "NO":
      if (h == null) return fallback;
      return sentence(card.pushesOut ? `${formatHours(h)}h protected for ${card.pushesOut}` : `${formatHours(h)}h protected`);
    case "ASK_ONE":
      return card.question ? sentence(card.question) : fallback;
    case "BLOCKED":
      return ruleName ?? fallback;
    case "YES":
    case "WILDCARD": {
      const fit = card.fits.find((f) => f.score > 0 && f.reason) ?? card.fits.find((f) => f.reason);
      return fit ? sentence(fit.reason) : fallback;
    }
    default:
      return "";
  }
}

function Pips({ score, effective }: { score: number; effective?: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-3.5 rounded-full ${i <= score ? "bg-ink" : "bg-line-strong/60"} ${
            effective != null && effective < score && i > effective && i <= score ? "opacity-40" : ""
          }`}
        />
      ))}
    </span>
  );
}

function FitRow({ fit }: { fit: FitLine }) {
  return (
    <li className="text-[13px] leading-snug">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-ink">
          {fit.rank != null ? <span className="mr-1 text-muted tabular">#{fit.rank}</span> : null}
          {fit.title}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted tabular">
          <Pips score={fit.score} effective={fit.effective} />
          <span>
            <span className="sr-only">fit </span>
            {fit.score}/3
          </span>
        </span>
      </div>
      {fit.reason ? <p className="mt-0.5 text-muted">“{fit.reason}”</p> : null}
      {fit.effective != null ? (
        <p className="mt-0.5 text-[12px] text-muted">Rules used {fit.effective}/3 after what you told Fewer before.</p>
      ) : null}
    </li>
  );
}

function CostBar({ card }: { card: AskCardData }) {
  const v = card.verdict ? VERDICTS[card.verdict] : null;
  if (!v || card.costHours == null || card.verdict === "BLOCKED" || card.verdict === "ASK_ONE") return null;
  const hours = card.costHours;
  const pct = Math.min(100, Math.max(6, (hours / 4) * 100));
  const protectedNo = card.verdict === "NO";
  const label = protectedNo ? `${formatHours(hours)}h protected` : `−${formatHours(hours)}h`;
  return (
    <div className="mt-4">
      <div
        className="h-2 overflow-hidden rounded-full bg-paper"
        role="img"
        aria-label={`${protectedNo ? "Protects" : "Costs"} ${formatHours(hours)} hours of a 4 hour scale`}
      >
        <div className="h-full rounded-full bg-muted" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] text-ink tabular">
        <span className="font-semibold">{label}</span>
        {/* NO and SMALLER already say this in the verdict line. */}
        {card.pushesOut && !protectedNo && card.verdict !== "SMALLER" ? (
          <span className="text-muted">
            {" · "}pushes out: <span className="text-ink">{card.pushesOut}</span>
          </span>
        ) : null}
      </p>
    </div>
  );
}

function EvidenceChips({ card }: { card: AskCardData }) {
  if (card.evidence.length === 0) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
        <CircleHelp aria-hidden className="size-3.5" />
        No outside sources found for this ask.
      </p>
    );
  }
  return (
    <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Evidence">
      {card.evidence.map((e) => (
        <li
          key={e.domain}
          title={e.claim}
          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] ${
            e.verified
              ? "border border-yes-accent/40 bg-yes-bg/60 text-yes-fg"
              : "border border-dashed border-line-strong bg-paper text-muted"
          }`}
        >
          {e.verified ? <BadgeCheck aria-hidden className="size-3.5" /> : <CircleHelp aria-hidden className="size-3.5" />}
          <span className="font-mono text-[11.5px]">{e.domain}</span>
          <span aria-hidden>·</span>
          <span>{e.verified ? "verified" : "unverified, couldn’t check"}</span>
        </li>
      ))}
    </ul>
  );
}

export function VerdictCard({ card, timeZone, isNew }: { card: AskCardData; timeZone: string; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  // Was a verdict already on this card when it first rendered? Decides when the landing animation waits for card-in.
  const [hadVerdictAtMount] = useState(card.verdict !== null);
  const draftId = useId();
  const titleId = useId();
  const v = card.verdict ? VERDICTS[card.verdict] : null;
  const st = STATUS_STYLE[card.status];
  const StatusIcon = st.icon;
  const when = whenLabel(card.startsAt, card.durationMin, timeZone);
  const sender = card.fromName ? `${card.fromName} <${card.from}>` : card.from;
  const ruleName = card.rule ? (RULE_NAMES[card.rule] ?? null) : null;
  const ruleShort = ruleShortName(card.rule);
  const why = whyFor(card, ruleName);
  // "The verdict lands": plays once, for a card that arrives with a verdict (isNew) or when a verdict arrives on a card already shown.
  const landing = card.verdict !== null && (isNew || !hadVerdictAtMount);
  const landStyle = { "--land-lead": hadVerdictAtMount ? "380ms" : "0ms" } as React.CSSProperties;
  // The verdict line already shows these, so the boxes below would repeat them word for word.
  const questionInHero = card.verdict === "ASK_ONE";
  const offerInHero = card.verdict === "SMALLER";
  const hideFooter = !card.verdict && card.status === "error";
  // The fit lines are shown in "model suggests"; drop the echo from the rule reasons.
  const ruleReasons = card.reasons.filter((r) => !/^Advances /.test(r));
  const shownFits = card.fits.filter((f) => f.score > 0).slice(0, 3);

  return (
    <article
      aria-labelledby={titleId}
      style={landing ? landStyle : undefined}
      className={`relative overflow-hidden rounded-xl border border-line bg-surface pl-[5px] shadow-[0_1px_0_rgba(27,31,35,0.03)] ${
        isNew ? "card-in" : ""
      }`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[5px] ${v ? v.bar : "bg-line-strong"} ${landing ? "verdict-edge" : ""}`}
      />
      <div className="p-4 sm:p-5">
        <header className="flex items-center justify-between gap-x-4">
          {card.rule ? (
            <p
              className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted"
              title={ruleName ?? undefined}
            >
              {card.rule}
              {ruleShort ? ` · ${ruleShort}` : ""}
            </p>
          ) : (
            <span />
          )}
          <time dateTime={card.receivedAt} className="shrink-0 text-[12px] text-muted tabular">
            {relativeTime(card.receivedAt)}
          </time>
        </header>

        {/* Verdict first: the word is the loudest thing on the card, the why is one sentence. */}
        {v && card.verdict ? (
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1" title={v.meaning}>
            <span className={`font-serif text-[32px] leading-none ${v.text} ${landing ? "verdict-word" : ""}`}>
              <span className="sr-only">Verdict: </span>
              {v.word}
            </span>
            {why ? (
              <span className={`text-[14px] leading-snug text-ink ${landing ? "verdict-why" : ""}`}>{why}</span>
            ) : null}
          </p>
        ) : card.status === "error" ? (
          <p className="mt-3 flex min-h-8 items-center gap-2 text-[13px] text-ink">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn-fg" />
            Couldn’t finish this one. Nothing was sent.
          </p>
        ) : (
          <p className="mt-3 flex min-h-8 items-center gap-3 text-muted">
            <span aria-hidden className="live-dot inline-block size-2.5 shrink-0 rounded-full bg-focus" />
            <span className="font-serif text-[24px] italic leading-none">Reading…</span>
          </p>
        )}

        <div className="mt-3 min-w-0">
          <h3 id={titleId} className="text-[17px] font-semibold leading-snug tracking-tight text-ink">
            {card.title}
          </h3>
          {sender ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
              <Mail aria-hidden className="size-3.5" />
              <span className="break-all">{sender}</span>
            </p>
          ) : null}
          {when || card.inPerson != null ? (
            <p className="mt-0.5 text-[13px] text-muted">
              {when}
              {when && card.inPerson != null ? " · " : ""}
              {card.inPerson != null ? (card.inPerson ? "in person" : "remote") : ""}
            </p>
          ) : null}
        </div>

        {card.verdict ? (
          <div className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
            <section aria-label="Model suggests">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Model suggests</h4>
              {shownFits.length > 0 ? (
                <ul className="space-y-2.5">
                  {shownFits.map((f) => (
                    <FitRow key={f.journeyId} fit={f} />
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">No link to your 3 journeys.</p>
              )}
            </section>
            <section aria-label="Rules decide">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Rules decide</h4>
              <p className="text-[13px] font-medium leading-snug text-ink">
                <span className="mr-1.5 rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] text-action-ink">{card.rule}</span>
                {ruleName}
              </p>
              {ruleReasons.length > 0 ? (
                <ul className="mt-1.5 space-y-1 text-[13px] leading-snug text-muted">
                  {ruleReasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-line-strong" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        ) : null}

        {card.question && !questionInHero ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-askone-bg px-3 py-2 text-[13.5px] text-askone-fg">
            <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold">Fewer will ask: </span>
              {card.question}
            </span>
          </p>
        ) : null}
        {card.smallerOffer && !offerInHero ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-smaller-bg px-3 py-2 text-[13.5px] text-smaller-fg">
            <HandHelping aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-semibold">Counter-offer: </span>
              {card.smallerOffer}
            </span>
          </p>
        ) : null}

        <CostBar card={card} />
        {card.verdict && card.verdict !== "BLOCKED" ? <EvidenceChips card={card} /> : null}

        {card.draft ? (
          <div className="mt-4">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={draftId}
              onClick={() => setOpen((o) => !o)}
              className="group inline-flex items-center gap-1.5 rounded-md py-1 text-[13px] font-medium text-ink hover:text-focus"
            >
              <ChevronDown
                aria-hidden
                className={`size-4 text-muted transition-transform group-hover:text-focus ${open ? "rotate-0" : "-rotate-90"}`}
              />
              Draft reply
              <span className="font-normal text-muted">to {card.draft.to}</span>
            </button>
            {open ? (
              <div id={draftId} className="mt-1.5 rounded-lg border border-line bg-paper px-4 py-3">
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{card.draft.body}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {hideFooter ? null : (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper/60 px-4 py-2.5 sm:px-5">
          <p className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium ${st.cls}`}>
            <StatusIcon aria-hidden className="size-3.5" />
            {card.statusLabel}
            {card.status === "sent" && card.sentAt ? (
              <span className="font-normal tabular"> · {clockTime(card.sentAt, timeZone)}</span>
            ) : null}
          </p>
          {card.outcome ? (
            <p className="text-[13px] text-ink">
              <Send aria-hidden className="mr-1 inline size-3.5 text-muted" />
              <span className="font-semibold tabular">Rated {card.outcome.rating}/5</span>
              {card.outcome.note ? <span className="text-muted"> — “{card.outcome.note}”</span> : null}
            </p>
          ) : card.checkinSent ? (
            <p className="text-[13px] text-muted">
              Check-in sent. Waiting for a 1–5.
            </p>
          ) : null}
        </footer>
      )}
    </article>
  );
}
