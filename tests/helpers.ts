import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { McpDietConfig } from "../src/config/schema.js";
import { mcpDietConfigSchema } from "../src/config/schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);
const tsx = requireFromHere.resolve("tsx/cli");
const echoStdio = path.resolve(here, "fixtures", "echo-mcp-server", "stdio.ts");

export function echoStdioConfig(serverId: string, env: Record<string, string> = {}): {
  transport: "stdio";
  command: string[];
  env: Record<string, string>;
} {
  return {
    transport: "stdio",
    command: ["node", tsx, echoStdio],
    env: { ECHO_SERVER_NAME: serverId, ...env },
  };
}

/**
 * Build a fully-populated McpDietConfig for tests. The Zod parse fills all the
 * default values so we don't need to repeat them everywhere.
 */
export function buildTestConfig(partial: {
  servers: Record<string, unknown>;
  filters?: { allow?: string[]; deny?: string[] };
  shrink?: { mode?: "off" | "rules" | "llm"; maxDescriptionChars?: number };
  inboundHttp?: boolean;
}): McpDietConfig {
  return mcpDietConfigSchema.parse({
    servers: partial.servers,
    filters: partial.filters ?? {},
    shrink: partial.shrink ?? { mode: "rules", cachePath: "" },
    inbound: { stdio: false, http: { enabled: !!partial.inboundHttp } },
    observability: { trace: { sink: "off" }, audit: { enabled: false } },
    logLevel: "silent",
  });
}
