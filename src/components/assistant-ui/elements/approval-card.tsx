"use client";

/**
 * assistant-ui Elements: Approval card (registry item `elements-approval-card`), used STANDALONE:
 * the caller owns `state` and answers the callbacks. Adapted for Fewer:
 * - colors are Fewer roles (AA-checked in src/components/desk/tokens.test.ts), not foreground/45 tints;
 * - extra slots: `aside` (header right), `progress` (under the header), `children` (body),
 *   `footer` (replaces actions and receipt), `footnote` (below the actions);
 * - `statusTone` colors the receipt (yes / no / warn).
 */

import { useId, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, Loader2Icon, PauseIcon, TerminalIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { field, inkButton, mono, paper } from "./surfaces";

export type ApprovalState = "request" | "running" | "done" | "denied";
export type ApprovalTone = "yes" | "no" | "warn";

const receiptText: Record<Exclude<ApprovalState, "request">, string> = {
  running: "Approved, running",
  done: "Finished",
  denied: "Denied",
};

const toneStyle: Record<ApprovalTone, { box: string; Icon: typeof CheckIcon }> = {
  yes: { box: "border-yes-accent/40 bg-yes-bg text-yes-fg", Icon: CheckIcon },
  no: { box: "border-no-accent/40 bg-no-bg text-no-fg", Icon: PauseIcon },
  warn: { box: "border-smaller-accent/40 bg-warn-bg text-warn-fg", Icon: TriangleAlertIcon },
};

const pressable =
  "transition-transform duration-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none";

export function ApprovalCard({
  state,
  command,
  title,
  subtitle,
  description,
  details,
  variant = "default",
  icon,
  onAllowOnce,
  onAlwaysAllow,
  onDeny,
  allowOnceLabel = "Allow once",
  alwaysAllowLabel = "Always allow",
  denyLabel = "Deny",
  statusLabel,
  statusTone,
  aside,
  progress,
  footer,
  footnote,
  children,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  | "children"
  | "state"
  | "command"
  | "title"
  | "subtitle"
  | "description"
  | "details"
  | "variant"
  | "icon"
  | "onAllowOnce"
  | "onAlwaysAllow"
  | "onDeny"
  | "allowOnceLabel"
  | "alwaysAllowLabel"
  | "denyLabel"
  | "statusLabel"
> & {
  state: ApprovalState;
  command?: string | undefined;
  title: string;
  subtitle: string;
  description?: string | undefined;
  details?: readonly { label: string; value: string }[] | undefined;
  variant?: "default" | "destructive" | "inactive" | undefined;
  icon?: ReactNode | undefined;
  onAllowOnce?: (() => void) | undefined;
  onAlwaysAllow?: (() => void) | undefined;
  onDeny?: (() => void) | undefined;
  allowOnceLabel?: string | undefined;
  alwaysAllowLabel?: string | undefined;
  denyLabel?: string | undefined;
  statusLabel?: string | undefined;
  /** Receipt color for non-request states. Defaults: done = yes, denied = no. */
  statusTone?: ApprovalTone | undefined;
  /** Header, right side (for example a countdown pill). */
  aside?: ReactNode;
  /** Full-bleed row under the header (for example a draining bar). */
  progress?: ReactNode;
  /** Replaces the actions / receipt row entirely (for example an "expired" notice). */
  footer?: ReactNode;
  /** Small print under the actions. */
  footnote?: ReactNode;
  /** Body, between the description and the actions. */
  children?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const tone: ApprovalTone = statusTone ?? (state === "denied" ? "no" : "yes");
  const inactive = variant === "inactive";

  return (
    <div
      {...props}
      role="group"
      data-variant={variant}
      data-state={state}
      data-slot="approval-card"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(paper, "flex w-full flex-col overflow-hidden rounded-[20px]", className)}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <span
          aria-hidden
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            variant === "destructive"
              ? "bg-blocked-bg text-blocked-fg"
              : inactive
                ? "bg-no-bg text-no-fg"
                : "bg-ink text-action-ink",
          )}
        >
          {icon ?? <TerminalIcon className="size-4" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p id={titleId} className="text-[15px] font-semibold leading-snug text-ink">
            {title}
          </p>
          <p className="text-[13px] text-muted">{subtitle}</p>
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>

      {progress}

      <div className="flex flex-col gap-3.5 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
        {description ? (
          <p id={descriptionId} className="text-[13px] text-muted">
            {description}
          </p>
        ) : null}

        {command ? (
          <div className={cn(field, "rounded-xl px-3.5 py-2.5 font-mono text-xs text-ink")}>{command}</div>
        ) : null}

        {details?.length ? (
          <dl className={cn(field, "flex flex-col gap-2 rounded-xl px-3.5 py-2.5")}>
            {details.map((detail, index) => (
              <div key={`${detail.label}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 text-xs">
                <dt className={cn(mono, "text-muted")}>{detail.label}</dt>
                <dd className="break-words text-ink">{detail.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {children}

        {footer !== undefined ? (
          footer
        ) : (
          <div className="flex min-h-9 flex-wrap items-center justify-end gap-2">
            {state === "request" ? (
              <>
                {onDeny && (
                  <button
                    type="button"
                    onClick={onDeny}
                    className={cn(
                      pressable,
                      "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-3.5 text-[13.5px] font-medium text-ink hover:bg-paper",
                    )}
                  >
                    <PauseIcon aria-hidden className="size-4" />
                    {denyLabel}
                  </button>
                )}
                {onAlwaysAllow && (
                  <button
                    type="button"
                    onClick={onAlwaysAllow}
                    className={cn(
                      pressable,
                      "inline-flex h-9 items-center whitespace-nowrap rounded-lg px-3.5 text-[13.5px] font-medium text-ink hover:bg-paper",
                    )}
                  >
                    {alwaysAllowLabel}
                  </button>
                )}
                {onAllowOnce && (
                  <button
                    type="button"
                    onClick={onAllowOnce}
                    className={cn(
                      variant === "destructive" ? "bg-blocked-accent text-white hover:bg-blocked-fg" : inkButton,
                      pressable,
                      "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13.5px] font-semibold",
                    )}
                  >
                    <CheckIcon aria-hidden className="size-4" />
                    {allowOnceLabel}
                  </button>
                )}
              </>
            ) : state === "running" ? (
              <div key={state} role="status" className="flex items-center gap-2 text-[13.5px] text-muted">
                <Loader2Icon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                {statusLabel ?? receiptText.running}
              </div>
            ) : (
              <ReceiptPill tone={tone} text={statusLabel ?? receiptText[state]} />
            )}
          </div>
        )}

        {footnote}
      </div>
    </div>
  );
}

function ReceiptPill({ tone, text }: { tone: ApprovalTone; text: string }) {
  const { box, Icon } = toneStyle[tone];
  return (
    <p
      role="status"
      className={cn("receipt-in flex w-full items-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] font-medium", box)}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {text}
    </p>
  );
}
