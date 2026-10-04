"use client";

import { useId, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "added" } | { kind: "error"; message: string };

/**
 * "Add an ask": paste an invite or request and Fewer decides it, the same as an email to its inbox.
 * Posts to /api/asks; the new card appears through the Desk's normal polling ("Reading..." first).
 */
export function AskComposer({ onAdded }: { onAdded?: () => void }) {
  const textId = useId();
  const emailId = useId();
  const [text, setText] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const sending = status.kind === "sending";
  const canSend = text.trim().length > 0 && !sending;

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
      className="rounded-xl border border-line bg-surface p-4 shadow-[0_1px_0_var(--color-line)]"
    >
      <label htmlFor={textId} className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        Add an ask
      </label>
      <textarea
        id={textId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e as unknown as React.FormEvent);
        }}
        rows={3}
        maxLength={5000}
        placeholder="Paste an invite or request…"
        className="w-full resize-y rounded-lg border border-line bg-paper px-3 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-muted focus-visible:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
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
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex items-center gap-1.5 rounded-lg bg-action px-4 py-2 text-sm font-semibold text-action-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {sending ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {sending ? "Adding…" : "Decide"}
          {!sending ? <ArrowRight aria-hidden className="size-4" /> : null}
        </button>
      </div>
      <p aria-live="polite" className="mt-2 min-h-[1.25rem] text-[13px]">
        {status.kind === "added" ? <span className="text-muted">Added. Fewer is reading it now.</span> : null}
        {status.kind === "error" ? <span className="text-blocked-fg">{status.message}</span> : null}
        {status.kind === "idle" && !fromEmail ? (
          <span className="text-muted">No email? Fewer drafts a reply you can copy. Nothing is sent without your yes.</span>
        ) : null}
      </p>
    </form>
  );
}
