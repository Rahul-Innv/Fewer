import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SURFACES, VERDICTS, VERDICT_ORDER } from "./tokens";

/**
 * Lockstep test (design KB: tokens-and-aa-enforcement).
 * 1) Recomputes WCAG 2.x contrast for every color pair the Desk renders. Change the hex, never the threshold.
 * 2) Fails if globals.css `@theme` drifts from tokens.ts.
 */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

describe("verdict tokens meet WCAG AA", () => {
  for (const [name, v] of Object.entries(VERDICTS)) {
    it(`${name}: label text on chip background >= 4.5`, () => {
      expect(contrast(v.fg, v.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${name}: verdict text on white card >= 4.5`, () => {
      expect(contrast(v.fg, SURFACES.surface)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${name}: accent bar/edge against white card >= 3`, () => {
      expect(contrast(v.accent, SURFACES.surface)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    });
    it(`${name}: white text on solid chip (accent) >= 4.5`, () => {
      expect(contrast("#ffffff", v.accent)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${name}: solid chip (accent) against paper >= 3 (survives compressed video)`, () => {
      expect(contrast(v.accent, SURFACES.paper)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    });
    it(`${name}: solid class is white on its own accent role`, () => {
      const role = name.toLowerCase().replace("_", "");
      expect(v.solid).toBe(`bg-${role}-accent text-white`);
    });
  }
});

describe("VERDICT_ORDER", () => {
  it("lists every verdict exactly once", () => {
    expect([...VERDICT_ORDER].sort()).toEqual(Object.keys(VERDICTS).sort());
  });
});

describe("surface tokens meet WCAG AA", () => {
  const text: [string, string, string][] = [
    ["ink on paper", SURFACES.ink, SURFACES.paper],
    ["ink on surface", SURFACES.ink, SURFACES.surface],
    ["muted on paper", SURFACES.muted, SURFACES.paper],
    ["muted on surface", SURFACES.muted, SURFACES.surface],
    ["action ink on action", SURFACES.actionInk, SURFACES.action],
    ["warn text on warn bg", SURFACES.warnFg, SURFACES.warnBg],
    ["warn text on paper", SURFACES.warnFg, SURFACES.paper],
  ];
  for (const [label, fg, bg] of text) {
    it(`${label} >= 4.5`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT));
  }
  it("focus ring on paper and surface >= 3", () => {
    expect(contrast(SURFACES.focus, SURFACES.paper)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    expect(contrast(SURFACES.focus, SURFACES.surface)).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });
  it("borders that carry meaning (lineStrong) vs paper >= 1.4 (decorative hairline, text never relies on it)", () => {
    expect(contrast(SURFACES.lineStrong, SURFACES.paper)).toBeGreaterThanOrEqual(1.4);
  });
  it("verdict text on the paper background (ledger counters, status pills) >= 4.5", () => {
    for (const v of Object.values(VERDICTS)) expect(contrast(v.fg, SURFACES.paper)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("globals.css mirrors tokens.ts (no drift)", () => {
  const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
  const read = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

  const roleOf = (verdict: string) => verdict.toLowerCase().replace("_", "");
  for (const [verdict, v] of Object.entries(VERDICTS)) {
    const r = roleOf(verdict);
    it(`${verdict} bg/fg/accent`, () => {
      expect(read(`${r}-bg`)).toBe(v.bg);
      expect(read(`${r}-fg`)).toBe(v.fg);
      expect(read(`${r}-accent`)).toBe(v.accent);
    });
  }
  it("surfaces", () => {
    expect(read("paper")).toBe(SURFACES.paper);
    expect(read("surface")).toBe(SURFACES.surface);
    expect(read("ink")).toBe(SURFACES.ink);
    expect(read("muted")).toBe(SURFACES.muted);
    expect(read("line")).toBe(SURFACES.line);
    expect(read("line-strong")).toBe(SURFACES.lineStrong);
    expect(read("focus")).toBe(SURFACES.focus);
    expect(read("action")).toBe(SURFACES.action);
    expect(read("action-ink")).toBe(SURFACES.actionInk);
    expect(read("warn-bg")).toBe(SURFACES.warnBg);
    expect(read("warn-fg")).toBe(SURFACES.warnFg);
  });
});
