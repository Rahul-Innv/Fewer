import { createHash } from "node:crypto";
import { normalizeEmail } from "./contracts";

/** Unambiguous alphabet: no 0/O/1/I/L. 31 symbols. */
export const APPROVAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const APPROVAL_CODE_LENGTH = 4;

/** Deterministic JSON: object keys sorted recursively, no whitespace. Undefined object values are dropped. */
export function canonicalJson(value: unknown): string {
  const out = canon(value);
  return out === undefined ? "null" : out;
}

function canon(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value !== "object") return JSON.stringify(value); // string, boolean; undefined/function/symbol -> undefined
  const maybeJson = value as { toJSON?: () => unknown };
  if (typeof maybeJson.toJSON === "function") return canon(maybeJson.toJSON());
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canon(item) ?? "null").join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const encoded = canon(record[key]);
    if (encoded === undefined) continue;
    parts.push(JSON.stringify(key) + ":" + encoded);
  }
  return "{" + parts.join(",") + "}";
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * 4-char code from APPROVAL_CODE_ALPHABET, deterministic from the first 4 bytes.
 * Bytes are read as a big-endian uint32 and written in base 31 (negligible bias).
 * Callers pass crypto-random bytes, e.g. randomBytes(4).
 */
export function makeApprovalCode(bytes: Uint8Array): string {
  if (bytes.length < 4) throw new Error("makeApprovalCode needs at least 4 bytes");
  let n = ((bytes[0]! << 24) >>> 0) + (bytes[1]! << 16) + (bytes[2]! << 8) + bytes[3]!;
  const base = APPROVAL_CODE_ALPHABET.length;
  let code = "";
  for (let i = 0; i < APPROVAL_CODE_LENGTH; i++) {
    code = APPROVAL_CODE_ALPHABET[n % base] + code;
    n = Math.floor(n / base);
  }
  return code;
}

export interface ApprovalReplyInput {
  /** Reply-only content (quoted history should already be stripped; we are defensive anyway). */
  text: string;
  /** From header of the reply; display-name form is fine. */
  from: string;
  approverEmail: string;
  expectedCode: string;
}

export interface ApprovalReplyResult {
  decision: "approve" | "decline" | "none";
  reason: string;
}

const APPROVE_RE = /^YES\s+([A-Z0-9]{4})\s*[.!]?$/i;
const DECLINE_RE = /^NO\b/i;
const QUOTE_HEADER_RE = /^On .+ wrote:$/;

/** First meaningful line: skips blanks and ">" quotes, stops at an "On ... wrote:" header. */
export function firstReplyLine(text: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (QUOTE_HEADER_RE.test(line)) return null;
    if (line === "" || line.startsWith(">")) continue;
    return line;
  }
  return null;
}

export function parseApprovalReply(input: ApprovalReplyInput): ApprovalReplyResult {
  if (normalizeEmail(input.from) !== normalizeEmail(input.approverEmail)) {
    return { decision: "none", reason: "not the approver" };
  }
  const line = firstReplyLine(input.text);
  if (line === null) return { decision: "none", reason: "empty reply" };

  const approve = APPROVE_RE.exec(line);
  if (approve) {
    const given = approve[1]!.toUpperCase();
    const expected = input.expectedCode.trim().toUpperCase();
    if (expected.length > 0 && given === expected) {
      return { decision: "approve", reason: "approval code matched" };
    }
    return { decision: "none", reason: "code mismatch" };
  }
  if (DECLINE_RE.test(line)) return { decision: "decline", reason: "declined by approver" };
  return { decision: "none", reason: "first line is not YES <code> or NO" };
}
