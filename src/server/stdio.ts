import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { child as childLogger } from "../logger.js";

/**
 * Wire the proxy's `Server` instance to stdio. The MCP client (Cursor, Claude
 * Desktop, etc.) launches `npx leanmcp` and JSON-RPC frames flow over
 * stdin/stdout.
 *
 * Important: when we run as stdio inbound, all logs MUST go to stderr —
 * `configureLogger({ toStderr: true })` should already have been called.
 */
export async function startStdioServer(server: Server): Promise<{ close: () => Promise<void> }> {
  const log = childLogger({ component: "inbound-stdio" });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("inbound stdio transport connected");
  return {
    close: async () => {
      try {
        await server.close();
      } catch (err) {
        log.warn({ err: (err as Error).message }, "stdio close error");
      }
    },
  };
}
