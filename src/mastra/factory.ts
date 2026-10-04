import { Mastra } from "@mastra/core/mastra";
import { drafterAgent, fewerAgent, fewerStore, parserAgent } from "../server/llm";

/**
 * The one Mastra instance for Fewer: the three agents from src/server/llm.ts, Postgres storage (only when
 * DATABASE_URL is set) and observability (traces). Registering the SAME agent instances is what makes
 * their generate()/stream() calls traced, wherever they run (Studio, worker, Next API routes).
 *
 * No top-level await here on purpose: scripts run through tsx (CommonJS) and Next import this lazily from
 * llm.ts. src/mastra/index.ts (the Studio entry, ESM) awaits getMastra().
 *
 * Observability exporters (never an empty list, that throws "requires at least one exporter"):
 *  - MastraStorageExporter: local traces in Mastra storage -> visible in Studio. Needs DATABASE_URL.
 *  - MastraPlatformExporter: hosted Mastra Platform traces. Only when MASTRA_PLATFORM_ACCESS_TOKEN is set
 *    (it also reads MASTRA_PROJECT_ID).
 * The @mastra/observability package is loaded at runtime through a non-literal specifier so the bundlers
 * (Next, `mastra dev`) never need to resolve it at build time; if it is not installed, Fewer logs one
 * warning and runs untraced instead of failing.
 */

const OBSERVABILITY_PACKAGE = "@mastra/observability";

/** Minimal shape of the parts of @mastra/observability used here (it is loaded dynamically). */
type ObservabilityModule = {
  Observability: new (config: unknown) => unknown;
  MastraStorageExporter: new () => unknown;
  MastraPlatformExporter: new () => unknown;
};

async function loadObservability(hasStorage: boolean): Promise<unknown | undefined> {
  const hasPlatformToken = Boolean(process.env.MASTRA_PLATFORM_ACCESS_TOKEN?.trim());
  if (!hasStorage && !hasPlatformToken) {
    console.warn(
      "[mastra] tracing off: set DATABASE_URL (local Studio traces) and/or MASTRA_PLATFORM_ACCESS_TOKEN (Mastra Platform).",
    );
    return undefined;
  }

  let mod: ObservabilityModule;
  try {
    mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ OBSERVABILITY_PACKAGE)) as ObservabilityModule;
  } catch (err) {
    console.warn(
      `[mastra] tracing off: cannot load ${OBSERVABILITY_PACKAGE} (run: npm i ${OBSERVABILITY_PACKAGE}). ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }

  const exporters: unknown[] = [];
  if (hasStorage) exporters.push(new mod.MastraStorageExporter());
  if (hasPlatformToken) {
    try {
      exporters.push(new mod.MastraPlatformExporter());
    } catch (err) {
      console.warn(
        `[mastra] Mastra Platform exporter skipped (needs MASTRA_PLATFORM_ACCESS_TOKEN and MASTRA_PROJECT_ID): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  if (exporters.length === 0) return undefined;

  return new mod.Observability({
    configs: { default: { serviceName: "fewer", exporters } },
  });
}

async function build(): Promise<Mastra> {
  const hasStorage = Boolean(process.env.DATABASE_URL?.trim());
  const observability = await loadObservability(hasStorage);
  return new Mastra({
    agents: { fewerParser: parserAgent, fewerDrafter: drafterAgent, fewer: fewerAgent },
    ...(hasStorage ? { storage: fewerStore() } : {}),
    ...(observability ? { observability: observability as never } : {}),
  });
}

let _mastra: Promise<Mastra> | null = null;
/** Memoized: every caller (Studio entry, llm.ts) gets the same instance, so agents register once. */
export function getMastra(): Promise<Mastra> {
  if (!_mastra) {
    _mastra = build();
    _mastra.catch(() => {
      _mastra = null; // let a later call retry instead of caching a failure
    });
  }
  return _mastra;
}
