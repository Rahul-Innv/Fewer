import { describe, expect, it } from "vitest";
import {
  APPROVAL_CODE_ALPHABET,
  canonicalJson,
  firstReplyLine,
  makeApprovalCode,
  parseApprovalReply,
  sha256Hex,
} from "../approval";

const APPROVER = "rahul@example.com";
const CODE = "7F3K";

function reply(text: string, from = APPROVER) {
  return parseApprovalReply({ text, from, approverEmail: APPROVER, expectedCode: CODE });
}

describe("canonicalJson", () => {
  it("sorts keys recursively and has no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
  });

  it("is independent of key insertion order", () => {
    const x = { verdict: "YES", draft: { to: "a@b.c", body: "hi" }, n: 1 };
    const y = { n: 1, draft: { body: "hi", to: "a@b.c" }, verdict: "YES" };
    expect(canonicalJson(x)).toBe(canonicalJson(y));
    expect(sha256Hex(canonicalJson(x))).toBe(sha256Hex(canonicalJson(y)));
  });

  it("keeps array order, drops undefined object values, nulls non-finite numbers", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson([undefined, Number.NaN])).toBe("[null,null]");
    expect(canonicalJson("x\"y")).toBe('"x\\"y"');
  });
});

describe("sha256Hex", () => {
  it("matches the known vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("makeApprovalCode", () => {
  it("is 4 chars from the unambiguous alphabet", () => {
    expect(APPROVAL_CODE_ALPHABET).toHaveLength(31);
    expect(APPROVAL_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    for (let i = 0; i < 200; i++) {
      const bytes = Uint8Array.from([i, (i * 37) % 256, (i * 101) % 256, 255 - i]);
      const code = makeApprovalCode(bytes);
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    }
  });

  it("is deterministic from the bytes", () => {
    const bytes = Uint8Array.from([9, 8, 7, 6, 5]);
    expect(makeApprovalCode(bytes)).toBe(makeApprovalCode(Uint8Array.from([9, 8, 7, 6, 5])));
    expect(makeApprovalCode(Uint8Array.from([0, 0, 0, 0]))).toBe("2222");
    expect(makeApprovalCode(Uint8Array.from([0, 0, 0, 1]))).toBe("2223");
    expect(makeApprovalCode(Uint8Array.from([1, 2, 3, 4]))).not.toBe(makeApprovalCode(Uint8Array.from([4, 3, 2, 1])));
  });

  it("rejects fewer than 4 bytes", () => {
    expect(() => makeApprovalCode(Uint8Array.from([1, 2, 3]))).toThrow();
  });
});

describe("parseApprovalReply", () => {
  it("approves YES <code> from the approver", () => {
    expect(reply("YES 7F3K")).toEqual({ decision: "approve", reason: "approval code matched" });
  });

  it("accepts a lowercase code and a lowercase yes", () => {
    expect(reply("yes 7f3k").decision).toBe("approve");
  });

  it("accepts one trailing . or ! and extra spaces", () => {
    expect(reply("YES 7F3K.").decision).toBe("approve");
    expect(reply("YES   7F3K !").decision).toBe("approve");
    expect(reply("  YES 7F3K  ").decision).toBe("approve");
  });

  it("rejects extra punctuation or trailing words", () => {
    expect(reply("YES 7F3K!!").decision).toBe("none");
    expect(reply("YES 7F3K please send").decision).toBe("none");
    expect(reply("YES").decision).toBe("none");
    expect(reply("YES, 7F3K").decision).toBe("none");
  });

  it("wrong code is 'code mismatch'", () => {
    expect(reply("YES ABCD")).toEqual({ decision: "none", reason: "code mismatch" });
  });

  it("wrong sender is 'not the approver', even with the right code", () => {
    expect(reply("YES 7F3K", "attacker@evil.example")).toEqual({ decision: "none", reason: "not the approver" });
    expect(reply("NO", "attacker@evil.example").decision).toBe("none");
  });

  it("strips the display name and compares case-insensitively", () => {
    expect(reply("YES 7F3K", "Rahul K <Rahul@Example.COM>").decision).toBe("approve");
  });

  it("'no thanks' that quotes 'Reply YES 7F3K' below must not approve", () => {
    const text = [
      "no thanks",
      "",
      "On Sun, Oct 4, 2026 at 1:02 PM Fewer <fewer@agentmail.to> wrote:",
      "> Draft ready. Reply YES 7F3K to send it.",
      "> YES 7F3K",
    ].join("\n");
    expect(reply(text)).toEqual({ decision: "decline", reason: "declined by approver" });
  });

  it("ignores quoted lines that precede the reply", () => {
    expect(reply("> YES 7F3K\nNO").decision).toBe("decline");
    expect(reply("> YES 7F3K\n>\n").decision).toBe("none");
  });

  it("stops at an 'On ... wrote:' header before any reply text", () => {
    const text = "\nOn Sun, Oct 4, 2026 at 1:02 PM Fewer <fewer@agentmail.to> wrote:\nYES 7F3K";
    expect(reply(text)).toEqual({ decision: "none", reason: "empty reply" });
  });

  it("only the first non-empty line counts", () => {
    expect(reply("\r\n\r\nYES 7F3K\r\nSent from my phone").decision).toBe("approve");
    expect(reply("Looks good\nYES 7F3K").decision).toBe("none");
  });

  it("declines on NO / No. / no thanks but not on 'nope'", () => {
    expect(reply("NO").decision).toBe("decline");
    expect(reply("No.").decision).toBe("decline");
    expect(reply("no thanks").decision).toBe("decline");
    expect(reply("nope").decision).toBe("none");
  });

  it("firstReplyLine skips blanks and quotes", () => {
    expect(firstReplyLine("\n  \n> quoted\nhello\nworld")).toBe("hello");
    expect(firstReplyLine("")).toBeNull();
  });
});
