import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "./db";
import { deleteAsks } from "./demo";

/**
 * Local-only live-desk controls for the finals demo. Both refuse in production (Fly): the deployed
 * Desk can never be wiped by a visitor, and the week file is git-ignored and absent there.
 */

export function localOnly(): { ok: false; status: 403; error: string } | null {
  if (process.env.NODE_ENV === "production" || process.env.FLY_APP_NAME) {
    return { ok: false, status: 403, error: "Live reset and import run only on the local Desk." };
  }
  return null;
}

/**
 * Deletes copy-only LIVE asks (no deliverable sender: calendar imports and pastes) and their linked
 * rows. Keeps demo rows, journeys, boundaries, calendar_busy, and every live ask with a real sender
 * address (for example the owner's own coffee request), so real replies are never lost.
 */
export async function resetLive(): Promise<{ ok: true; deleted: number }> {
  const rows = await sql<{ id: string }[]>`
    select id from asks
    where inbox_message_id not like 'demo-%'
      and (from_email is null or from_email !~ '^[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+$')`;
  await deleteAsks(rows.map((r) => r.id));
  return { ok: true, deleted: rows.length };
}

type WeekEvent = { title: string; start: string; end: string; location?: string; hosts?: string; url?: string; status?: string };

const WEEK_FILE = () => path.join(process.cwd(), "private", "calendar", "week-events.json");

async function loadWeek(): Promise<WeekEvent[]> {
  const raw = JSON.parse(await readFile(WEEK_FILE(), "utf8")) as unknown;
  const list = Array.isArray(raw) ? raw : ((raw as { events?: unknown[] }).events ?? []);
  return (list as WeekEvent[]).filter((e) => e && e.title && e.start && e.end);
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

/** Same text format as private/calendar/submit-week.mjs. */
export function askTextFor(e: WeekEvent): string {
  const minutes = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000);
  return [
    `Invitation: ${e.title}.`,
    `When: ${fmt(e.start)} Pacific, for ${minutes} minutes (until ${fmt(e.end)}).`,
    e.location ? `Where: ${e.location}.` : "",
    e.hosts ? `Hosted by: ${e.hosts}.` : "",
    e.url ? `Event page: ${e.url}` : "",
    e.status ? `My RSVP status: ${e.status.toLowerCase()}.` : "",
    "It is an in-person Tech Week event in San Francisco.",
  ].filter(Boolean).join(" ");
}

let importing = false;

/** Checks the file and returns how many events will arrive; the inserts run in runImportWeek(). */
export async function startImportWeek(): Promise<{ ok: true; total: number } | { ok: false; status: 409 | 412; error: string }> {
  if (importing) return { ok: false, status: 409, error: "An import is already running." };
  try {
    const events = await loadWeek();
    if (events.length === 0) return { ok: false, status: 412, error: "No events found in private/calendar/week-events.json." };
    return { ok: true, total: events.length };
  } catch {
    return { ok: false, status: 412, error: "private/calendar/week-events.json is missing on this machine." };
  }
}

/** One event per second as a copy-only "[Calendar] " ask; at most 6 triages run at once. */
export async function runImportWeek(staggerMs = 1_000, maxConcurrent = 6): Promise<void> {
  if (importing) return;
  importing = true;
  try {
    const { submitWebAsk, runWebAsk } = await import("./pipeline");
    const events = await loadWeek();
    let running = 0;
    const waiters: (() => void)[] = [];
    const acquire = async () => {
      while (running >= maxConcurrent) await new Promise<void>((r) => waiters.push(r));
      running += 1;
    };
    const release = () => {
      running -= 1;
      waiters.shift()?.();
    };
    const all: Promise<void>[] = [];
    for (const [i, e] of events.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, staggerMs));
      const { askId } = await submitWebAsk({ text: askTextFor(e), subject: `[Calendar] ${e.title}`.slice(0, 200) });
      all.push(
        (async () => {
          await acquire();
          try {
            await runWebAsk(askId);
          } catch (err) {
            console.error("[fewer/live] triage failed", askId, err);
          } finally {
            release();
          }
        })(),
      );
    }
    await Promise.all(all);
  } finally {
    importing = false;
  }
}

/** Progress for "12 of 64 events arrived". */
export async function importProgress(): Promise<{ inserted: number; total: number; running: boolean }> {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int as n from asks where subject like '[Calendar] %' and inbox_message_id not like 'demo-%'`;
  let total = 0;
  try {
    total = (await loadWeek()).length;
  } catch {
    total = 0;
  }
  return { inserted: r?.n ?? 0, total, running: importing };
}
