import type { EvidenceClaim } from "./contracts";

export interface CorroborationResult {
  verified: number;
  perClaim: { text: string; verified: boolean; domains: string[] }[];
}

/**
 * Naive registrable domain: lowercase, strip scheme/path/port, strip "www.",
 * keep the last two labels. "events.luma.com" and "luma.com" -> "luma.com".
 * (Multi-part public suffixes like "co.uk" are not special-cased.)
 */
export function registrableDomain(input: string): string {
  let host = input.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    }
  }
  host = host.split("/")[0] ?? "";
  host = host.split(":")[0] ?? "";
  host = host.replace(/\.+$/, "").replace(/^www\./, "");
  const labels = host.split(".").filter(Boolean);
  return labels.length <= 2 ? labels.join(".") : labels.slice(-2).join(".");
}

/**
 * A claim is verified iff its sources with quoteFound === true span at least
 * 2 distinct registrable domains.
 */
export function corroborate(claims: EvidenceClaim[]): CorroborationResult {
  const perClaim = claims.map((claim) => {
    const domains: string[] = [];
    for (const source of claim.sources) {
      if (source.quoteFound !== true) continue;
      const domain = registrableDomain(source.domain || source.url);
      if (domain && !domains.includes(domain)) domains.push(domain);
    }
    return { text: claim.text, verified: domains.length >= 2, domains };
  });
  return { verified: perClaim.filter((c) => c.verified).length, perClaim };
}
