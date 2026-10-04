import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { closeDb, sql } from "../src/server/db";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const TABLES = ["asks", "evidence", "decisions", "drafts", "approvals", "actions", "checkins", "outcomes", "events_log"] as const;
const KEEP = ["journeys", "boundaries"] as const;

async function counts(tables: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const rows = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${t}`);
    out[t] = rows[0]?.n ?? 0;
  }
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (/euzena/i.test(host) || /euzena/i.test(url)) {
    throw new Error(`Refusing to reset: DATABASE_URL looks like the Euzena database (${host}).`);
  }

  console.log(`[demo-reset] target host: ${host}`);
  console.log("[demo-reset] will TRUNCATE:", TABLES.join(", "), "(journeys/boundaries are kept)");

  if (!process.argv.includes("--yes")) {
    if (!process.stdin.isTTY) {
      throw new Error("Not a TTY: pass --yes to confirm (npm run demo:reset -- --yes).");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Type the host (${host}) to confirm: `)).trim();
    rl.close();
    if (answer !== host) throw new Error("Confirmation did not match; nothing changed.");
  }

  console.log("[demo-reset] before:", JSON.stringify(await counts(TABLES)));
  await sql.unsafe(`truncate table ${TABLES.join(", ")} restart identity`);
  console.log("[demo-reset] after: ", JSON.stringify(await counts(TABLES)));
  console.log("[demo-reset] kept:  ", JSON.stringify(await counts(KEEP)));
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error("[demo-reset]", e instanceof Error ? e.message : e);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
