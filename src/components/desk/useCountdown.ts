"use client";

import { useEffect, useState } from "react";

export type Countdown = {
  /** Milliseconds until expiry, or null when there is no (valid) expiry. */
  remainingMs: number | null;
  /** 1 at the start of the window, draining to 0 at expiry; null when there is no expiry. */
  fraction: number | null;
  expired: boolean;
};

/**
 * Counts down to the real approval expires_at (server timestamp, ticks once a second).
 * The bar's full width is the approval's real window (createdAt to expiresAt) when that is
 * known, and never less than what was left when this component mounted, so clock skew
 * between server and browser cannot push the fraction above 1.
 */
export function useCountdown(expiresAt: string | null, createdAt?: string | null): Countdown {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);

  const end = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const hasExpiry = Number.isFinite(end);
  const remaining = hasExpiry ? Math.max(0, end - now) : null;
  const expired = remaining !== null && remaining <= 0;

  useEffect(() => {
    if (!hasExpiry || expired) return;
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 1000);
    // Background tabs throttle timers; catch up the moment the tab is visible again.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [hasExpiry, expired]);

  if (remaining === null) return { remainingMs: null, fraction: null, expired: false };

  const start = createdAt ? Date.parse(createdAt) : Number.NaN;
  const windowMs = Number.isFinite(start) ? end - start : 0;
  const total = Math.max(windowMs, Math.max(0, end - t0));
  const fraction = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  return { remainingMs: remaining, fraction, expired };
}
