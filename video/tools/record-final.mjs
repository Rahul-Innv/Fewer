// Final take: records the Desk beats of video/SCRIPT.md against the running Desk (1280x720, headless),
// pastes one ask into "Add an ask" on camera, and writes everything assemble.mjs needs:
//   video/out/<name>.webm         the raw take
//   video/out/<name>.beats.json   beat timestamps (source seconds) + what was clicked
//   video/out/<name>.speed.json   LLM-wait ranges to speed up (labelled "Nx - LLM wait cut") and the
//                                  time-skip range (labelled "DEMO: TIME SKIPPED TO TOMORROW")
//   video/out/<name>.srt          captions in FINAL-TIMELINE seconds (after the 4 s title card)
// then prints the exact assemble command.
//
// Side effects are OFF unless you pass a flag:
//   --approve     click "Approve & send" (only if EVERY pending recipient ends with @agentmail.to)
//   --timeskip    click "Demo: skip to tomorrow" (emails check-ins to FEWER_APPROVER, a demo inbox)
//   --chat-send   type and send "Why smaller?" in the Ask Fewer drawer (LLM call, sends no email)
//   --proactive   click "Run proactive check now (demo)" (emails FEWER_APPROVER)
//   --no-paste    skip the "Add an ask" paste (otherwise it submits one ask with NO sender email,
//                 so Fewer only drafts a copy-only reply; nothing is emailed for it)
//   --dry         paste the text but do not click Decide (selector test; no writes at all)
// Tuning: --hold 1.2 (multiplies every hold), --name final-take, --paste "<text>", --wait-max 120
//
// Example (owner, after the rehearsal):
//   node video/tools/record-final.mjs --approve --timeskip --chat-send
//   node video/tools/assemble.mjs --clip video/out/final-take.webm --ss <printed> --speed video/out/final-take.speed.json \
//     --srt video/out/final-take.srt --out video/out/fewer-final.mp4
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPlaywright, chromiumPath, sleep, smoothScroll, glideTo, hoverSlow, pendingIsDemoOnly, CURSOR_SCRIPT } from "./pw.mjs";

const BASE = process.env.DESK_URL ?? "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.resolve(here, "..");
const OUT = path.join(VIDEO, "out");
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const HOLD = Number(opt("hold", process.env.HOLD ?? 1));
const NAME = opt("name", "final-take");
const WAIT_MAX = Number(opt("wait-max", 120)) * 1000;
const PASTE =
  opt("paste") ??
  "Hi Rahul, would you join a 2-hour roundtable on AI agents for founders next Wednesday at 3pm in SoMa? Happy to send details. - Priya (demo)";
const hold = (ms) => sleep(Math.round(ms * HOLD));
const clean = (s) => s.replace(/[–—]/g, "-");

const titleD = (() => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(VIDEO, "title-card/renders/title-card.mp4")], { encoding: "utf8" });
  return Number(r.stdout.trim()) || 4;
})();

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath: chromiumPath() });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1.5,
  colorScheme: "light",
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
await context.addInitScript(CURSOR_SCRIPT);
// Hide the Next.js dev indicator in the recording only (no app change).
await context.addInitScript(`(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; (document.head||document.documentElement).appendChild(s); })();`);
const page = await context.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;

const beats = []; // { name, a, b, captions: [] }
const speed = []; // { from, to, factor, label }
const report = { approved: false, approval: "not requested", pasted: null, timeskip: false, chatSent: false, proactive: false };

async function beat(name, captions, fn) {
  const b = { name, a: now(), b: null, captions: captions.map(clean) };
  beats.push(b);
  console.log(`[${b.a.toFixed(1)}s] ${name}`);
  try {
    await fn(b);
  } catch (e) {
    console.log(`  beat "${name}" partial: ${String(e.message).split("\n")[0]}`);
  }
  b.b = now();
}
async function desk() {
  return (await fetch(`${BASE}/api/desk`)).json();
}
const cardFor = (re) => page.locator("article, li, div").filter({ hasText: re, has: page.locator('section[aria-label="Rules decide"]') }).last();

// ---------------------------------------------------------------------------------------------------
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("load");
// Wait for real cards (not the loading skeleton) before the take starts.
await page.locator('section[aria-label="Rules decide"]').first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
await sleep(2000);
await page.mouse.move(640, 300);
const startAt = now() - 0.2; // trim everything before this (page load)

// 0:11-0:21 Weigh, check, decide: Desk, journeys first, then the verdict cards.
await beat("desk-journeys", ["Weighed against my 3 goals"], async () => {
  const j = page.getByText(/Your 3 journeys/i).first();
  if (await j.count()) await hoverSlow(page, j);
  await hold(3000);
});
await beat("verdict-cards", ["Who's asking? Checked with Exa", "Rules decide: YES / SMALLER / ASK ONE / BLOCKED"], async () => {
  const h = page.getByRole("heading", { name: /Asks/ }).first();
  await glideTo(page, h, 1400, 90);
  await hold(1500);
  for (let i = 0; i < 4; i++) {
    await smoothScroll(page, 280, 1300);
    await hold(900);
  }
});

// Brief + code (0:21-0:30 fallback path: approve on the Desk banner, same single-use code path).
await beat("brief", ["One brief. One single-use code.", "Nothing sends without your yes"], async (b) => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await hold(1200);
  const btn = page.getByRole("button", { name: /Approve & send/ }).first();
  if ((await btn.count()) === 0) {
    report.approval = "no pending brief on the Desk";
    b.captions = []; // nothing to caption truthfully
    await hold(2500);
    return;
  }
  await hoverSlow(page, btn);
  await hold(2500);
  if (!flag("approve")) return;
  const c = await pendingIsDemoOnly(BASE);
  if (!c.ok) {
    report.approval = `NOT clicked: recipient domains ${c.domains.join(", ")}`;
    return;
  }
  await btn.click();
  report.approved = true;
  report.approval = `clicked: all ${c.n} recipient(s) @agentmail.to`;
  b.captions.push("Approved: replies sent once (demo inboxes)");
  await hold(6000);
});

// 0:30-0:55 How it decides: coffee card (SMALLER), invite card (YES + evidence).
await beat("coffee-card", ["The model suggests. The rules decide.", 'Not "no". "Smaller."'], async () => {
  const card = cardFor(/Coffee/i);
  const rules = card.locator('section[aria-label="Rules decide"]').first();
  await glideTo(page, rules, 1500, 280);
  await hoverSlow(page, rules);
  await hold(4500);
});
await beat("invite-evidence", ["A claim needs 2 independent sites"], async () => {
  let ev = cardFor(/Tech Week|Builder/i).locator('ul[aria-label="Evidence"]').first();
  if ((await ev.count()) === 0) ev = page.locator('ul[aria-label="Evidence"]').first();
  await glideTo(page, ev, 1500, 340);
  await hoverSlow(page, ev);
  await hold(4500);
});

// 1:20-1:26 Safety: the BLOCKED card.
await beat("blocked", ["Injection: BLOCKED, never obeyed"], async () => {
  const card = page.locator("article, li, div").filter({ hasText: /Quarantine/i, has: page.locator('section[aria-label="Rules decide"]') }).last();
  await glideTo(page, card, 1500, 120);
  await hold(4500);
});

// Web intake: paste one ask on camera, then cut the LLM wait (sped up + labelled in assembly).
if (!flag("no-paste")) {
  await beat("add-ask", ["Paste any ask. Same rules as email."], async () => {
    const ta = page.locator('form[aria-label="Add an ask"] textarea').first();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await hold(900);
    await ta.scrollIntoViewIfNeeded();
    await glideTo(page, ta, 900, 200);
    await hoverSlow(page, ta);
    await ta.click();
    await page.keyboard.type(PASTE, { delay: 18 });
    await hold(1200);
    if (flag("dry")) {
      report.pasted = "dry run: typed, not submitted";
      await ta.fill("");
      return;
    }
    const before = new Set((await desk()).asks.map((a) => a.id));
    const decide = page.locator('form[aria-label="Add an ask"] button[type="submit"]').first();
    await hoverSlow(page, decide);
    await decide.click();
    const waitFrom = now() + 1.5;
    await hold(1500);
    // Show the new card's stages while it is decided.
    const h = page.getByRole("heading", { name: /Asks/ }).first();
    await glideTo(page, h, 1200, 90);
    let landed = null;
    const until = Date.now() + WAIT_MAX;
    while (Date.now() < until) {
      const d = await desk().catch(() => null);
      const fresh = d?.asks?.find((a) => !before.has(a.id));
      if (fresh && fresh.verdict) {
        landed = fresh;
        break;
      }
      await sleep(1000);
    }
    const waitTo = now();
    if (waitTo - waitFrom > 6) {
      const factor = Math.max(4, Math.ceil((waitTo - waitFrom) / 8));
      speed.push({ from: Number(waitFrom.toFixed(2)), to: Number(waitTo.toFixed(2)), factor, label: `${factor}x - LLM wait cut` });
    }
    if (landed) {
      const v = String(landed.verdict).replace("_", " ");
      report.pasted = { verdict: landed.verdict, title: landed.title };
      // A truthful caption: the verdict actually on screen.
      beats[beats.length - 1].captions.push(`Verdict on screen: ${v}`);
      const card = cardFor(new RegExp(String(landed.title ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 40), "i"));
      const rules = card.locator('section[aria-label="Rules decide"]').first();
      if (await rules.count()) {
        await glideTo(page, rules, 1300, 300);
        await hoverSlow(page, rules);
      }
      await hold(5000);
    } else {
      report.pasted = "submitted; no verdict within wait-max";
      await hold(2000);
    }
  });
}

// 1:02-1:08 Demo time skip (opt-in): labelled on screen.
if (flag("timeskip")) {
  await beat("timeskip", ["DEMO: skip to tomorrow", '"Was it worth it? 1-5"'], async () => {
    const btn = page.getByRole("button", { name: /Demo: skip to tomorrow/ }).first();
    await glideTo(page, btn, 1200, 200);
    await hoverSlow(page, btn);
    await hold(800);
    const a = now();
    await btn.click();
    report.timeskip = true;
    await hold(5000);
    speed.push({ from: Number(a.toFixed(2)), to: Number(now().toFixed(2)), factor: 1, label: "DEMO: TIME SKIPPED TO TOMORROW" });
  });
}

// 2:05-2:10 assistant-ui: the Desk chat.
await beat("chat", ["assistant-ui: the Desk chat. Ask Fewer why."], async () => {
  const open = page.getByRole("button", { name: /Ask Fewer/ }).first();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await hold(800);
  await hoverSlow(page, open);
  await open.click();
  await hold(2500);
  if (flag("chat-send")) {
    const input = page.getByRole("textbox", { name: "Message Fewer" });
    await input.click();
    await page.keyboard.type("Why smaller?", { delay: 40 });
    await page.getByRole("button", { name: "Send message" }).click();
    report.chatSent = true;
    const a = now();
    // Wait for the answer to stop streaming (Stop button disappears), max 40 s.
    await page.getByRole("button", { name: "Stop" }).waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    await page.getByRole("button", { name: "Stop" }).waitFor({ state: "hidden", timeout: 40000 }).catch(() => {});
    const b = now();
    if (b - a > 6) {
      const factor = Math.max(4, Math.ceil((b - a) / 6));
      speed.push({ from: Number((a + 1).toFixed(2)), to: Number(b.toFixed(2)), factor, label: `${factor}x - LLM wait cut` });
    }
    await hold(5000);
  } else {
    await hold(3000);
  }
  const close = page.getByRole("button", { name: "Close chat" });
  if (await close.count()) await close.click();
  await hold(1000);
});

if (flag("proactive")) {
  await beat("proactive", ["Proactive check (demo button)"], async () => {
    const btn = page.getByRole("button", { name: /Run proactive check now/ }).first();
    await glideTo(page, btn, 1400, 300);
    await hoverSlow(page, btn);
    await hold(800);
    await btn.click();
    report.proactive = true;
    const s = Date.now();
    while (Date.now() - s < 30000 && /Checking/.test((await btn.textContent()) ?? "")) await sleep(500);
    await hold(4000);
  });
}

// 2:20-2:25 Close: the Desk with this week's verdicts.
await beat("close", ["Fewer: fewer yeses, better ones."], async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await hold(1500);
  const h = page.getByRole("heading", { name: /Asks/ }).first();
  await glideTo(page, h, 1600, 90);
  await hold(3500);
});
const endAt = now();

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
const dest = path.join(OUT, `${NAME}.webm`);
fs.copyFileSync(raw, dest);
fs.rmSync(raw, { force: true });

// ---- captions in the FINAL timeline (title card + trimmed, sped-up clip) ----
speed.sort((x, y) => x.from - y.from);
function toFinal(t) {
  let out = titleD;
  let cur = startAt;
  for (const s of speed) {
    if (t <= s.from) break;
    out += Math.max(0, s.from - cur);
    out += (Math.min(t, s.to) - s.from) / s.factor;
    cur = s.to;
    if (t <= s.to) return out;
  }
  return out + Math.max(0, t - cur);
}
const ts = (x) => {
  const ms = Math.max(0, Math.round(x * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
};
let n = 0;
const srt = [];
for (const b of beats) {
  const A = toFinal(b.a);
  const B = toFinal(b.b ?? endAt);
  const k = b.captions.length;
  if (!k || B - A < 0.8) continue;
  const step = (B - A) / k;
  b.captions.forEach((text, i) => {
    srt.push(`${++n}\n${ts(A + i * step + 0.1)} --> ${ts(A + (i + 1) * step - 0.1)}\n${text}\n`);
  });
}
fs.writeFileSync(path.join(OUT, `${NAME}.srt`), srt.join("\n"));
fs.writeFileSync(path.join(OUT, `${NAME}.speed.json`), JSON.stringify(speed, null, 2));
fs.writeFileSync(path.join(OUT, `${NAME}.beats.json`), JSON.stringify({ startAt, endAt, beats, speed, report }, null, 2));

const finalLen = toFinal(endAt) + 5;
console.log("saved", dest);
console.log("report", JSON.stringify(report));
console.log(`estimated final length ~${finalLen.toFixed(1)} s (title + clip + 5 s end card)`);
console.log("\nNext (review/edit the .srt first if you like):");
console.log(
  `node video/tools/assemble.mjs --clip video/out/${NAME}.webm --ss ${startAt.toFixed(2)} --to ${endAt.toFixed(2)} --speed video/out/${NAME}.speed.json --srt video/out/${NAME}.srt --out video/out/fewer-final.mp4`,
);
