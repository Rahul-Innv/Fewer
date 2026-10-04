import { describe, expect, it } from "vitest";
import type { EvidenceClaim, EvidenceSource } from "../contracts";
import { corroborate, registrableDomain } from "../corroborate";

function src(domain: string, quoteFound = true, url = `https://${domain}/page`): EvidenceSource {
  return { domain, url, quote: "quoted text", quoteFound, checkedAt: "2026-10-04T12:00:00-07:00" };
}

describe("registrableDomain", () => {
  it("strips www and keeps the last two labels", () => {
    expect(registrableDomain("www.lu.ma")).toBe("lu.ma");
    expect(registrableDomain("events.luma.com")).toBe("luma.com");
    expect(registrableDomain("luma.com")).toBe("luma.com");
    expect(registrableDomain("WWW.Example.ORG.")).toBe("example.org");
  });

  it("accepts a full URL", () => {
    expect(registrableDomain("https://www.events.agentmail.to:443/x?y=1")).toBe("agentmail.to");
  });
});

describe("corroborate", () => {
  it("subdomain and apex of the same site count as one domain", () => {
    const claim: EvidenceClaim = { text: "same site twice", sources: [src("events.luma.com"), src("luma.com")] };
    const r = corroborate([claim]);
    expect(r.verified).toBe(0);
    expect(r.perClaim[0]).toEqual({ text: "same site twice", verified: false, domains: ["luma.com"] });
  });

  it("www and bare host dedupe, two different sites verify", () => {
    const claim: EvidenceClaim = { text: "two sites", sources: [src("www.lu.ma"), src("lu.ma"), src("agentmail.to")] };
    const r = corroborate([claim]);
    expect(r.verified).toBe(1);
    expect(r.perClaim[0]?.domains).toEqual(["lu.ma", "agentmail.to"]);
  });

  it("sources whose quote was not found do not count", () => {
    const claim: EvidenceClaim = { text: "one real", sources: [src("lu.ma"), src("agentmail.to", false)] };
    expect(corroborate([claim]).verified).toBe(0);
    expect(corroborate([claim]).perClaim[0]?.domains).toEqual(["lu.ma"]);
  });

  it("falls back to the URL host when domain is empty", () => {
    const claim: EvidenceClaim = {
      text: "url fallback",
      sources: [src("", true, "https://www.lu.ma/e"), src("agentmail.to")],
    };
    expect(corroborate([claim]).verified).toBe(1);
  });

  it("counts verified claims across several claims", () => {
    const claims: EvidenceClaim[] = [
      { text: "a", sources: [src("lu.ma"), src("agentmail.to")] },
      { text: "b", sources: [src("lu.ma")] },
      { text: "c", sources: [src("x.com"), src("news.ycombinator.com"), src("ycombinator.com")] },
      { text: "d", sources: [] },
    ];
    const r = corroborate(claims);
    expect(r.verified).toBe(2);
    expect(r.perClaim.map((c) => c.verified)).toEqual([true, false, true, false]);
  });

  it("empty input verifies nothing", () => {
    expect(corroborate([])).toEqual({ verified: 0, perClaim: [] });
  });
});
