"use client";

import { useState } from "react";
import type { FormEvent } from "react";

/** The Desk password gate. Tiny on purpose: one field, one button, same paper-and-ink look as the Desk. */
export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || password.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Full navigation so the new cookie rides on the very next request.
        window.location.replace("/");
        return;
      }
      const data: { error?: string } = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not sign in. Try again.");
    } catch {
      setError("Could not reach the server. Try again.");
    }
    setPending(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="font-serif text-[40px] leading-none text-ink">Fewer</h1>
      <p className="mt-2 text-[14px] text-muted">Fewer yeses, better ones. This Desk is private.</p>

      <form onSubmit={submit} className="mt-8 rounded-2xl border border-line bg-surface p-5" noValidate>
        <label htmlFor="desk-password" className="block text-[13.5px] font-medium text-ink">
          Desk password
        </label>
        <input
          id="desk-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "desk-password-error" : undefined}
          className="mt-2 h-11 w-full rounded-lg border border-muted bg-surface px-3 text-[15px] text-ink"
        />

        <p
          id="desk-password-error"
          role="alert"
          className={error ? "mt-3 rounded-lg bg-blocked-bg px-3 py-2 text-[13.5px] text-blocked-fg" : "sr-only"}
        >
          {error ?? ""}
        </p>

        <button
          type="submit"
          disabled={pending}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-action px-4 text-[14.5px] font-medium text-action-ink transition duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
        >
          {pending ? "Opening…" : "Open the Desk"}
        </button>
      </form>
    </main>
  );
}
