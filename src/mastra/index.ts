import { getMastra } from "./factory";

/**
 * Entry for Mastra Studio (`npm run studio` -> `mastra dev --dir src/mastra`), which loads the `mastra`
 * export from this file. Top-level await is fine here: `mastra dev` bundles to ESM. App code (worker,
 * Next routes) does not import this file; llm.ts reaches the same instance through ./factory.
 */
export const mastra = await getMastra();
