import { Exa } from "exa-js";
import type { EvidenceClaim, ParsedAsk } from "@/core";

/**
 * Who is asking? Exa research for an ask. Never throws: returns [] (and console.warns) on failure.
 *
 * Flow (25s overall budget):
 *  1. exa.search(`${organizer} ${title}`) and, when the ask has a url, the same query restricted to
 *     the url's domain. numResults 5, contents.highlights = true.
 *  2. Build up to 2 claims ("<organizer> hosts <title>", "<title> takes place on <date>"). Each
 *     claim's sources are the best highlight per distinct registrable domain (max 3).
 *  3. exa.getContents(urls, { text: { maxCharacters: 20000 } }) and set quoteFound by checking the
 *     quote occurs (whitespace/case/quote-style normalized) in the fetched page text.
 * Core's corroborate() decides "verified": >= 2 distinct domains with quoteFound.
 */

const OVERALL_TIMEOUT_MS = 25_000;
const MAX_SOURCES_PER_CLAIM = 3;
const MAX_FETCH_URLS = 8;
const MAX_QUOTE_CHARS = 400;

let _exa: Exa | null = null;
function exa(): Exa {
  if (!_exa) {
    const key = process.env.EXA_API_KEY?.trim();
    if (!key) throw new Error("EXA_API_KEY is not set");
    _exa = new Exa(key, process.env.EXA_BASE_URL?.trim() || undefined); // EXA_BASE_URL: test hook only
  }
  return _exa;
}

// ---------- text helpers ----------

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "you", "our", "are", "will",
  "join", "event", "invite", "invited", "please", "about", "into", "have", "has", "its", "his",
  "her", "their", "who", "what", "when", "where", "how", "meetup", "inc", "llc", "ltd",
]);

function tokens(s: string | undefined): string[] {
  if (!s) return [];
  return [
    ...new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  ];
}

/** Normalize for comparison: lowercase, straight quotes/dashes, collapsed whitespace, no zero-width chars. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[​-‍﻿]/g, "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Fraction of tokens present as WHOLE words ("hack" must not match "hackathon"). */
function fraction(hay: string, toks: string[]): number {
  if (toks.length === 0) return 0;
  let hit = 0;
  // tokens() only yields [a-z0-9] words, so no regex escaping is needed
  for (const t of toks) if (new RegExp(`\\b${t}\\b`).test(hay)) hit++;
  return hit / toks.length;
}

function registrable(input: string): string {
  let host = input.trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    /* fall through */
  }
  host = (host.split("/")[0] ?? "").split(":")[0] ?? "";
  host = host.replace(/\.+$/, "").replace(/^www\./, "");
  const labels = host.split(".").filter(Boolean);
  return labels.length <= 2 ? labels.join(".") : labels.slice(-2).join(".");
}

const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may", "may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
] as const;

/** Regexes matching the calendar date of an ISO string (the date as written, in its own offset). */
function dateMatchers(startsAt: string | undefined): { label: string; res: RegExp[] } | null {
  const m = startsAt ? /^(\d{4})-(\d{2})-(\d{2})/.exec(startsAt) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const names = MONTHS[month - 1];
  if (!names) return null;
  const [full, short] = names;
  const d = String(day);
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const ord = `${d}(?:st|nd|rd|th)?`;
  const res = [
    new RegExp(`\\b(?:${full}|${short})\\.?\\s+${ord}\\b`, "i"),
    new RegExp(`\\b${ord}\\s+(?:of\\s+)?(?:${full}|${short})\\b`, "i"),
    new RegExp(`\\b${year}-${mm}-${dd}\\b`),
    new RegExp(`\\b0?${month}/0?${day}(?:/(?:${year}|${String(year).slice(2)}))?\\b`),
  ];
  const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return { label, res };
}

/** Candidate quotes from a highlight: each sentence/line plus the whole highlight when short. */
function candidates(highlight: string): string[] {
  const clean = highlight.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  const parts = highlight
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 20);
  for (const p of parts) out.push(p.length > MAX_QUOTE_CHARS ? p.slice(0, MAX_QUOTE_CHARS) : p);
  if (clean.length <= MAX_QUOTE_CHARS) out.push(clean);
  return out;
}

// ---------- search results ----------

interface Hit {
  url: string;
  domain: string;
  title: string;
  highlights: string[];
}

function toHits(results: Array<{ url: string; title: string | null; highlights?: string[] }>): Hit[] {
  return results
    .filter((r) => r.url && Array.isArray(r.highlights) && r.highlights.length > 0)
    .map((r) => ({
      url: r.url,
      domain: registrable(r.url),
      title: r.title ?? "",
      highlights: r.highlights ?? [],
    }));
}

interface Pick {
  url: string;
  domain: string;
  quote: string;
  score: number;
}

/** Best quote per distinct registrable domain for one claim, highest score first. */
function pickSources(hits: Hit[], score: (quote: string) => number): Pick[] {
  const bestByDomain = new Map<string, Pick>();
  for (const hit of hits) {
    for (const hl of hit.highlights) {
      for (const quote of candidates(hl)) {
        const s = score(quote);
        if (s <= 0) continue;
        const prev = bestByDomain.get(hit.domain);
        // prefer higher score; on ties prefer the shorter quote (less to verify)
        if (!prev || s > prev.score || (s === prev.score && quote.length < prev.quote.length)) {
          bestByDomain.set(hit.domain, { url: hit.url, domain: hit.domain, quote, score: s });
        }
      }
    }
  }
  return [...bestByDomain.values()].sort((a, b) => b.score - a.score).slice(0, MAX_SOURCES_PER_CLAIM);
}

// ---------- main ----------

interface ClaimDraft {
  text: string;
  picks: Pick[];
}

async function research(ask: ParsedAsk, signal: AbortSignal): Promise<EvidenceClaim[]> {
  const client = exa();
  const organizer = ask.organizer?.trim() || undefined;
  const title = ask.title?.trim() || ask.subject?.trim();
  if (!title) return [];

  const query = `${organizer ?? ""} ${title}`.trim();
  const urlDomain = (() => {
    if (!ask.url) return undefined;
    try {
      const host = new URL(/^[a-z]+:\/\//i.test(ask.url) ? ask.url : `https://${ask.url}`).hostname;
      return host.replace(/^www\./, "");
    } catch {
      return undefined;
    }
  })();

  const common = { type: "auto" as const, numResults: 5, contents: { highlights: true as const } };
  const searches = await Promise.allSettled([
    client.search(query, common),
    urlDomain ? client.search(query, { ...common, includeDomains: [urlDomain] }) : Promise.resolve(null),
  ]);
  if (signal.aborted) return [];

  const hits: Hit[] = [];
  const seenUrls = new Set<string>();
  for (const s of searches) {
    if (s.status === "rejected") {
      console.warn(`[research] search failed: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
      continue;
    }
    if (!s.value) continue;
    for (const h of toHits(s.value.results as Array<{ url: string; title: string | null; highlights?: string[] }>)) {
      if (seenUrls.has(h.url)) continue;
      seenUrls.add(h.url);
      hits.push(h);
    }
  }
  if (hits.length === 0) return [];

  // --- build claim drafts ---
  const titleToks = tokens(title);
  const orgToks = tokens(organizer);
  const drafts: ClaimDraft[] = [];

  const hostsPicks = pickSources(hits, (quote) => {
    const q = quote.toLowerCase();
    const t = fraction(q, titleToks);
    if (organizer) {
      const o = fraction(q, orgToks);
      if (o < 0.5 || t < 0.6) return 0;
      return o + t;
    }
    return t >= 0.75 ? t : 0;
  });
  if (hostsPicks.length > 0) {
    drafts.push({
      text: organizer ? `${organizer} hosts ${title}` : `${title} is a real, publicly listed event`,
      picks: hostsPicks,
    });
  }

  const date = dateMatchers(ask.startsAt);
  if (date) {
    const datePicks = pickSources(hits, (quote) => {
      if (!date.res.some((re) => re.test(quote))) return 0;
      const q = quote.toLowerCase();
      const t = fraction(q, titleToks);
      const o = organizer ? fraction(q, orgToks) : 0;
      if (t < 0.5) return 0;
      return 1 + t + o;
    });
    if (datePicks.length > 0) {
      drafts.push({ text: `${title} takes place on ${date.label}`, picks: datePicks });
    }
  }
  if (drafts.length === 0) return [];

  // --- verify quotes against fetched page text ---
  const urls = [...new Set(drafts.flatMap((d) => d.picks.map((p) => p.url)))].slice(0, MAX_FETCH_URLS);
  const pageText = new Map<string, string>();
  try {
    const fetched = await client.getContents(urls, { text: { maxCharacters: 20_000 } });
    for (const r of fetched.results) {
      const text = (r as { text?: string }).text;
      if (typeof text === "string") pageText.set(r.url, normalizeForMatch(text));
    }
  } catch (err) {
    console.warn(`[research] getContents failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (signal.aborted) return [];

  const checkedAt = new Date().toISOString();
  return drafts.map((d) => ({
    text: d.text,
    sources: d.picks.map((p) => {
      const page = pageText.get(p.url);
      const quoteFound = page !== undefined && page.includes(normalizeForMatch(p.quote));
      return { domain: p.domain, url: p.url, quote: p.quote, quoteFound, checkedAt };
    }),
  }));
}

export async function researchAsk(ask: ParsedAsk): Promise<EvidenceClaim[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, OVERALL_TIMEOUT_MS);
    });
    const result = await Promise.race([research(ask, controller.signal), timeout]);
    if (result === null) {
      console.warn(`[research] timed out after ${OVERALL_TIMEOUT_MS}ms for ask ${ask.id}`);
      return [];
    }
    return result;
  } catch (err) {
    console.warn(`[research] failed for ask ${ask.id}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
