import { DEMO_EVENT, buildAsks } from "./demo-asks";
import { directDatabaseUrl, logEvent, sql } from "./db";

/**
 * The Desk's one-click "Run demo". It never touches live data and never emails anyone but the owner:
 *  - deletes ONLY demo rows (asks with inbox ids "demo-%" and everything linked to them),
 *  - records the four seed asks directly (inbox ids "demo-<uuid>", fictional @example.com senders),
 *  - triages them for real (model + Exa + rules), then creates the approval with no brief email.
 * Approving demo drafts runs the full exactly-once path, records "simulated" per draft, and sends ONE
 * digest email to DEMO_RECIPIENT (the owner's inbox). The fictional @example.com senders are never emailed.
 * Progress shows through the Desk's normal /api/desk polling.
 */

const COOLDOWN_MS = 60_000;

/** Fictional senders for the four seed asks, in buildAsks().main order. example.com is reserved: it never delivers. */
const SENDERS = [
  { fromName: "Maya", fromEmail: "maya@example.com" },
  { fromName: "Dana", fromEmail: "dana@example.com" },
  { fromName: "Jordan", fromEmail: "jordan@example.com" },
  { fromName: "Sam", fromEmail: "sam@example.com" },
  { fromName: "Alex", fromEmail: "alex@example.com" },
];

/** Deletes demo asks and everything linked to them. Live asks (email and web intake) are untouched. */
async function deleteDemoRows(): Promise<void> {
  const asks = await sql<{ id: string }[]>`select id from asks where inbox_message_id like 'demo-%'`;
  await deleteAsks(asks.map((a) => a.id), { demoEvents: true });
}

/** Deletes the given asks and every row linked to them (drafts, actions, approvals, decisions, events). */
export async function deleteAsks(askIds: string[], opts: { demoEvents?: boolean } = {}): Promise<number> {
  await sql.begin(async (tx) => {
    const drafts = askIds.length ? await tx<{ id: string }[]>`select id from drafts where ask_id in ${tx(askIds)}` : [];
    const draftIds = drafts.map((d) => d.id);
    if (draftIds.length) {
      await tx`delete from actions where draft_id in ${tx(draftIds)}`;
      await tx`delete from approvals a where exists (
        select 1 from jsonb_array_elements_text(a.draft_ids) x where x in ${tx(draftIds)})`;
      await tx`delete from drafts where id in ${tx(draftIds)}`;
    }
    if (askIds.length) {
      for (const t of ["decisions", "evidence", "checkins", "outcomes", "events_log"]) {
        await tx`delete from ${tx(t)} where ask_id in ${tx(askIds)}`;
      }
      await tx`delete from asks where id in ${tx(askIds)}`;
    }
    if (opts.demoEvents) {
      await tx`delete from events_log where kind in ('approved_demo', 'demo_digest') or detail->>'demo' = 'true'`;
    }
  });
  return askIds.length;
}

export async function lastDemoRunAt(): Promise<string | null> {
  const rows = await sql<{ at: Date | null }[]>`select max(at) as at from events_log where kind = 'demo_run'`;
  return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
}

export type DemoStart =
  | { ok: true; startedAt: string; total: number }
  | { ok: false; status: 409 | 412; error: string; lastRunAt?: string | null };

let starting = false;
const STAGGER_MS = 3_000;
/** When the current run started (ms), or null when idle. Expires so a run that died can't block the buttons. */
let runningSince: number | null = null;
const RUN_EXPIRES_MS = 5 * 60_000;

function demoRunning(): boolean {
  if (runningSince !== null && Date.now() - runningSince > RUN_EXPIRES_MS) runningSince = null;
  return runningSince !== null;
}

function guardDemoDb(): { ok: false; status: 412; error: string } | null {
  return /euzena/i.test(directDatabaseUrl() ?? "")
    ? { ok: false, status: 412, error: "Refusing to reset: this looks like the Euzena database." }
    : null;
}

function demoAsks() {
  const owner = process.env.FEWER_OWNER_NAME?.trim() || "Rahul";
  const tz = process.env.FEWER_TZ?.trim() || "America/Los_Angeles";
  const eventUrl = process.env.FEWER_DEMO_EVENT_URL?.trim() || DEMO_EVENT.url;
  return buildAsks({ owner, tz, eventUrl }).main;
}

/** Clears demo rows only (no re-seed). Live data is untouched. */
export async function resetDemo(): Promise<{ ok: true } | { ok: false; status: 412; error: string }> {
  const refused = guardDemoDb();
  if (refused) return refused;
  await deleteDemoRows();
  return { ok: true };
}

/** Starts a run: clears demo rows and stamps the run. The asks arrive later, staggered (runDemoStaggered). */
export async function startDemoRun(now = new Date()): Promise<DemoStart> {
  const refused = guardDemoDb();
  if (refused) return refused;
  if (starting || demoRunning()) return { ok: false, status: 409, error: "A demo run is already going." };
  starting = true;
  try {
    const last = await lastDemoRunAt();
    if (last && now.getTime() - Date.parse(last) < COOLDOWN_MS) {
      return { ok: false, status: 409, error: "A demo run started less than a minute ago.", lastRunAt: last };
    }
    await deleteDemoRows();
    const startedAt = now.toISOString();
    const total = demoAsks().length;
    await logEvent("demo_run", null, { startedAt, total });
    runningSince = Date.now();
    return { ok: true, startedAt, total };
  } finally {
    starting = false;
  }
}

/**
 * The asks arrive one every STAGGER_MS and each is triaged as it lands (real model + Exa + rules),
 * so the Desk shows them arriving and being decided. Then one Desk-only approval, no email.
 */
export async function runDemoStaggered(): Promise<void> {
  runningSince ??= Date.now();
  try {
    const { submitDemoAsk, triage, sendBrief } = await import("./pipeline");
    const asks = demoAsks();
    const askIds: string[] = [];
    const triages: Promise<void>[] = [];
    for (const [i, ask] of asks.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, STAGGER_MS));
      const sender = SENDERS[i] ?? SENDERS[0]!;
      const id = await submitDemoAsk({ subject: ask.subject, text: ask.text, ...sender });
      askIds.push(id);
      triages.push(triage(id).catch((e) => console.error("[fewer/demo] triage failed", id, e)));
    }
    await Promise.all(triages);
    await sendBrief(askIds);
  } finally {
    runningSince = null;
  }
}

/**
 * For "2 of 5 asks arrived": demo asks present now vs the planned total, and whether a run is going.
 * `running` is authoritative: 0 of 5 with no run going is an empty demo, not a stuck one.
 */
export async function demoProgress(): Promise<{ inserted: number; total: number; running: boolean }> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from asks where inbox_message_id like 'demo-%'`;
  return { inserted: r?.n ?? 0, total: demoAsks().length, running: demoRunning() };
}
