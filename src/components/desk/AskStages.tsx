"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentPlan } from "@/components/assistant-ui/elements/agent-plan";
import { announced, pct, progressOf } from "@/components/assistant-ui/utils/range";
import type { AskCardData } from "./types";
import { stagesFor, type StageModel } from "./stages";

/**
 * Per-ask pipeline rail: received -> reading -> checking sources -> decided -> drafted ->
 * awaiting your yes -> sent. Same progress model as the assistant-ui Agent plan element
 * (activeIndex, progressOf/pct/announced), laid out horizontally to fit a card footer.
 */
export function StageRail({ card, sentTime }: { card: AskCardData; sentTime?: string | null }) {
  const m = stagesFor(card);
  const total = m.steps.length;
  const completed = progressOf(m.activeIndex, total);
  const progress = pct(completed, total);
  const allDone = completed >= total;

  return (
    <div className="min-w-0 flex-1">
      <div
        role="progressbar"
        aria-label="Where this ask is"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={announced(progress)}
        aria-valuetext={`${m.current.replace(/\.$/, "")}. Step ${Math.min(completed + 1, total)} of ${total}.`}
      >
        <ol className="flex items-start">
          {m.steps.map((label, i) => {
            const done = allDone || i < completed;
            const active = !allDone && i === completed;
            const isLast = i === total - 1;
            const shown = isLast && label === "Sent" && done && sentTime ? `Sent · ${sentTime}` : label;
            return (
              <li key={label} className="flex min-w-0 flex-1 flex-col items-center last:flex-none sm:last:flex-1">
                <div className="flex h-4 w-full items-center">
                  <span className={cn("h-px flex-1", i === 0 ? "opacity-0" : done || active ? "bg-ink/70" : "bg-line-strong")} />
                  <StageDot done={done} active={active} tone={m.tone} stopped={isLast && done && m.tone === "stopped"} />
                  <span className={cn("h-px flex-1", isLast ? "opacity-0" : done ? "bg-ink/70" : "bg-line-strong")} />
                </div>
                <span
                  className={cn(
                    "mt-1.5 hidden max-w-full truncate px-0.5 text-center text-[11px] leading-tight sm:block",
                    active ? "font-semibold text-ink" : "text-muted",
                  )}
                >
                  {shown}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-1.5 text-[12px] text-muted tabular-nums sm:hidden">
        <span className="font-semibold text-ink">{m.current}</span> · {Math.min(completed + (allDone ? 0 : 1), total)} of {total}
      </p>
    </div>
  );
}

function StageDot({
  done,
  active,
  tone,
  stopped,
}: {
  done: boolean;
  active: boolean;
  tone: StageModel["tone"];
  stopped: boolean;
}) {
  if (done) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full text-white",
          stopped ? "bg-no-accent" : "bg-ink",
        )}
      >
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (active && tone === "failed") {
    return (
      <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-full bg-blocked-accent text-white">
        <X className="size-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (active) {
    return (
      <span
        aria-hidden
        className={cn(
          "size-4 shrink-0 rounded-full border-2 bg-surface",
          tone === "waiting" ? "live-dot border-askone-accent" : "live-dot border-focus",
        )}
      />
    );
  }
  return <span aria-hidden className="size-2 shrink-0 rounded-full bg-line-strong" />;
}

/** While an ask has no verdict yet: the assistant-ui Agent plan element, as a checklist Fewer works through. */
export function ReadingPlan({ card }: { card: AskCardData }) {
  const m = stagesFor(card);
  return (
    <AgentPlan
      title="Fewer is working on it"
      steps={m.steps.slice(0, 4).map((label, i) => ({
        id: label,
        label,
        description:
          i === 1 ? "Who is asking, what, when, how long" : i === 2 ? "Checking the claims against outside sources" : undefined,
      }))}
      activeIndex={m.activeIndex}
      className="mt-4 max-w-md rounded-xl border border-line bg-paper/60 p-3.5"
    />
  );
}
