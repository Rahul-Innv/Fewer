"use client";

import { useEffect, useState } from "react";
import { AgentStatus } from "@/components/assistant-ui/elements/agent-status";
import type { DeskData } from "./types";
import { agentNow } from "./stages";

function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  return `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

/** assistant-ui Agent status pill: one line that always answers "what is Fewer doing, and for how long". */
export function AgentNow({ desk, offline }: { desk: DeskData | null; offline: boolean }) {
  const now = agentNow(desk, offline);
  const [tick, setTick] = useState<number | null>(null);

  useEffect(() => {
    if (!now.since) return;
    const update = () => setTick(Date.now());
    const first = setTimeout(update, 0);
    const t = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [now.since]);

  const since = now.since ? Date.parse(now.since) : Number.NaN;
  const elapsed = Number.isFinite(since) && tick !== null ? elapsedText(tick - since) : undefined;

  return (
    <>
      <AgentStatus state={now.state} label={now.label} elapsed={elapsed} trailing={null} aria-hidden />
      <span className="sr-only" role="status" aria-live="polite">
        {now.label}
      </span>
    </>
  );
}
