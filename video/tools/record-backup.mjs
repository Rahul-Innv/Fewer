// Backup clip: a ~60 s walk of the CURRENT Desk. Read-only except two demo-safe clicks:
//  - "Approve & send" ONLY if every pending draft recipient ends with @agentmail.to (checked via GET /api/desk
//    immediately before the click).
//  - "Run proactive check now (demo)" (emails FEWER_APPROVER, a demo @agentmail.to inbox) unless --no-proactive.
// Usage: node video/tools/record-backup.mjs [--no-approve] [--no-proactive]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright, chromiumPath, sleep, smoothScroll, glideTo, hoverSlow, pendingIsDemoOnly, CURSOR_SCRIPT } from "./pw.mjs";

const BASE = process.env.DESK_URL ?? "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "out");
fs.mkdirSync(OUT, { recursive: true });
const args = new Set(process.argv.slice(2));

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath: chromiumPath() });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1.5,
  colorScheme: "light",
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
await context.addInitScript(CURSOR_SCRIPT);
const page = await context.newPage();
const t0 = Date.now();
const beats = [];
const mark = (name, extra = {}) => {
  const t = (Date.now() - t0) / 1000;
  beats.push({ t: Number(t.toFixed(2)), name, ...extra });
  console.log(`[${t.toFixed(1)}s] ${name}`, Object.keys(extra).length ? JSON.stringify(extra) : "");
};
const report = { approved: false, approvalReason: "", proactive: "" };

async function beat(name, fn) {
  mark(name);
  try {
    await fn();
  } catch (e) {
    console.log(`  beat "${name}" skipped: ${e.message.split("\n")[0]}`);
  }
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("load");
await sleep(3500);
await page.mouse.move(640, 360);

await beat("desk-top", async () => {
  await sleep(3000);
});

await beat("scroll-cards", async () => {
  for (let i = 0; i < 5; i++) {
    await smoothScroll(page, 300, 1400);
    await sleep(1100);
  }
});

await beat("open-card-reasons", async () => {
  const smaller = page.locator('section[aria-label="Rules decide"]');
  const n = await smaller.count();
  if (n === 0) throw new Error("no Rules decide sections");
  // Prefer the coffee card (SMALLER) if present.
  let target = page.locator("article, li, div").filter({ hasText: /Coffee/i, has: page.locator("section[aria-label=\"Rules decide\"]") }).last().locator('section[aria-label="Rules decide"]').first();
  if ((await target.count()) === 0) target = smaller.first();
  await glideTo(page, target, 1600, 260);
  await sleep(800);
  const card = target.locator("xpath=ancestor::*[.//button[@aria-expanded]][1]");
  const toggle = card.getByRole("button", { name: /Draft reply/ }).first();
  if (await toggle.count()) {
    await hoverSlow(page, toggle);
    await sleep(400);
    await toggle.click();
    await sleep(1200);
  }
  await hoverSlow(page, target);
  await sleep(3500);
});

await beat("evidence", async () => {
  const ev = page.locator('ul[aria-label="Evidence"]');
  if ((await ev.count()) === 0) throw new Error("no evidence chips");
  let target = page.locator("article, li, div").filter({ hasText: /Tech Week/i }).locator('ul[aria-label="Evidence"]').first();
  if ((await target.count()) === 0) target = ev.first();
  await glideTo(page, target, 1600, 320);
  await hoverSlow(page, target);
  await sleep(3500);
});

await beat("approval", async () => {
  const btn = page.getByRole("button", { name: /Approve & send/ }).first();
  if ((await btn.count()) === 0) {
    report.approvalReason = "no pending brief on the Desk";
    throw new Error(report.approvalReason);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1200);
  await btn.scrollIntoViewIfNeeded();
  await sleep(600);
  await hoverSlow(page, btn);
  await sleep(2500);
  const check = await pendingIsDemoOnly(BASE);
  report.recipientDomains = check.domains;
  if (args.has("--no-approve")) {
    report.approvalReason = "--no-approve flag";
  } else if (!check.ok) {
    report.approvalReason = `not all recipients are @agentmail.to (domains: ${check.domains.join(", ")})`;
  } else {
    await btn.click();
    report.approved = true;
    report.approvalReason = `all ${check.n} recipient(s) end with @agentmail.to`;
    mark("approve-clicked");
    await sleep(6000);
  }
  if (!report.approved) await sleep(2000);
});

await beat("ask-fewer-drawer", async () => {
  const open = page.getByRole("button", { name: /Ask Fewer/ }).first();
  await hoverSlow(page, open);
  await sleep(500);
  await open.click();
  await sleep(4500);
  await page.keyboard.press("Escape");
  await sleep(800);
  // If Escape did not close it, click the toggle again.
  if ((await open.getAttribute("aria-expanded")) === "true") {
    const close = page.getByRole("button", { name: /close/i }).first();
    if (await close.count()) await close.click();
    else await open.click({ force: true });
  }
  await sleep(1200);
});

if (!args.has("--no-proactive")) {
  await beat("proactive", async () => {
    const btn = page.getByRole("button", { name: /Run proactive check now/ }).first();
    if ((await btn.count()) === 0) throw new Error("no proactive button");
    await glideTo(page, btn, 1600, 300);
    await hoverSlow(page, btn);
    await sleep(1200);
    await btn.click();
    mark("proactive-clicked");
    // Wait until the button stops saying "Checking…" (max 25 s), then hold.
    const start = Date.now();
    while (Date.now() - start < 25000) {
      const label = (await btn.textContent()) ?? "";
      if (!/Checking/.test(label)) break;
      await sleep(500);
    }
    mark("proactive-done", { waitedS: Number(((Date.now() - start) / 1000).toFixed(1)) });
    report.proactive = "clicked";
    await sleep(4500);
  });
}

await beat("outro", async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(3000);
});
mark("end");

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
const dest = path.join(OUT, process.env.OUT_NAME ?? "backup-desk.webm");
fs.copyFileSync(raw, dest);
fs.rmSync(raw, { force: true });
fs.writeFileSync(dest.replace(/\.webm$/, ".beats.json"), JSON.stringify({ beats, report }, null, 2));
console.log("saved", dest);
console.log("report", JSON.stringify(report));
