export function formatHours(h: number): string {
  const rounded = Math.round(h * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.round((now - t) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.round(diff / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function clockTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
}

export function whenLabel(iso: string | null, durationMin: number | null, timeZone?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let day: string;
  let time: string;
  try {
    day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
    time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const dur = durationMin ? ` · ${durationMin >= 60 ? `${formatHours(durationMin / 60)}h` : `${durationMin} min`}` : "";
  return `${day} · ${time}${dur}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Hours saved by the smaller version: the ask's hours minus what the smaller offer costs. */
export function savedHoursForSmaller(hours: number, smallerOffer: string | null | undefined): number {
  let keptHours = 0.5;
  const m = smallerOffer ? /(\d+)\s*min/i.exec(smallerOffer) : null;
  if (m) keptHours = Number(m[1]) / 60;
  else if (smallerOffer && /question/i.test(smallerOffer)) keptHours = 0.25;
  return Math.max(0, hours - keptHours);
}
