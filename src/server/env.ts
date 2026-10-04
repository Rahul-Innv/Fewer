import { z } from "zod";

/**
 * Environment access for Fewer's server code.
 *
 * - getEnv(): full validation (throws listing ALL missing names).
 * - requireEnv(...names): validate only the names a module needs (mail.ts needs
 *   AGENTMAIL_API_KEY, not DATABASE_URL), same error style.
 * - modelFast()/modelDraft(): model-router strings for Mastra Agents.
 *
 * Next.js loads .env.local itself; scripts load it via dotenv before importing this.
 */

const nonEmpty = z.string().trim().min(1);
const optionalNonEmpty = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const EnvSchema = z.object({
  DATABASE_URL: nonEmpty,
  AGENTMAIL_API_KEY: nonEmpty,
  EXA_API_KEY: nonEmpty,
  FEWER_INBOX: nonEmpty,
  FEWER_APPROVER: nonEmpty,
  FEWER_HOST_DEMO: optionalNonEmpty,
  FEWER_OWNER_NAME: optionalNonEmpty.transform((v) => v ?? "Rahul"),
  FEWER_TZ: optionalNonEmpty.transform((v) => v ?? "America/Los_Angeles"),
  NEON_AI_GATEWAY_BASE_URL: optionalNonEmpty,
  NEON_AI_GATEWAY_TOKEN: optionalNonEmpty,
  ANTHROPIC_API_KEY: optionalNonEmpty,
  FEWER_MODEL_FAST: optionalNonEmpty,
  FEWER_MODEL_DRAFT: optionalNonEmpty,
  FEWER_ALLOW_SEND: optionalNonEmpty.transform((v) => (v ?? "").toLowerCase() !== "false"),
});

export type Env = z.infer<typeof EnvSchema>;

function hasGateway(e: NodeJS.ProcessEnv): boolean {
  return Boolean(e.NEON_AI_GATEWAY_TOKEN?.trim() && e.NEON_AI_GATEWAY_BASE_URL?.trim());
}

/** Zod-validated env. Throws one Error listing ALL missing/invalid names. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  const missing = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0] ?? "(unknown)");
      missing.add(name);
    }
  }
  if (!hasGateway(source) && !source.ANTHROPIC_API_KEY?.trim()) {
    missing.add("NEON_AI_GATEWAY_BASE_URL + NEON_AI_GATEWAY_TOKEN (or ANTHROPIC_API_KEY)");
  }
  if (missing.size > 0 || !parsed.success) {
    throw new Error(
      `Missing or invalid environment variables: ${[...missing].join(", ")}. See .env.example.`,
    );
  }
  return parsed.data;
}

/** Validate only the named variables; returns their values. Throws listing every missing one. */
export function requireEnv<K extends string>(...names: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  const missing: string[] = [];
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) out[n] = v;
    else missing.push(n);
  }
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}. See .env.example.`);
  }
  return out;
}

/** True unless FEWER_ALLOW_SEND is exactly "false" (case-insensitive). */
export function allowSend(): boolean {
  return (process.env.FEWER_ALLOW_SEND ?? "").trim().toLowerCase() !== "false";
}

function pickModel(override: string | undefined, haiku: boolean): string {
  const e = process.env;
  if (override?.trim()) return override.trim();
  const id = haiku ? "claude-haiku-4-5" : "claude-sonnet-4-6";
  if (hasGateway(e)) return `neon/${id}`;
  if (e.ANTHROPIC_API_KEY?.trim()) return `anthropic/${id}`;
  // Nothing configured: return the gateway default so the failure message names the missing gateway vars.
  return `neon/${id}`;
}

/** Cheap/fast model (parsing). FEWER_MODEL_FAST, else neon/claude-haiku-4-5, else anthropic/claude-haiku-4-5. */
export function modelFast(): string {
  return pickModel(process.env.FEWER_MODEL_FAST, true);
}

/** Drafting/chat model. FEWER_MODEL_DRAFT, else neon/claude-sonnet-4-6, else anthropic/claude-sonnet-4-6. */
export function modelDraft(): string {
  return pickModel(process.env.FEWER_MODEL_DRAFT, false);
}

/**
 * Fail fast (with names, not a 6s retry storm) when the chosen model's provider has no credentials.
 * "neon/<id>" needs NEON_AI_GATEWAY_BASE_URL + NEON_AI_GATEWAY_TOKEN; "anthropic/<id>" needs ANTHROPIC_API_KEY.
 */
export function assertModelCredentials(model: string): void {
  const e = process.env;
  if (model.startsWith("neon/")) {
    const missing = ["NEON_AI_GATEWAY_BASE_URL", "NEON_AI_GATEWAY_TOKEN"].filter((n) => !e[n]?.trim());
    if (missing.length) throw new Error(`Model "${model}" needs ${missing.join(" and ")} (or set ANTHROPIC_API_KEY / FEWER_MODEL_*).`);
  } else if (model.startsWith("anthropic/")) {
    if (!e.ANTHROPIC_API_KEY?.trim()) throw new Error(`Model "${model}" needs ANTHROPIC_API_KEY.`);
  }
}
