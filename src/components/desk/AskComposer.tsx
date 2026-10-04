"use client";

import { useId, useState } from "react";
import { ArrowRight, LoaderCircle, Plus } from "lucide-react";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "added" } | { kind: "error"; message: string };

/**
 * "Add an ask", compact: one row (ask + Decide). The sender email field appears once the row is in use.
 * Posts to /api/asks; the new card appears through the Desk's normal polling ("Reading..." first).
 */
export function AskComposer({ onAdded, className }: { onAdded?: () => void; className?: string }) {
  const textId = useId();
  const emailId = useId();
  const [text, setText] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [engaged, setEngaged] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const sending = status.kind === "sending";
  const canSend = text.trim().length > 0 && !sending;
  const open = engaged || text.length > 0 || fromEmail.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/asks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), fromEmail: fromEmail.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not add that ask.");
      setText("");
      setFromEmail("");
      setEngaged(false);
      setStatus({ kind: "added" });
      onAdded?.();
      setTimeout(() => setStatus((s) => (s.kind === "added" ? { kind: "idle" } : s)), 2500);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Could not add that ask." });
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Add an ask"
      onFocus={() => setEngaged(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEngaged(false);
      }}
      className={`rounded-xl border border-line bg-surface p-2.5 ${className ?? ""}`}
    >
      <div className="flex items-start gap-2">
        <label htmlFor={textId} className="sr-only">
          Add an ask: paste an invite or request
        </label>
        <span aria-hidden className="mt-2.5 hidden pl-1 text-muted sm:block">
          <Plus className="size-4" />
        </span>
        <textarea
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e as unknown as React.FormEvent);
          }}
          rows={open ? 3 : 1}
          maxLength={5000}
          placeholder="Add an ask: paste an invite or request…"
          className="min-h-10 min-w-0 flex-1 resize-none rounded-lg border border-line bg-paper px-3 py-2 text-[14.5px] leading-snug text-ink placeholder:text-muted focus-visible:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-action px-4 text-sm font-semibold text-action-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {sending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {sending ? "Adding…" : "Decide"}
          {!sending ? <ArrowRight aria-hidden className="size-4" /> : null}
        </button>
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 sm:pl-7">
          <label htmlFor={emailId} className="sr-only">
            Who&apos;s asking? (email, optional)
          </label>
          <input
            id={emailId}
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="Who's asking? (email, optional)"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          />
          {!fromEmail ? (
            <p className="w-full text-[12.5px] text-muted">No email? Fewer drafts a reply you can copy. Nothing is sent without your yes.</p>
          ) : null}
        </div>
      ) : null}
      <p aria-live="polite" className={status.kind === "idle" ? "sr-only" : "mt-1.5 px-1 text-[13px]"}>
        {status.kind === "added" ? <span className="text-muted">Added. Fewer is reading it now.</span> : null}
        {status.kind === "error" ? <span className="text-blocked-fg">{status.message}</span> : null}
      </p>
    </form>
  );
}
