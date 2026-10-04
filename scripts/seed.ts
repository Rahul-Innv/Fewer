import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

/**
 * Sends demo asks from FEWER_HOST_DEMO to FEWER_INBOX.
 *   npm run seed                              -> the 4 demo asks (YES, SMALLER, ASK_ONE, BLOCKED)
 *   npm run seed -- --panel2                  -> ONLY the 5th ask: a second panel invite WITH date + duration.
 *                                                Send it after the owner has rated a panel 2/5 to show the
 *                                                learned-preference NO.
 *   npm run seed -- --one "Subject|Body text" -> one custom ask
 *   npm run seed -- --print                   -> print the asks (add --panel2 for the 5th) without sending
 *
 * The senders and the "friend" are fictional. The event in ask (a) is real and public (SF Tech Week);
 * set FEWER_DEMO_EVENT_URL to point ask (a) at a different public page for the same event.
 *
 * What each ask is designed to produce (rules from src/core/decide.ts, demo persona from scripts/migrate.ts):
 *   (a) YES      R3  real evening event, fits a top-2 goal, host + title corroborated on 2+ domains
 *   (b) SMALLER  R1  coffee Tue 10:00 PT lands in the absolute Tue/Thu 9-12 block, still worth something
 *   (c) ASK_ONE  R2  a panel invite with no date, time or length
 *   (d) BLOCKED  R0  polite note with instructions aimed at the assistant
 *   (e) NO       R6  --panel2: a dated panel the owner has already rated 2/5 (and no host claim verifies)
 */

import { DEMO_EVENT, buildAsks } from "../src/server/demo-asks";

async function main() {
  const has = (flag: string) => process.argv.includes(flag);
  const print = has("--print");

  const missing = print ? [] : ["AGENTMAIL_API_KEY", "FEWER_INBOX", "FEWER_HOST_DEMO"].filter((k) => !process.env[k]);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(", ")} (set them in .env.local)`);
  const inbox = process.env.FEWER_INBOX as string;
  const host = process.env.FEWER_HOST_DEMO as string;
  const owner = (process.env.FEWER_OWNER_NAME ?? "").trim() || "Rahul";
  const tz = (process.env.FEWER_TZ ?? "").trim() || "America/Los_Angeles";

  const send = async (subject: string, text: string, expect?: string) => {
    if (print) {
      console.log(`\n=== ${subject}${expect ? `  [expect ${expect}]` : ""}\n${text}`);
      return;
    }
    const { sendMail } = await import("../src/server/mail");
    const r = await sendMail({ inboxId: host, to: [inbox], subject, text });
    console.log(`[seed] sent "${subject}"${expect ? ` (expect ${expect})` : ""} (${r.messageId})`);
  };

  const oneIdx = process.argv.indexOf("--one");
  if (oneIdx !== -1) {
    const raw = process.argv[oneIdx + 1];
    if (!raw) throw new Error('Usage: --one "<subject>|<body>"');
    const cut = raw.indexOf("|");
    if (cut === -1) throw new Error('--one needs "<subject>|<body>" (split on the first |)');
    await send(raw.slice(0, cut).trim(), raw.slice(cut + 1).trim());
    return;
  }

  const eventUrl = (process.env.FEWER_DEMO_EVENT_URL ?? "").trim() || DEMO_EVENT.url;
  const asks = buildAsks({ owner, tz, eventUrl });

  if (has("--panel2")) {
    await send(asks.panel2.subject, asks.panel2.text, asks.panel2.expect);
    if (!print) console.log("[seed] panel2 sent. Expect a NO once the worker has triaged it (rate a panel 2/5 first).");
    return;
  }

  if (Date.now() > Date.parse(DEMO_EVENT.startsAt)) {
    console.warn(`[seed] warning: the demo event (${DEMO_EVENT.dateLabel}) is in the past; ask (a) will not read as an upcoming invite.`);
  }

  for (const ask of asks.main) await send(ask.subject, ask.text, ask.expect);

  if (!print) console.log("[seed] done. Expect ONE brief ~10s after the worker finishes triaging.");
}

main().catch((e) => {
  console.error("[seed]", e instanceof Error ? e.message : e);
  process.exit(1);
});
