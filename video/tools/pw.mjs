// Shared Playwright loader + helpers for the video tools. Playwright is installed GLOBALLY
// (npm i -g playwright), never in the repo's package.json.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req("playwright");
  } catch {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(path.join(root, "noop.js"))("playwright");
  }
}

/** Use the matching Playwright browser if installed, else the newest local Chromium build. */
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (!fs.existsSync(base)) return undefined;
  const dirs = fs
    .readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(base, d, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Smooth scroll by `px` over `ms` in small steps (looks natural on video). */
export async function smoothScroll(page, px, ms = 2000) {
  // Eased JS scroll (mouse.wheel steps are slow and jerky in headless video).
  await page.evaluate(([dy, dur]) => new Promise((done) => {
    const y0 = window.scrollY, t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, y0 + dy * ease(k));
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }), [px, ms]);
}

/** Scroll an element into the upper-middle of the viewport, smoothly. */
export async function glideTo(page, locator, ms = 1500, offset = 140) {
  const box = await locator.boundingBox();
  if (!box) return;
  await smoothScroll(page, box.y - offset, ms);
}

/** Move the mouse visibly to a locator's centre (headless has no cursor, but hover states show). */
export async function hoverSlow(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
}

/** True only if every pending draft recipient ends with @agentmail.to. Returns { ok, domains, n }. */
export async function pendingIsDemoOnly(base) {
  const res = await fetch(`${base}/api/desk`);
  const d = await res.json();
  const p = d.pending;
  if (!p || !Array.isArray(p.drafts) || p.drafts.length === 0) return { ok: false, domains: [], n: 0, none: true };
  const tos = p.drafts.flatMap((x) => (Array.isArray(x.to) ? x.to : [x.to])).map((t) => String(t ?? "").trim().toLowerCase());
  const domains = [...new Set(tos.map((t) => t.replace(/^.*@/, "@")))];
  const ok = tos.length > 0 && tos.every((t) => t.endsWith("@agentmail.to"));
  return { ok, domains, n: tos.length, none: false, expiresAt: p.expiresAt };
}

/** Injects a visible cursor dot so clicks read on video (headless Chromium draws no cursor). */
export const CURSOR_SCRIPT = `
(() => {
  if (window.__fewerCursor) return; window.__fewerCursor = true;
  const add = () => {
    const d = document.createElement('div');
    d.id = '__vid_cursor';
    d.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;border-radius:50%;background:rgba(255,196,0,.55);border:2px solid #111;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);transition:width .12s,height .12s';
    document.documentElement.appendChild(d);
    addEventListener('mousemove', e => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { d.style.width = '14px'; d.style.height = '14px'; }, true);
    addEventListener('mouseup', () => { d.style.width = '22px'; d.style.height = '22px'; }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();
`;
