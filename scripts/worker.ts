import { config } from "dotenv";

// Load env BEFORE importing anything that reads it (llm.ts builds an agent at import time).
config({ path: ".env.local", quiet: true });
config({ quiet: true });

const BRIEF_DEBOUNCE_MS = 8_000;

function log(msg: string) {
  console.log(`[worker ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  const missing = ["DATABASE_URL", "AGENTMAIL_API_KEY", "FEWER_INBOX", "FEWER_APPROVER"].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing env: ${missing.join(", ")} (set them in .env.local)`);
  }
  const inboxId = process.env.FEWER_INBOX as string;

  const { runMigrate } = await import("./migrate");
  const db = await import("../src/server/db");
  const mail = await import("../src/server/mail");
  const pipeline = await import("../src/server/pipeline");

  await runMigrate({ quiet: true });
  log("schema ready");

  let inflight = 0;
  let timer: NodeJS.Timeout | null = null;

  const fireBrief = async () => {
    timer = null;
    if (inflight > 0) {
      scheduleBrief(); // someone is still being triaged: keep batching
      return;
    }
    try {
      const r = await pipeline.sendBrief();
      log(r ? `brief sent (approval ${r.approvalId})` : "no drafts waiting; no brief");
    } catch (e) {
      log(`brief failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const scheduleBrief = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void fireBrief(), BRIEF_DEBOUNCE_MS);
  };

  // listenInbox serialises awaited handlers; triage can take ~30s (LLM + Exa), so kick it off and
  // return at once. Asks in a burst are then triaged in parallel and still land in ONE brief.
  const handle = async (m: { inboxId: string; messageId: string }): Promise<void> => {
    inflight += 1;
    log(`inbound ${m.messageId}`);
    void (async () => {
      try {
        await pipeline.handleInbound(m.inboxId, m.messageId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`handleInbound failed: ${msg}`);
        await db.logEvent("error", null, { stage: "inbound", messageId: m.messageId, error: msg });
      } finally {
        inflight -= 1;
        scheduleBrief(); // debounced: a burst of asks yields ONE brief
      }
    })();
  };

  // Pick up asks stranded at 'received' by a previous crash.
  for (const a of await db.receivedAsks()) {
    log(`resuming triage for ${a.id}`);
    inflight += 1;
    void pipeline.triage(a.id).finally(() => {
      inflight -= 1;
      scheduleBrief();
    });
  }

  const listener = mail.listenInbox(inboxId, handle);
  log(`listening on ${inboxId}`);

  const sweep = setInterval(() => {
    db.expireStaleApprovals()
      .then((n) => n > 0 && log(`expired ${n} stale approval(s)`))
      .catch(() => undefined);
  }, 60_000);

  // Proactive mode: plain intervals (not Mastra schedules). Both guard the owner's time and read only
  // facts already in the database; the pipeline serialises each job, so a slow tick cannot overlap itself.
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const dueCheckins = setInterval(() => {
    pipeline
      .runDueCheckins()
      .then((n) => n > 0 && log(`sent ${n} due check-in(s)`))
      .catch((e) => log(`due check-ins failed: ${errText(e)}`));
  }, 60_000);
  const morningBrief = setInterval(() => {
    pipeline
      .runMorningBriefIfDue()
      .then((r) => r && log(r.sent ? `morning brief sent: ${r.summary}` : `morning brief not sent: ${r.error ?? "unknown error"}`))
      .catch((e) => log(`morning brief failed: ${errText(e)}`));
  }, 60_000);

  const shutdown = async () => {
    log("shutting down");
    clearInterval(sweep);
    clearInterval(dueCheckins);
    clearInterval(morningBrief);
    if (timer) clearTimeout(timer);
    listener.stop();
    await db.closeDb().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((e) => {
  console.error("[worker] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
