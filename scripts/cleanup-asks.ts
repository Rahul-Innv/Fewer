/**
 * Deletes ONLY the asks whose subject starts with a prefix, plus every row linked to them.
 *   npx tsx scripts/cleanup-asks.ts "[Calendar] "            dry run: lists what would go
 *   npx tsx scripts/cleanup-asks.ts "[Calendar] " --yes      deletes
 * Demo asks and every other live ask are untouched.
 */
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

async function main() {
  const prefix = process.argv[2] ?? "";
  if (prefix.trim().length < 3) throw new Error('Give a subject prefix of 3+ characters, e.g. "[Calendar] "');
  const { sql, closeDb } = await import("../src/server/db");
  const { deleteAsks } = await import("../src/server/demo");
  const like = prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
  const rows = await sql<{ id: string; subject: string | null }[]>`
    select id, subject from asks where subject like ${like} escape '\\' and inbox_message_id not like 'demo-%'
    order by received_at`;
  console.log(`[cleanup] ${rows.length} ask(s) with subject starting ${JSON.stringify(prefix)}`);
  for (const r of rows.slice(0, 8)) console.log(`  ${r.id}  ${r.subject}`);
  if (rows.length > 8) console.log(`  … and ${rows.length - 8} more`);
  if (!process.argv.includes("--yes")) {
    console.log("[cleanup] dry run. Add --yes to delete.");
  } else {
    await deleteAsks(rows.map((r) => r.id));
    console.log(`[cleanup] deleted ${rows.length} ask(s) and their linked rows.`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error("[cleanup]", e instanceof Error ? e.message : e);
  process.exit(1);
});
