/**
 * Gate A smoke test: `npx tsx scripts/smoke.ts`
 * Each step is independent and prints PASS/FAIL. Secrets are never printed (names only).
 */
import { config } from "dotenv";

// Load env BEFORE importing anything that reads it (llm.ts builds an agent at import time).
config({ path: ".env.local", quiet: true });
config({ quiet: true });

const ENV_NAMES = [
  "DATABASE_URL",
  "NEON_AI_GATEWAY_BASE_URL",
  "NEON_AI_GATEWAY_TOKEN",
  "ANTHROPIC_API_KEY",
  "AGENTMAIL_API_KEY",
  "EXA_API_KEY",
  "FEWER_INBOX",
  "FEWER_APPROVER",
  "FEWER_HOST_DEMO",
  "FEWER_OWNER_NAME",
  "FEWER_TZ",
  "FEWER_MODEL_FAST",
  "FEWER_MODEL_DRAFT",
  "FEWER_ALLOW_SEND",
];

let failures = 0;

function msg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  // belt and braces: never echo anything that looks like a secret
  return s.replace(/nt_live_[A-Za-z0-9_-]+/g, "nt_live_***").replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***").slice(0, 400);
}

async function step(name: string, fn: () => Promise<string | void>): Promise<void> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS  ${name} (${Date.now() - t0}ms)${detail ? `\n${detail}` : ""}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name} (${Date.now() - t0}ms): ${msg(e)}`);
  }
}

const CANNED_EMAIL = {
  from: "Dana Whitfield <dana@foundertable.example>",
  fromName: "Dana Whitfield",
  subject: "Panel invite: Agents in Production, Thu Oct 8",
  text: [
    "Hi Rahul,",
    "",
    "I'm Dana from Founder Table SF. We're hosting a panel called \"Agents in Production\" on Thursday, October 8 at 6:30pm at our space in SoMa, running about 90 minutes.",
    "We'd love to have you on the panel alongside two other founders. Details: https://foundertable.example/agents-in-production",
    "",
    "Dana",
  ].join("\n"),
};

const JOURNEYS = [
  { id: "j1", rank: 1 as const, title: "Ship Fewer and get early users", keywords: ["agents", "personal agent", "launch", "users"] },
  { id: "j2", rank: 2 as const, title: "Meet other founders building with AI", keywords: ["founder", "panel", "meetup", "ai"] },
  { id: "j3", rank: 3 as const, title: "Protect health and evenings", keywords: ["gym", "dinner", "family", "evening"] },
];

async function main() {
  console.log("== Fewer smoke test (gate A) ==");

  console.log("\nEnv present (names only):");
  for (const n of ENV_NAMES) console.log(`  ${process.env[n]?.trim() ? "set    " : "MISSING"} ${n}`);

  // 1. Neon AI Gateway model catalog
  await step("neon-gateway /v1/models", async () => {
    const base = process.env.NEON_AI_GATEWAY_BASE_URL?.trim().replace(/\/+$/, "");
    const token = process.env.NEON_AI_GATEWAY_TOKEN?.trim();
    if (!base || !token) throw new Error("NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN not set");
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { data?: Array<{ id: string; enabled?: boolean }> };
    const ids = (json.data ?? []).filter((m) => m.enabled !== false).map((m) => m.id);
    const pick = (re: RegExp) => ids.filter((id) => re.test(id)).sort();
    const want = ["claude-haiku-4-5", "claude-sonnet-4-6"];
    const missing = want.filter((w) => !ids.includes(w));
    return [
      `  ${ids.length} models served`,
      `  claude: ${pick(/claude/i).join(", ") || "(none)"}`,
      `  gpt:    ${pick(/gpt/i).join(", ") || "(none)"}`,
      `  gemini: ${pick(/gemini/i).join(", ") || "(none)"}`,
      missing.length
        ? `  NOTE: defaults not in catalog: ${missing.join(", ")} -> set FEWER_MODEL_FAST / FEWER_MODEL_DRAFT to "neon/<id>"`
        : `  defaults present: ${want.join(", ")}`,
    ].join("\n");
  });

  // 2. parseAsk on a canned email (Mastra + model router + structured output)
  let parsedAsk: import("@/core").ParsedAsk | undefined;
  await step("llm parseAsk (canned email)", async () => {
    const { parseAsk } = await import("@/server/llm");
    const { modelFast } = await import("@/server/env");
    const t0 = Date.now();
    const out = await parseAsk(
      {
        messageId: "smoke-1",
        from: CANNED_EMAIL.from,
        fromName: CANNED_EMAIL.fromName,
        subject: CANNED_EMAIL.subject,
        text: CANNED_EMAIL.text,
        now: new Date().toISOString(),
        timeZone: process.env.FEWER_TZ?.trim() || "America/Los_Angeles",
      },
      JOURNEYS,
    );
    parsedAsk = out.ask;
    return `  model=${modelFast()} elapsed=${Date.now() - t0}ms\n${JSON.stringify(out, null, 2)
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")}`;
  });

  // 3. draftReply (draft model)
  await step("llm draftReply (draft model)", async () => {
    const { draftReply } = await import("@/server/llm");
    const { modelDraft } = await import("@/server/env");
    const ask =
      parsedAsk ??
      ({
        id: "smoke-1",
        from: "dana@foundertable.example",
        fromName: "Dana Whitfield",
        subject: CANNED_EMAIL.subject,
        kind: "event",
        title: "Agents in Production panel",
        tag: "panel",
        inPerson: true,
        containsInstructionsToAgent: false,
      } as import("@/core").ParsedAsk);
    const { body } = await draftReply(
      {
        ask,
        ownerName: process.env.FEWER_OWNER_NAME?.trim() || "Rahul",
        decision: {
          verdict: "SMALLER",
          rule: "R4",
          reasons: ["Too long for a weeknight"],
          smallerOffer: "a 20-minute remote fireside chat instead of the full 90-minute panel",
          cost: { hours: 1.5 },
          verifiedClaims: 0,
          effectiveFit: [],
        },
      },
      { strict: true }, // fail instead of silently using the offline template
    );
    return `  model=${modelDraft()}\n${body
      .split("\n")
      .map((l) => `  | ${l}`)
      .join("\n")}`;
  });

  // 4. Postgres
  await step("postgres select now()", async () => {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL not set");
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { max: 1, connect_timeout: 15, idle_timeout: 2 });
    try {
      const rows = await sql`select now() as now`;
      return `  now=${String(rows[0]?.now)}`;
    } finally {
      await sql.end({ timeout: 2 });
    }
  });

  // 5. AgentMail
  await step("agentmail list inboxes", async () => {
    const { mailClient } = await import("@/server/mail");
    const res = await mailClient().inboxes.list({ limit: 20 });
    const lines = res.inboxes.map((i) => `  - ${i.inboxId}${i.clientId ? `  (clientId=${i.clientId})` : ""}`);
    const wanted = process.env.FEWER_INBOX?.trim();
    const found = wanted ? res.inboxes.some((i) => i.inboxId === wanted || i.email === wanted) : undefined;
    return [
      `  ${res.count} inbox(es)`,
      ...lines,
      wanted ? `  FEWER_INBOX ${found ? "found" : "NOT found among first 20"}` : "  FEWER_INBOX not set",
    ].join("\n");
  });

  // 6. Exa
  await step("exa search", async () => {
    const key = process.env.EXA_API_KEY?.trim();
    if (!key) throw new Error("EXA_API_KEY not set");
    const { Exa } = await import("exa-js");
    const exa = new Exa(key);
    const res = await exa.search("Build Personal Agents Hack San Francisco", {
      type: "auto",
      numResults: 3,
      contents: { highlights: true },
    });
    const lines = res.results.map((r) => `  - ${r.url}  (${(r.highlights ?? []).length} highlight(s))`);
    return [`  ${res.results.length} result(s)`, ...lines].join("\n");
  });

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} step(s) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`smoke crashed: ${msg(e)}`);
  process.exit(2);
});
