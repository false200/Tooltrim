import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";

export type UpstreamStatus = "starting" | "connected" | "reconnecting" | "errored" | "closed";

/**
 * Snapshot of an MCP primitive originating from one upstream server.
 * `original` is what the upstream returned; `namespaced` is the global
 * `<serverId>.<name>` we expose to the proxy's MCP client.
 */
export interface NamespacedTool {
  upstreamId: string;
  original: string;
  namespaced: string;
  raw: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    title?: string;
    _meta?: Record<string, unknown>;
  };
}

export interface NamespacedResource {
  upstreamId: string;
  uri: string;
  raw: Record<string, unknown>;
}

export interface NamespacedResourceTemplate {
  upstreamId: string;
  uriTemplate: string;
  raw: Record<string, unknown>;
}

export interface NamespacedPrompt {
  upstreamId: string;
  original: string;
  namespaced: string;
  raw: Record<string, unknown>;
}

export interface UpstreamConnection {
  id: string;
  client: Client;
  status: UpstreamStatus;
  capabilities?: ServerCapabilities;
  serverInfo?: { name: string; version: string };
  lastError?: Error;
  /**
   * Per-call HTTP headers to merge into outbound HTTP requests, used for
   * inbound `Authorization` pass-through. stdio upstreams ignore this.
   */
  setRequestHeaders?: (headers: Record<string, string>) => void;
}
