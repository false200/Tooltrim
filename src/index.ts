// Public programmatic API surface for LeanMCP (`leanmcp` on npm).
// Most users will run the CLI via `npx leanmcp`, but consumers can also
// embed the proxy in another Node process.

export { loadConfig, validateConfig } from "./config/load.js";
export { leanMcpConfigSchema } from "./config/schema.js";
export type { LeanMcpConfig, ServerConfig } from "./config/schema.js";
export { UpstreamManager } from "./upstream/manager.js";
export { Aggregator } from "./core/aggregator.js";
export { ToolFilter } from "./core/filter.js";
export { Shrinker } from "./core/shrinker.js";
export { countTokens } from "./core/tokenizer.js";
export { runProxy } from "./proxy.js";
