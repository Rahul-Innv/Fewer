import { afterEach, describe, expect, it, vi } from "vitest";

// Real Mastra Agents with fake config; the real llm.ts needs the "@/core" alias and env. No DB in tests.
vi.mock("../../server/llm", async () => {
  const { Agent } = await import("@mastra/core/agent");
  const mk = (id: string) => new Agent({ id, name: id, instructions: "test", model: "openai/gpt-5-mini" });
  return {
    parserAgent: mk("fewer-parser"),
    drafterAgent: mk("fewer-drafter"),
    fewerAgent: mk("fewer"),
    fewerStore: () => {
      throw new Error("tests must never open the database");
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getMastra", () => {
  it("registers the three agents and is memoized (no DATABASE_URL: no storage, no DB access)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("MASTRA_PLATFORM_ACCESS_TOKEN", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getMastra } = await import("../factory");
    const mastra = await getMastra();

    expect(Object.keys(mastra.listAgents()).sort()).toEqual(["fewer", "fewerDrafter", "fewerParser"]);
    expect(mastra.getAgent("fewerParser").id).toBe("fewer-parser");
    expect(mastra.getAgent("fewerDrafter").id).toBe("fewer-drafter");
    expect(mastra.getAgent("fewer").id).toBe("fewer");
    expect(await getMastra()).toBe(mastra);
    // never builds an empty exporter list: with nothing to export to, observability is skipped with a warning
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("tracing off"));
    warn.mockRestore();
  }, 60_000); // first import of @mastra/core is slow
});
