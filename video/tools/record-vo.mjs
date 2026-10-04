// Narrated take: records shots 2-10 against the running Desk at 1280x720 (rendered at 1.5x, captured at
// 1920x1080) and writes video/out/<name>.webm + <name>.shots.json for assemble-vo.mjs.
// --dry : no side effects (hover only on Email my plan / reorder / Approve demo / Skip to tomorrow).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPlaywright, chromiumPath, sleep, smoothScroll, glideTo, hoverSlow, CURSOR_SCRIPT } from "./pw.mjs";

const BASE = process.env.DESK_URL ?? "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../out");
const VO = path.join(OUT, "vo");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const NAME = argv.includes("--name") ? argv[argv.indexOf("--name") + 1] : DRY ? "dry-take" : "final-take";
const dur = (f) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim()) || 0;
const voLen = (n) => dur(path.join(VO, `l${n}.mp3`));

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath: chromiumPath() });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1.5,
  colorScheme: "light",
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
await context.addInitScript(CURSOR_SCRIPT);
await context.addInitScript(`(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; (document.head||document.documentElement).appendChild(s); })();`);
const page = await context.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const log = [];
const shots = [];
const sends = [];

async function shot(n, name, minLen, fn) {
  const s = { n, name, line: n, a: now(), b: null, speed: [], labels: [], skipped: false, note: "" };
  shots.push(s);
  console.log(`[${s.a.toFixed(1)}s] shot ${n} ${name}`);
  const want = Math.max(minLen, voLen(n) + 0.8);
  try {
    await fn(s);
  } catch (e) {
    s.note = `partial: ${String(e.message).split("\n")[0]}`;
    console.log("  " + s.note);
  }
  // Make sure the shot (after speed-ups) is long enough for its line.
  const spent = now() - s.a - s.speed.reduce((x, r) => x + (r.to - r.from) * (1 - 1 / r.factor), 0);
  if (!s.skipped && spent < want) await sleep((want - spent) * 1000);
  s.b = now();
}
async function waitBusy(fromLabel, s, maxMs, check) {
  const a = now();
  const until = Date.now() + maxMs;
  let ok = false;
  while (Date.now() < until) {
    if (await check().catch(() => false)) { ok = true; break; }
    await sleep(300);
  }
  const b = now();
  return { a, b, ok, took: b - a };
}
const top = () => page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.getByRole("radio", { name: /^Before/ }).first().waitFor({ timeout: 90000 }).catch(() => console.log("Before radio not seen"));
await page.getByRole("region", { name: /Your goals/ }).getByRole("listitem").first().waitFor({ timeout: 30000 }).catch(() => {});
// Start on Plan / Live.
await page.getByRole("radio", { name: "Live" }).click().catch(() => {});
await page.getByRole("tab", { name: /^Plan/ }).click().catch(() => {});
await page.getByRole("radio", { name: /^Before/ }).first().waitFor({ timeout: 60000 }).catch(() => {});
await sleep(2500);
await page.mouse.move(640, 360);
const startAt = now() - 0.1;

// 2 header + goals
await shot(2, "header-goals", 8, async () => {
  await hoverSlow(page, page.getByRole("button", { name: "Email my plan" }));
  await sleep(1500);
  const goals = page.getByRole("region", { name: /Your goals/ });
  await hoverSlow(page, goals.getByRole("listitem").nth(0));
  await sleep(1800);
  await hoverSlow(page, goals.getByRole("listitem").nth(1));
  await sleep(1800);
  await hoverSlow(page, goals.getByRole("listitem").nth(2));
});

// 3 Before view, Tuesday clash
const facts = { total: null, clash: null };
await shot(3, "before-tuesday", 12, async (s) => {
  const before = page.getByRole("radio", { name: /^Before/ });
  const lbl = (await before.textContent().catch(() => "")) || (await before.getAttribute("aria-label").catch(() => "")) || "";
  const m = /(\d+)\s+invites/.exec(lbl) || /(\d+)/.exec(lbl);
  facts.total = m ? Number(m[1]) : null;
  await glideTo(page, page.getByRole("heading", { name: /Your events/ }).first(), 1500, 90);
  await hoverSlow(page, before);
  await before.click();
  await sleep(1200);
  const tue = page.getByRole("region", { name: /Tuesday/ }).first();
  const marks = await tue.getByText(/at the same time/).allTextContents().catch(() => []);
  let best = null;
  for (const t of marks) {
    const mm = /(\d{1,2}):\d\d\s*(AM|PM).*?(\d+)\s+events? at the same time/i.exec(t);
    if (mm && (!best || Number(mm[3]) > best.n)) best = { n: Number(mm[3]), h: (Number(mm[1]) % 12) + (mm[2].toUpperCase() === "PM" ? 12 : 0), text: t };
  }
  facts.clash = best;
  // Scroll slowly through Monday into Tuesday.
  const mon = page.getByRole("region", { name: /Monday/ }).first();
  await glideTo(page, mon, 2500, 70);
  await sleep(1200);
  await glideTo(page, tue, 3000, 70);
  const mark = tue.getByText(/at the same time/).last();
  await hoverSlow(page, mark);
  await sleep(3500);
  await smoothScroll(page, 360, 2500);
});

// 4 After view, Yes rows, expand a Yes and a Shorter
await shot(4, "after-yes", 15, async () => {
  const after = page.getByRole("radio", { name: /^After/ });
  await glideTo(page, page.getByRole("heading", { name: /Your events/ }).first(), 1500, 90);
  await hoverSlow(page, after);
  await after.click();
  await sleep(1500);
  await smoothScroll(page, 260, 2200);
  await sleep(800);
  // Expand the first Yes row (a day without overlaps, Wednesday or Friday preferred).
  let day = page.getByRole("region", { name: /Tuesday/ }).first();
  if (!(await day.count())) day = page.getByRole("region", { name: /Monday/ }).first();
  await glideTo(page, day, 2000, 90);
  const yes = day.getByRole("article").first().getByRole("button").first();
  await hoverSlow(page, yes);
  await yes.click();
  await sleep(3500);
  const grp = day.locator("details summary").filter({ hasText: /Shorter/ }).first();
  if (await grp.count()) {
    await hoverSlow(page, grp);
    await grp.click();
    await sleep(900);
    const row = day.locator("details[open] article button").first();
    await hoverSlow(page, row);
    await row.click();
    await sleep(1000);
    await smoothScroll(page, 220, 1500);
    await sleep(2500);
  }
});

// 5 Goals reorder
await shot(5, "reorder", 12, async (s) => {
  await top();
  await sleep(1200);
  const name = "Meet personal-AI builders & users";
  const up = page.getByRole("button", { name: `Move ${name} up` });
  const down = page.getByRole("button", { name: `Move ${name} down` });
  const busy = page.getByText("Re-checking your asks");
  await hoverSlow(page, up);
  await sleep(700);
  if (DRY) { s.note = "dry: hover only"; await sleep(4000); return; }
  await up.click();
  await sleep(350);
  await up.click();
  await sleep(900);
  const w1 = await waitBusy("up", s, 25000, async () => !(await busy.count()));
  log.push(`reorder up took ${w1.took.toFixed(1)}s ok=${w1.ok}`);
  if (!w1.ok) { s.note = "reorder up > 25 s"; }
  if (w1.took > 6) s.speed.push({ from: w1.a + 1.5, to: w1.b, factor: Math.max(4, Math.ceil((w1.took - 1.5) / 2)), label: "sped up" });
  await sleep(3000); // toast + highlight
  await hoverSlow(page, down);
  await down.click();
  await sleep(350);
  await down.click();
  await sleep(900);
  const w2 = await waitBusy("down", s, 25000, async () => !(await busy.count()));
  log.push(`reorder down took ${w2.took.toFixed(1)}s ok=${w2.ok}`);
  if (w2.took > 6) s.speed.push({ from: w2.a + 1.5, to: w2.b, factor: Math.max(4, Math.ceil((w2.took - 1.5) / 2)), label: "sped up" });
  await sleep(1500);
  const order = await page.getByRole("region", { name: /Your goals/ }).getByRole("listitem").allTextContents();
  log.push(`goal order after: ${order.map((t) => t.replace(/\s+/g, " ").slice(0, 40)).join(" | ")}`);
  s.total = w1.took + w2.took;
});

// 6 Email my plan
await shot(6, "email-plan", 6.5, async (s) => {
  await top();
  const btn = page.getByRole("button", { name: "Email my plan" });
  await hoverSlow(page, btn);
  await sleep(800);
  if (DRY) { s.note = "dry: hover only"; await sleep(3000); return; }
  await btn.click();
  sends.push("Email my plan (Live)");
  await page.getByText(/Plan sent to/).first().waitFor({ timeout: 20000 }).catch(() => log.push("no 'Plan sent' toast within 20 s"));
  const toast = await page.getByText(/Plan sent to/).first().textContent().catch(() => null);
  log.push(`plan toast: ${toast}`);
  await sleep(3500);
});

// 7 Demo -> Run demo -> approve demo
await shot(7, "demo-approve", 24, async (s) => {
  const demo = page.getByRole("radio", { name: "Demo" });
  await hoverSlow(page, demo);
  await demo.click();
  await sleep(2000);
  const codeOf = async () => (await page.getByRole("group", { name: /waiting for you/ }).first().getByText(/^[A-Z0-9]{4}$/).first().textContent({ timeout: 1500 }).catch(() => null));
  const oldCode = await codeOf();
  const run = page.getByRole("button", { name: "Run demo" });
  await hoverSlow(page, run);
  await sleep(700);
  await run.click();
  log.push(`Run demo clicked (old code ${oldCode})`);
  await sleep(1500);
  const w = await waitBusy("demo", s, 90000, async () => {
    const c = await codeOf();
    const ok = await page.getByRole("button", { name: "Approve demo" }).isEnabled().catch(() => false);
    return c && c !== oldCode && ok;
  });
  log.push(`demo run wait ${w.took.toFixed(1)}s ok=${w.ok} code=${await codeOf()}`);
  if (w.took > 4) s.speed.push({ from: w.a, to: w.b, factor: Math.max(4, Math.min(16, Math.ceil(w.took / 3))), label: "sped up" });
  const card = page.getByRole("group", { name: /waiting for you/ }).first();
  await glideTo(page, card, 1500, 120);
  await sleep(2500);
  const ap = page.getByRole("button", { name: "Approve demo" });
  await hoverSlow(page, ap);
  await sleep(1200);
  if (DRY) { s.note = "dry: hover only on Approve demo"; await sleep(3000); return; }
  if (!w.ok) log.push("demo code did not change; approving the visible demo brief");
  await ap.click();
  sends.push("Approve demo (Demo)");
  await sleep(1500);
  const r = await page.getByText(/^(Sent|Approved|Nothing new sent)/).first().textContent({ timeout: 15000 }).catch(() => null);
  log.push(`approve receipt: ${r}`);
  await sleep(3500);
});

// 8 Blocked card
await shot(8, "blocked", 6.5, async (s) => {
  const stat = page.getByRole("button", { name: /^Blocked/ }).first();
  if (await stat.count()) { await hoverSlow(page, stat); await stat.click().catch(() => {}); await sleep(1200); }
  let row = page.getByRole("article").filter({ hasText: /Blocked/ }).first();
  if (!(await row.count()) || !(await row.isVisible().catch(() => false))) {
    for (const sm of await page.locator("details:not([open]) summary").all()) await sm.click().catch(() => {});
    await sleep(600);
    row = page.getByRole("article").filter({ hasText: /Blocked/ }).first();
  }
  if (!(await row.count())) { s.skipped = true; s.note = "no Blocked card"; return; }
  await glideTo(page, row, 1500, 160);
  const b = row.getByRole("button").first();
  await hoverSlow(page, b);
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await sleep(1000);
  await smoothScroll(page, 200, 1200);
  await sleep(2500);
});

// 9 Activity -> Skip to tomorrow
await shot(9, "timeskip", 10, async (s) => {
  await top();
  await sleep(600);
  await page.getByRole("tab", { name: /^Activity/ }).click();
  await sleep(1500);
  const btn = page.getByRole("button", { name: /Skip to tomorrow/ });
  await glideTo(page, btn, 1200, 300);
  await hoverSlow(page, btn);
  await sleep(800);
  if (DRY) { s.note = "dry: hover only"; await sleep(3000); return; }
  const a = now();
  await btn.click();
  sends.push("Skip to tomorrow (demo check-ins to the approver inbox)");
  s.labels.push({ from: a, to: a + 6, text: "demo: time skipped" });
  const note = await page.getByText(/^Tomorrow\./).first().textContent({ timeout: 20000 }).catch(() => null);
  log.push(`timeskip note: ${note}`);
  await sleep(4000);
});

// 10 Ask Fewer
await shot(10, "ask-fewer", 10, async (s) => {
  await top();
  const open = page.getByRole("button", { name: "Ask Fewer" });
  await hoverSlow(page, open);
  await open.click();
  await sleep(1500);
  const input = page.getByRole("textbox", { name: "Message Fewer" });
  await input.click({ timeout: 5000 });
  await page.keyboard.type("Why did you say no to the panel?", { delay: 35 });
  await sleep(400);
  await page.getByRole("button", { name: "Send message" }).click();
  const a = now();
  const stop = page.getByRole("button", { name: /Stop|Cancel/ });
  await stop.first().waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  await page.getByRole("button", { name: "Send message" }).waitFor({ state: "visible", timeout: 30000 }).catch(() => log.push("chat still running after 30 s"));
  const b = now();
  log.push(`chat answer took ${(b - a).toFixed(1)}s`);
  if (b - a > 6) s.speed.push({ from: a + 2, to: b, factor: Math.max(3, Math.ceil((b - a - 2) / 3)), label: "sped up" });
  await sleep(4500);
});

const endAt = now();
const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
const dest = path.join(OUT, `${NAME}.webm`);
fs.copyFileSync(raw, dest);
fs.rmSync(raw, { force: true });
fs.writeFileSync(path.join(OUT, `${NAME}.shots.json`), JSON.stringify({ dry: DRY, startAt, endAt, shots, facts, log, sends }, null, 2));
console.log("saved", dest);
console.log(JSON.stringify({ facts, log, sends, shots: shots.map((s) => ({ n: s.n, len: (s.b - s.a).toFixed(1), note: s.note, speed: s.speed.length })) }, null, 2));
