import { z } from "zod";
import type { ParsedAsk, TakenBlock } from "../core";
import * as db from "./db";

/**
 * The owner's calendar as busy TIMES ONLY. Titles, locations and attendees are never accepted,
 * stored or returned. Blocks arrive via POST /api/calendar/busy; decide() sees them (and asks
 * Fewer already accepted) as `takenBlocks`, so an overlapping ask clashes (rule R1).
 */

export const MAX_BUSY_BLOCKS = 200;
export const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** POST replaces this source's rows starting in [now - 1 day, now + 14 days]. */
export const REPLACE_BACK_MS = DAY_MS;
export const REPLACE_AHEAD_MS = 14 * DAY_MS;

export type BusyBlock = { start: string; end: string; source: string };

const IsoWithOffset = z.iso.datetime({ offset: true });
const SourceSchema = z.string().regex(/^[a-z0-9_-]{1,32}$/i);

export type BusyPayload =
  | { ok: true; source: string; blocks: { start: string; end: string }[] }
  | { ok: false; error: string };

/** Validates a POST body: {blocks:[{start,end}], source?}. Pure. Extra block fields are dropped. */
export function parseBusyPayload(body: unknown): BusyPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a JSON object." };
  const b = body as Record<string, unknown>;
  let source = "google";
  if (b.source !== undefined) {
    const s = SourceSchema.safeParse(b.source);
    if (!s.success) return { ok: false, error: "source must be 1-32 letters, digits, '-' or '_'." };
    source = s.data.toLowerCase();
  }
  if (!Array.isArray(b.blocks)) return { ok: false, error: "blocks must be an array of {start, end}." };
  if (b.blocks.length > MAX_BUSY_BLOCKS) return { ok: false, error: `At most ${MAX_BUSY_BLOCKS} blocks.` };
  const blocks: { start: string; end: string }[] = [];
  for (const [i, raw] of b.blocks.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `blocks[${i}] must be {start, end}.` };
    const { start, end } = raw as Record<string, unknown>;
    if (!IsoWithOffset.safeParse(start).success || !IsoWithOffset.safeParse(end).success) {
      return { ok: false, error: `blocks[${i}]: start and end must be ISO date-times with an offset or Z.` };
    }
    const s = Date.parse(start as string);
    const e = Date.parse(end as string);
    if (!(e > s)) return { ok: false, error: `blocks[${i}]: end must be after start.` };
    if (e - s > MAX_BLOCK_MS) return { ok: false, error: `blocks[${i}]: a block can be at most 24 hours.` };
    blocks.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
  }
  return { ok: true, source, blocks };
}

// ---------- Week window (pure, no date libs) ----------

/** Offset of `tz` from UTC at `instantMs`, in ms (local wall clock minus UTC). */
function tzOffsetMs(instantMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const hour = n("hour") === 24 ? 0 : n("hour");
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), hour, n("minute"), n("second"));
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/** UTC instant of local midnight on the given local calendar date in `tz` (DST-safe). */
function localMidnightMs(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess, tz);
  const again = guess - tzOffsetMs(t, tz);
  if (again !== t) t = again;
  return t;
}

/**
 * The Desk's calendar window: Monday 00:00 of the current local week (in `tz`) through local
 * midnight 8 days after today, so it always holds the whole current week plus the next 7 days.
 */
export function calendarWindow(now: Date, tz: string): { start: Date; end: Date } {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  const [y, m, d] = ymd as [number, number, number];
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  const sinceMonday = (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday) + 7) % 7;
  const at = (offsetDays: number) => {
    const day = new Date(Date.UTC(y, m - 1, d + offsetDays));
    return new Date(localMidnightMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), tz));
  };
  return { start: at(-sinceMonday), end: at(8) };
}

export function fewerTz(): string {
  return (process.env.FEWER_TZ ?? "").trim() || "America/Los_Angeles";
}

// ---------- Accepted asks -> taken blocks (pure) ----------

export type AcceptedRow = { id: string; title: string | null; starts_at: string | null; duration_min: string | number | null };

/** Rows from acceptedAskRows() -> taken blocks, excluding the ask being decided and any ignored ids. Pure. */
export function acceptedTakenBlocks(rows: AcceptedRow[], askId: string, ignore?: ReadonlySet<string>): TakenBlock[] {
  const out: TakenBlock[] = [];
  for (const r of rows) {
    if (r.id === askId || ignore?.has(r.id)) continue;
    const start = r.starts_at ? Date.parse(r.starts_at) : NaN;
    const minutes = Number(r.duration_min);
    if (Number.isNaN(start) || !Number.isFinite(minutes) || minutes <= 0) continue;
    out.push({
      start: new Date(start).toISOString(),
      end: new Date(start + minutes * 60_000).toISOString(),
      label: r.title?.trim() || "something you already said yes to",
      kind: "accepted",
    });
  }
  return out;
}

// ---------- Database ----------

const isMissingTable = (e: unknown) => (e as { code?: string } | null)?.code === "42P01";

/** In one transaction: drop this source's rows starting in [now - 1d, now + 14d], insert the new blocks. */
export async function replaceBusyBlocks(
  source: string,
  blocks: { start: string; end: string }[],
  now: Date = new Date(),
): Promise<number> {
  const from = new Date(now.getTime() - REPLACE_BACK_MS);
  const to = new Date(now.getTime() + REPLACE_AHEAD_MS);
  return db.sql.begin(async (tx) => {
    await tx`delete from calendar_busy where source = ${source} and start_at >= ${from} and start_at <= ${to}`;
    if (blocks.length === 0) return 0;
    const rows = blocks.map((b) => ({ start_at: b.start, end_at: b.end, source }));
    const inserted = await tx`insert into calendar_busy ${tx(rows, "start_at", "end_at", "source")} returning id`;
    return inserted.length;
  });
}

/** Busy blocks overlapping [start, end), oldest first. An unmigrated database reads as no blocks. */
export async function listBusyBlocks(window: { start: Date; end: Date }): Promise<BusyBlock[]> {
  try {
    const rows = await db.sql<{ start_at: Date; end_at: Date; source: string }[]>`
      select start_at, end_at, source from calendar_busy
      where end_at > ${window.start} and start_at < ${window.end}
      order by start_at asc, id asc`;
    return rows.map((r) => ({ start: new Date(r.start_at).toISOString(), end: new Date(r.end_at).toISOString(), source: r.source }));
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/**
 * Asks holding their slot: latest verdict YES/WILDCARD and status triaged|awaiting_approval (decided yes,
 * not yet approved) or sent|ready|simulated (approved). A re-decide pass passes the open asks it has not
 * visited yet as `ignore`, so there only approved asks and yeses made earlier in the pass count.
 */
async function acceptedAskRows(askId: string): Promise<AcceptedRow[]> {
  return db.sql<AcceptedRow[]>`
    select a.id, a.parsed->>'title' as title, a.parsed->>'startsAt' as starts_at, a.parsed->>'durationMin' as duration_min
    from asks a
    join lateral (
      select verdict from decisions x where x.ask_id = a.id order by x.id desc limit 1
    ) d on true
    where a.status in ('triaged', 'awaiting_approval', 'sent', 'ready', 'simulated')
      and d.verdict in ('YES', 'WILDCARD')
      and a.id <> ${askId}
      and a.parsed->>'startsAt' is not null
      and a.parsed->>'durationMin' is not null`;
}

/**
 * Taken time around this ask for decide(): calendar busy blocks overlapping the ask's day +/- 1 day
 * (label "your calendar") and accepted asks (label = their title). Never includes the ask itself.
 * `ignore`: open asks a re-decide pass has not reached yet, so they cannot hold a slot against a better ask.
 */
export async function takenBlocksFor(
  askId: string,
  parsed: Pick<ParsedAsk, "startsAt" | "durationMin">,
  ignore?: ReadonlySet<string>,
): Promise<TakenBlock[]> {
  const start = parsed.startsAt ? Date.parse(parsed.startsAt) : NaN;
  if (Number.isNaN(start) || parsed.durationMin == null) return [];
  const window = { start: new Date(start - DAY_MS), end: new Date(start + parsed.durationMin * 60_000 + DAY_MS) };
  const [busy, accepted] = await Promise.all([listBusyBlocks(window), acceptedAskRows(askId)]);
  const calendar: TakenBlock[] = busy.map((b) => ({ start: b.start, end: b.end, label: "your calendar", kind: "calendar" }));
  return [...acceptedTakenBlocks(accepted, askId, ignore), ...calendar];
}
