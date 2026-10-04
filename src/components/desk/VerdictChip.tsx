import { Ban, Check, CircleHelp, Minus, ShieldAlert, Sparkles } from "lucide-react";
import type { Verdict } from "@/core/contracts";
import { VERDICTS } from "./tokens";

const ICONS = {
  YES: Check,
  WILDCARD: Sparkles,
  SMALLER: Minus,
  ASK_ONE: CircleHelp,
  NO: Ban,
  BLOCKED: ShieldAlert,
} as const;

/**
 * Solid verdict chip: white on the verdict accent (>= 4.5:1), icon + label (never color alone).
 * Solid fills keep their edge in compressed video where the pastel chip disappears.
 */
export function VerdictChip({ verdict, className = "" }: { verdict: Verdict; className?: string }) {
  const v = VERDICTS[verdict];
  const Icon = ICONS[verdict];
  return (
    <span
      title={v.meaning}
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold uppercase tracking-[0.04em] ${v.solid} ${className}`}
    >
      <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
      {v.label}
    </span>
  );
}
