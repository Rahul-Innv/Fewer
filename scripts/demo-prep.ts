/**
 * One command before every recording take:
 *   npm run demo:prep            reset demo data, send the 4 seed asks, wait for the brief
 *   npm run demo:prep -- --no-seed   reset only (start from an empty Desk)
 *
 * The worker (on Fly, or one local `npm run worker`) must be running: it turns the emails into
 * verdicts and sends the brief. This script never starts a worker itself.
 */
import { execSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const TIMEOUT_MS = 150_000;

function run(cmd: string): void {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

async function main() {
  const seed = !process.argv.includes("--no-seed");
  run("npm run -s demo:reset -- --yes");
  if (!seed) {
    console.log("[demo-prep] reset done; Desk is empty.");
    return;
  }

  const { sql, closeDb } = await import("../src/server/db");
  run("npm run -s seed");
  console.log("[demo-prep] waiting for the worker to decide all 4 asks and send the brief…");

  const started = Date.now();
  let last = "";
  while (Date.now() - started < TIMEOUT_MS) {
    const asks = await sql<{ subject: string; status: string; verdict: string | null; rule: string | null }[]>`
      select a.subject, a.status, d.verdict, d.rule
      from asks a
      left join lateral (select verdict, rule from decisions x where x.ask_id = a.id order by x.id desc limit 1) d on true
      order by a.received_at`;
    const [pending] = await sql<{ code: string; n: number }[]>`
      select code, jsonb_array_length(draft_ids)::int as n from approvals
      where status = 'pending' and expires_at > now() order by created_at desc limit 1`;
    const line = `${asks.length} ask(s), ${asks.filter((a) => a.verdict).length} decided${pending ? `, brief code ${pending.code}` : ""}`;
    if (line !== last) console.log(`[demo-prep] ${line}`);
    last = line;
    // All four decided (reset cleared everything else) and a live brief waiting for the owner.
    if (asks.length >= 4 && asks.every((a) => a.verdict) && pending) {
      for (const a of asks) console.log(`  ${(a.verdict ?? "…").padEnd(8)} ${(a.rule ?? "").padEnd(3)} ${a.subject}`);
      console.log(`[demo-prep] READY. Brief code ${pending.code} for ${pending.n} draft(s); it expires in 30 min.`);
      await closeDb();
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.error("[demo-prep] timed out: is exactly one worker running (fly status -a fewer-rk)?");
  await closeDb();
  process.exit(1);
}

main().catch((e) => {
  console.error("[demo-prep] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
