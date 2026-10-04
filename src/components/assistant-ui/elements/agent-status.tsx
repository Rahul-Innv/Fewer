"use client";

/** assistant-ui Elements: Agent status (registry item `elements-agent-status`), recolored to Fewer AA roles. */

import type { ComponentProps, ReactNode } from "react";
import { CheckIcon, PauseIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono, paper } from "./surfaces";

export type AgentState = "working" | "waiting" | "done" | "failed";

export interface StatusStep {
  state: AgentState;
  label: string;
}

export function AgentStatus({
  state,
  label,
  elapsed,
  trailing,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children" | "state" | "label" | "elapsed"> & {
  state: AgentState;
  label: string;
  elapsed?: string | undefined;
  trailing?: ReactNode | undefined;
}) {
  return (
    <span
      data-slot="agent-status"
      className={cn(
        paper,
        "inline-flex items-center gap-2 rounded-full py-1.5 ps-3 pe-3.5 has-[[data-slot=agent-status-trailing]]:pe-1.5",
        className,
      )}
      {...props}
    >
      {state === "done" ? (
        <CheckIcon aria-hidden className="size-3 shrink-0 text-yes-fg" />
      ) : state === "failed" ? (
        <XIcon aria-hidden className="text-destructive size-3 shrink-0" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full motion-reduce:animate-none",
            state === "working"
              ? "live-dot bg-focus"
              : "border-askone-accent border-[1.5px] size-2",
          )}
        />
      )}
      <span className="sr-only">{state}</span>
      <span
        key={label}
        className="status-in max-w-56 truncate text-[12.5px] font-medium text-ink"
      >
        {label}
      </span>
      {elapsed !== undefined && state !== "done" && state !== "failed" && (
        <span className={cn(mono, "text-[11.5px] text-muted tabular-nums")}>
          {elapsed}
        </span>
      )}
      {/* Fewer: pass trailing={null} to drop the slot when there is no pause/retry control behind it. */}
      {trailing === null ? null : (
        <span
          aria-hidden
          data-slot="agent-status-trailing"
          className="flex size-6 items-center justify-center rounded-full text-muted"
        >
          {trailing !== undefined ? (
            trailing
          ) : state === "done" || state === "failed" ? (
            <RotateCcwIcon className="size-3" />
          ) : (
            <PauseIcon className="size-3" />
          )}
        </span>
      )}
    </span>
  );
}
