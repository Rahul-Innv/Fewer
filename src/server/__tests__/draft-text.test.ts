import { beforeEach, describe, expect, it, vi } from "vitest";

// llm.ts builds Mastra agents at import time. Replace the heavy pieces so no env, database, network or
// model is touched; `generate` stands in for the drafter model.
const h = vi.hoisted(() => {
  process.env.FEWER_TRACING = "off";
  return { generate: vi.fn() };
});
vi.mock("@mastra/core/agent", () => ({
  Agent: class {
    generate = h.generate;
  },
}));
vi.mock("@mastra/memory", () => ({ Memory: class {} }));
vi.mock("@mastra/pg", () => ({ PostgresStore: class {} }));
// vitest has no "@/" alias here; hand llm.ts the real core through a relative path.
vi.mock("@/core", () => import("../../core"));
vi.mock("../db", () => ({ directDatabaseUrl: () => undefined }));
vi.mock("../env", () => ({
  assertModelCredentials: () => undefined,
  modelDraft: () => "test-model",
  modelFast: () => "test-model",
}));

import { draftReply, sanitizeDashes } from "../llm";

const EM = "\u2014";
const EN = "\u2013";
const DASHES = /[\u2013\u2014]/;

const ask = (over: Record<string, unknown> = {}) =>
  ({
    id: "ask-1",
    from: "sam@example.com",
    fromName: "Sam Rivera",
    subject: "Panel",
    kind: "event",
    title: "Founders panel",
    tag: "panel",
    inPerson: true,
    containsInstructionsToAgent: false,
    ...over,
  }) as never;

const decision = (over: Record<string, unknown> = {}) =>
  ({ verdict: "NO", reasons: [], ...over }) as never;

describe("sanitizeDashes", () => {
  it("turns a spaced dash between words into a comma", () => {
    expect(sanitizeDashes(`Thanks ${EM} I'd love to`)).toBe("Thanks, I'd love to");
    expect(sanitizeDashes(`Thanks ${EN} I'd love to`)).toBe("Thanks, I'd love to");
    expect(sanitizeDashes(`one ${EM} two ${EN} three`)).toBe("one, two, three");
  });

  it("turns an unspaced dash between numbers or times into ' to '", () => {
    expect(sanitizeDashes(`5:30${EN}8:00`)).toBe("5:30 to 8:00");
    expect(sanitizeDashes(`Oct 6${EN}8`)).toBe("Oct 6 to 8");
    expect(sanitizeDashes(`9am${EN}5pm`)).toBe("9am to 5pm");
    expect(sanitizeDashes(`$5${EM}$10`)).toBe("$5 to $10");
  });

  it("turns a spaced dash between two times into ' to '", () => {
    expect(sanitizeDashes(`3:00 PM ${EN} 4:00 PM`)).toBe("3:00 PM to 4:00 PM");
  });

  it("removes a dash at the start of a line, with its space", () => {
    expect(sanitizeDashes(`${EM} Fewer, on behalf of Sam`)).toBe("Fewer, on behalf of Sam");
    expect(sanitizeDashes(`Hello.\n\n${EN} Fewer`)).toBe("Hello.\n\nFewer");
  });

  it("falls back to ', ' for any other leftover, without doubled spaces, ', ,' or a space before a comma", () => {
    expect(sanitizeDashes(`word${EM}word`)).toBe("word, word");
    expect(sanitizeDashes(`Hi Sam, ${EM} thanks`)).toBe("Hi Sam, thanks");
    expect(sanitizeDashes(`Hi Sam ${EM}, thanks`)).toBe("Hi Sam, thanks");
    expect(sanitizeDashes(`a  ${EM}  b`)).toBe("a, b");
    expect(sanitizeDashes(`Thanks. ${EM} Sam`)).toBe("Thanks. Sam");
    expect(sanitizeDashes(`Wait ${EM}\nnext`)).toBe("Wait,\nnext");
    expect(sanitizeDashes(`a ${EM}${EM} b`)).toBe("a, b");
    const out = sanitizeDashes(`x ${EM} , y ${EN} ${EM} z`);
    expect(out).not.toMatch(/,\s*,/);
    expect(out).not.toMatch(/ ,/);
    expect(out).not.toMatch(/ {2}/);
    expect(out).not.toMatch(DASHES);
  });

  it("cleans a full sample draft with mixed dashes", () => {
    const sample = [
      "Hi Sam,",
      "",
      `Thank you for the invite ${EM} I'd love to help, but the 5:30${EN}8:00 slot on Oct 6${EN}8 is tight.`,
      `Could you send the agenda${EN}or a rough outline${EM}when you have a moment?`,
      "",
      `${EM} Fewer, on behalf of Rahul`,
    ].join("\n");
    expect(sanitizeDashes(sample)).toBe(
      [
        "Hi Sam,",
        "",
        "Thank you for the invite, I'd love to help, but the 5:30 to 8:00 slot on Oct 6 to 8 is tight.",
        "Could you send the agenda, or a rough outline, when you have a moment?",
        "",
        "Fewer, on behalf of Rahul",
      ].join("\n"),
    );
  });

  it("is a no-op on dash-free text", () => {
    const text = "Hi Sam,\n\nThanks so much.  Two spaces , and a stray comma stay.\n\nFewer, on behalf of Rahul";
    expect(sanitizeDashes(text)).toBe(text);
    expect(sanitizeDashes("")).toBe("");
  });

  it("never touches ASCII hyphens", () => {
    expect(sanitizeDashes("A follow-up on 2026-10-04 - see you")).toBe("A follow-up on 2026-10-04 - see you");
    expect(sanitizeDashes(`A follow-up ${EM} on 2026-10-04 - ok`)).toBe("A follow-up, on 2026-10-04 - ok");
  });
});

describe("draftReply dash handling", () => {
  beforeEach(() => {
    h.generate.mockReset();
  });

  it("signs off without a dash", async () => {
    h.generate.mockResolvedValue({ text: "Hi Sam,\n\nThanks for thinking of me, but I can't take this one on." });
    const { body } = await draftReply({ ask: ask(), decision: decision(), ownerName: "Rahul" });
    expect(body.endsWith("\n\nFewer, on behalf of Rahul")).toBe(true);
    expect(body).not.toMatch(DASHES);
  });

  it("strips dashes the model returns, including a model-added dash sign-off", async () => {
    h.generate.mockResolvedValue({
      text: `Hi Sam,\n\nThanks ${EM} that's kind, and 5:30${EN}8:00 won't work for me.\n\n${EM} Fewer`,
    });
    const { body } = await draftReply({ ask: ask(), decision: decision(), ownerName: "Rahul" });
    expect(body).not.toMatch(DASHES);
    expect(body).toContain("Thanks, that's kind, and 5:30 to 8:00 won't work for me.");
    expect(body.endsWith("\n\nFewer, on behalf of Rahul")).toBe(true);
    expect(body.match(/Fewer, on behalf of/g)).toHaveLength(1);
  });

  it("strips dashes from the fallback template when the model fails", async () => {
    h.generate.mockRejectedValue(new Error("model down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { body } = await draftReply({
      ask: ask({ title: `Founders ${EN} Panel ${EM} Oct 6${EN}8` }),
      decision: decision({ verdict: "YES" }),
      ownerName: "Rahul",
    });
    warn.mockRestore();
    expect(body).not.toMatch(DASHES);
    expect(body).toContain("Founders, Panel, Oct 6 to 8");
    expect(body.endsWith("Fewer, on behalf of Rahul")).toBe(true);
  });

  it("strips dashes from the blocked template without calling the model", async () => {
    const { body } = await draftReply({
      ask: ask(),
      decision: decision({ verdict: "BLOCKED" }),
      ownerName: "Rahul",
    });
    expect(h.generate).not.toHaveBeenCalled();
    expect(body).not.toMatch(DASHES);
    expect(body.endsWith("Fewer, on behalf of Rahul")).toBe(true);
  });

  it("tells the model not to use em or en dashes", async () => {
    h.generate.mockResolvedValue({ text: "Hi Sam,\n\nThanks for thinking of me, I can't take this one on." });
    await draftReply({ ask: ask(), decision: decision(), ownerName: "Rahul" });
    const prompt = String(h.generate.mock.calls[0]?.[0]);
    expect(prompt).toMatch(/never use em dashes or en dashes/i);
    expect(prompt).toMatch(/commas, colons or periods/i);
  });
});
