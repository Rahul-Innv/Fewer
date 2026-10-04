import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BoundarySchema, JourneySchema } from "../src/core";
import { closeDb, sql } from "../src/server/db";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

/** Generic demo persona (not anyone's real schedule). Seeded only into EMPTY tables. */
const DEMO_JOURNEYS = [
  { id: "j1", rank: 1, title: "Ship the Fewer launch", keywords: ["agents", "launch", "users", "founders"] },
  { id: "j2", rank: 2, title: "Meet 10 potential users", keywords: ["founders", "product", "consumer", "ai assistant"] },
  { id: "j3", rank: 3, title: "Protect health", keywords: ["sleep", "run", "gym"] },
] as const;

const DEMO_BOUNDARIES = [
  {
    id: "b1",
    strength: "absolute",
    label: "Tue/Thu 9–12 deep work",
    rule: { type: "time_block", days: ["tue", "thu"], start: "09:00", end: "12:00" },
  },
  {
    id: "b2",
    strength: "absolute",
    label: "At most 2 evenings out a week",
    rule: { type: "max_evenings_out_per_week", n: 2 },
  },
  {
    id: "b3",
    strength: "preference",
    label: "Keep meetings to 90 minutes or less",
    rule: { type: "max_minutes", minutes: 90 },
  },
] as const;

export async function runMigrate(o: { quiet?: boolean } = {}): Promise<{ seededJourneys: number; seededBoundaries: number }> {
  const say = (m: string) => {
    if (!o.quiet) console.log(`[migrate] ${m}`);
  };
  const file = path.resolve(process.cwd(), "sql", "001_init.sql");
  await sql.unsafe(readFileSync(file, "utf8"));
  say("schema ready");

  let seededJourneys = 0;
  let seededBoundaries = 0;

  const [{ n: jn }] = await sql<{ n: number }[]>`select count(*)::int as n from journeys`;
  if (jn === 0) {
    for (const row of DEMO_JOURNEYS) {
      const j = JourneySchema.parse({ ...row, keywords: [...row.keywords] });
      await sql`insert into journeys (id, rank, title, keywords) values (${j.id}, ${j.rank}, ${j.title}, ${sql.json(j.keywords)})`;
      seededJourneys += 1;
    }
    say(`seeded ${seededJourneys} demo journeys`);
  }

  const [{ n: bn }] = await sql<{ n: number }[]>`select count(*)::int as n from boundaries`;
  if (bn === 0) {
    for (const row of DEMO_BOUNDARIES) {
      const b = BoundarySchema.parse(row);
      await sql`insert into boundaries (id, strength, label, rule) values (${b.id}, ${b.strength}, ${b.label}, ${sql.json(b.rule)})`;
      seededBoundaries += 1;
    }
    say(`seeded ${seededBoundaries} demo boundaries`);
  }
  return { seededJourneys, seededBoundaries };
}

// Run only when invoked directly (`npm run migrate`), not when the worker imports runMigrate().
const isMain = /^migrate\.[cm]?[tj]s$/.test(path.basename(process.argv[1] ?? ""));
if (isMain) {
  runMigrate()
    .then(() => closeDb())
    .catch(async (e) => {
      console.error("[migrate] failed:", e instanceof Error ? e.message : e);
      await closeDb().catch(() => undefined);
      process.exit(1);
    });
}
