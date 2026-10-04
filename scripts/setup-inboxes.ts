/**
 * Idempotently create Fewer's three AgentMail inboxes and print the .env.local lines.
 *   npx tsx scripts/setup-inboxes.ts [suffix]
 * Inboxes are matched by stable clientId, so re-running reuses them (the suffix only matters on first
 * creation). Does NOT write .env.local.
 */
import { randomBytes } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

interface Spec {
  clientId: string;
  username: (suffix: string) => string;
  displayName: string;
  envName: string;
  role: string;
}

const SPECS: Spec[] = [
  { clientId: "fewer", username: (s) => `fewer-${s}`, displayName: "Fewer", envName: "FEWER_INBOX", role: "the agent's inbox" },
  { clientId: "rahul-demo", username: (s) => `rahul-demo-${s}`, displayName: "Rahul - demo owner", envName: "FEWER_APPROVER", role: "approver / owner demo inbox" },
  { clientId: "host-demo", username: (s) => `host-demo-${s}`, displayName: "Event Host - demo", envName: "FEWER_HOST_DEMO", role: "demo event-host inbox" },
];

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function main() {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim();
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY is not set (put it in .env.local)");
  const { AgentMailClient } = await import("agentmail");
  const client = new AgentMailClient({ apiKey });

  const suffix = (process.argv[2] ?? randomBytes(3).toString("hex").slice(0, 4)).toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!suffix) throw new Error("suffix must contain letters or digits");

  // Index existing inboxes by clientId (paged).
  const existing = new Map<string, { inboxId: string; email: string }>();
  let pageToken: string | undefined;
  do {
    const page = await client.inboxes.list({ limit: 100, ...(pageToken ? { pageToken } : {}) });
    for (const ib of page.inboxes) {
      if (ib.clientId) existing.set(ib.clientId, { inboxId: ib.inboxId, email: ib.email });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  const results: Array<{ spec: Spec; inboxId: string; email: string; created: boolean }> = [];
  for (const spec of SPECS) {
    const found = existing.get(spec.clientId);
    if (found) {
      results.push({ spec, ...found, created: false });
      continue;
    }
    try {
      const ib = await client.inboxes.create({
        username: spec.username(suffix),
        displayName: spec.displayName,
        clientId: spec.clientId,
      });
      results.push({ spec, inboxId: ib.inboxId, email: ib.email, created: true });
    } catch (e) {
      throw new Error(
        `could not create inbox "${spec.username(suffix)}" (clientId ${spec.clientId}): ${msg(e)}. ` +
          `If the username is taken, re-run with a different suffix: npx tsx scripts/setup-inboxes.ts <suffix>`,
      );
    }
  }

  console.log("AgentMail inboxes:");
  for (const r of results) {
    console.log(`  ${r.created ? "created" : "exists "}  ${r.email.padEnd(40)} clientId=${r.spec.clientId}  (${r.spec.role})`);
  }
  console.log("\nPaste into .env.local:\n");
  for (const r of results) console.log(`${r.spec.envName}=${r.email}`);
  console.log("");
}

main().catch((e) => {
  console.error(`setup-inboxes failed: ${msg(e)}`);
  process.exit(1);
});
