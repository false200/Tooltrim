import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const requireFromHere = createRequire(import.meta.url);
const tsxCli = requireFromHere.resolve("tsx/cli");
const cliEntry = path.resolve(root, "src", "cli.ts");
const echoStdio = path.resolve(root, "tests", "fixtures", "echo-mcp-server", "stdio.ts");

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch {
      // ignore
    }
  }
});

describe("inbound stdio (end-to-end)", () => {
  it(
    "an MCP client over stdio sees the proxy's namespaced tool list",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "tooltrim-stdio-"));
      cleanups.push(() => rm(dir, { recursive: true, force: true }));
      const cfgPath = path.join(dir, "tooltrim.config.json");
      await writeFile(
        cfgPath,
        JSON.stringify({
          servers: {
            a: {
              transport: "stdio",
              command: ["node", tsxCli, echoStdio],
              env: { ECHO_SERVER_NAME: "a" },
            },
          },
          shrink: { mode: "off", cachePath: path.join(dir, "cache.json") },
          observability: { trace: { sink: "off" } },
          inbound: { stdio: true, http: { enabled: false } },
          logLevel: "silent",
        }),
        "utf8",
      );

      const transport = new StdioClientTransport({
        command: "node",
        args: [tsxCli, cliEntry, "start", "--config", cfgPath],
        cwd: root,
        stderr: "ignore",
      });
      const client = new Client(
        { name: "stdio-test-client", version: "0.0.1" },
        { capabilities: {} },
      );
      cleanups.push(async () => {
        await client.close().catch(() => undefined);
      });
      await client.connect(transport);

      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      expect(names).toContain("a.echo");
      expect(names).toContain("a.add");

      const echo = await client.callTool({ name: "a.echo", arguments: { text: "ping" } });
      const text = (echo.content as Array<{ text?: string }>)[0]?.text;
      expect(text).toBe("ping");
    },
    45_000,
  );
});
