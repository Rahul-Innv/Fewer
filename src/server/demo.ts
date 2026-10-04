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
  | { ok: true; startedAt: string; askIds: string[] }
  | { ok: false; status: 409 | 412; error: string; lastRunAt?: string | null };

let starting = false;

/** Resets the demo data and records the four asks. Refuses inside the cooldown or against a non-demo DB. */
export async function startDemoRun(now = new Date()): Promise<DemoStart> {
  if (/euzena/i.test(directDatabaseUrl() ?? "")) {
    return { ok: false, status: 412, error: "Refusing to reset: this looks like the Euzena database." };
  }
  if (starting) return { ok: false, status: 409, error: "A demo run is already starting." };
  starting = true;
  try {
    const last = await lastDemoRunAt();
    if (last && now.getTime() - Date.parse(last) < COOLDOWN_MS) {
      return { ok: false, status: 409, error: "A demo run started less than a minute ago.", lastRunAt: last };
    }
    await deleteDemoRows();
    const startedAt = now.toISOString();
    await logEvent("demo_run", null, { startedAt });

    const { submitDemoAsk } = await import("./pipeline");
    const owner = process.env.FEWER_OWNER_NAME?.trim() || "Rahul";
    const tz = process.env.FEWER_TZ?.trim() || "America/Los_Angeles";
    const eventUrl = process.env.FEWER_DEMO_EVENT_URL?.trim() || DEMO_EVENT.url;
    const { main } = buildAsks({ owner, tz, eventUrl });
    const askIds: string[] = [];
    for (const [i, ask] of main.entries()) {
      const sender = SENDERS[i] ?? SENDERS[0]!;
      askIds.push(await submitDemoAsk({ subject: ask.subject, text: ask.text, ...sender }));
    }
    return { ok: true, startedAt, askIds };
  } finally {
    starting = false;
  }
}

/** Triage the demo asks (real model + Exa + rules), then create their approval with no email. */
export async function runDemoTriage(askIds: string[]): Promise<void> {
  const { triage, sendBrief } = await import("./pipeline");
  await Promise.all(askIds.map((id) => triage(id)));
  await sendBrief(askIds);
}
