// Public programmatic API surface for `mcp-diet`.
// Most users will run the CLI via `npx mcp-diet`, but consumers can also
// embed the proxy in another Node process.

export { loadConfig, validateConfig } from "./config/load.js";
export { mcpDietConfigSchema } from "./config/schema.js";
export type { McpDietConfig, ServerConfig } from "./config/schema.js";
export { UpstreamManager } from "./upstream/manager.js";
export { Aggregator } from "./core/aggregator.js";
export { ToolFilter } from "./core/filter.js";
export { Shrinker } from "./core/shrinker.js";
export { countTokens } from "./core/tokenizer.js";
export { runProxy } from "./proxy.js";
