import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Logger } from "pino";
import type {
  HttpServerConfig,
  LeanMcpConfig,
  ServerConfig,
  StdioServerConfig,
} from "../config/schema.js";
import { child as childLogger } from "../logger.js";
import type { UpstreamConnection, UpstreamStatus } from "./types.js";

const PROXY_CLIENT_INFO = { name: "leanmcp", version: "0.1.0" };

interface AuthHeaders {
  /** Inbound Authorization header from the current MCP client request. */
  authorization?: string;
}

/**
 * Owns the lifecycle of every upstream MCP server: spawns/connects, performs
 * the MCP `initialize` handshake, exposes `Client` instances, and reconnects
 * on unexpected exit.
 */
export type StatusListener = (id: string, status: UpstreamStatus) => void;

export class UpstreamManager {
  private readonly cfg: LeanMcpConfig;
  private readonly log: Logger;
  private readonly conns = new Map<string, UpstreamConnection>();
  private readonly restartCounts = new Map<string, number>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly httpHeaders = new Map<string, Record<string, string>>();
  private readonly statusListeners = new Set<StatusListener>();
  private closing = false;
  /** Per-async-context auth headers (Authorization: ...) to forward upstream. */
  private currentAuth: AuthHeaders = {};

  constructor(cfg: LeanMcpConfig) {
    this.cfg = cfg;
    this.log = childLogger({ component: "upstream" });
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(id: string, status: UpstreamStatus): void {
    for (const l of this.statusListeners) {
      try {
        l(id, status);
      } catch (err) {
        this.log.warn({ err: errMsg(err) }, "status listener failed");
      }
    }
  }

  get connections(): ReadonlyMap<string, UpstreamConnection> {
    return this.conns;
  }

  /**
   * Set the inbound `Authorization` header for the duration of a single
   * inbound request. Upstream HTTP transports will pick it up via the
   * dynamic-header hook installed at connect time.
   */
  setInboundAuth(auth: AuthHeaders): void {
    this.currentAuth = auth;
  }

  clearInboundAuth(): void {
    this.currentAuth = {};
  }

  async connectAll(): Promise<void> {
    const ids = Object.keys(this.cfg.servers);
    await Promise.all(ids.map((id) => this.connectOne(id)));
  }

  async closeAll(): Promise<void> {
    this.closing = true;
    for (const t of this.restartTimers.values()) clearTimeout(t);
    this.restartTimers.clear();
    await Promise.all(
      [...this.conns.values()].map(async (conn) => {
        try {
          await conn.client.close();
        } catch (err) {
          this.log.warn({ id: conn.id, err: errMsg(err) }, "error closing upstream");
        }
        conn.status = "closed";
      }),
    );
  }

  async connectOne(id: string): Promise<UpstreamConnection> {
    const cfg = this.cfg.servers[id];
    if (!cfg) throw new Error(`unknown upstream server "${id}"`);
    if (this.conns.has(id) && this.conns.get(id)!.status === "connected") {
      return this.conns.get(id)!;
    }
    this.log.info({ id, transport: cfg.transport }, "connecting upstream");

    const client = new Client(PROXY_CLIENT_INFO, { capabilities: {} });

    try {
      if (cfg.transport === "stdio") {
        await this.connectStdio(id, cfg, client);
      } else {
        await this.connectHttp(id, cfg, client);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.log.error({ id, err: error.message }, "upstream initial connect failed");
      const conn: UpstreamConnection = {
        id,
        client,
        status: "errored",
        lastError: error,
      };
      this.conns.set(id, conn);
      this.emitStatus(id, "errored");
      this.scheduleReconnect(id);
      return conn;
    }

    const conn: UpstreamConnection = {
      id,
      client,
      status: "connected",
      capabilities: client.getServerCapabilities(),
      serverInfo: client.getServerVersion(),
    };
    if (cfg.transport === "http") {
      conn.setRequestHeaders = (headers) => this.setHttpHeaders(id, headers);
    }
    this.conns.set(id, conn);
    this.restartCounts.set(id, 0);
    this.attachLifecycleHandlers(conn);
    this.emitStatus(id, "connected");
    this.log.info(
      { id, server: conn.serverInfo, capabilities: conn.capabilities },
      "upstream ready",
    );
    return conn;
  }

  private async connectStdio(
    id: string,
    cfg: StdioServerConfig,
    client: Client,
  ): Promise<void> {
    const [command, ...args] = cfg.command;
    if (!command) throw new Error(`upstream "${id}" stdio command is empty`);
    const transport = new StdioClientTransport({
      command,
      args,
      env: cfg.env ? { ...process.env as Record<string, string>, ...cfg.env } : undefined,
      cwd: cfg.cwd,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => {
      this.log.debug({ id, chunk: chunk.toString("utf8").trim() }, "upstream stderr");
    });
    await client.connect(transport);
  }

  private async connectHttp(
    id: string,
    cfg: HttpServerConfig,
    client: Client,
  ): Promise<void> {
    const baseHeaders: Record<string, string> = { ...(cfg.headers ?? {}) };
    if (cfg.auth && typeof cfg.auth === "object" && cfg.auth.type === "header") {
      baseHeaders[cfg.auth.name] = cfg.auth.value;
    }
    this.httpHeaders.set(id, baseHeaders);

    const dynamicFetch: typeof fetch = (input, init) => {
      const merged: Record<string, string> = { ...this.httpHeaders.get(id) };
      // Pass-through Authorization header when configured.
      if (cfg.auth === "passthrough" && this.currentAuth.authorization) {
        merged["Authorization"] = this.currentAuth.authorization;
      }
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(merged)) {
        if (!headers.has(k)) headers.set(k, v);
      }
      return fetch(input, { ...init, headers });
    };

    const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      fetch: dynamicFetch,
    });
    await client.connect(transport);
  }

  private setHttpHeaders(id: string, headers: Record<string, string>): void {
    const existing = this.httpHeaders.get(id) ?? {};
    this.httpHeaders.set(id, { ...existing, ...headers });
  }

  private attachLifecycleHandlers(conn: UpstreamConnection): void {
    conn.client.onclose = () => {
      if (this.closing) return;
      this.log.warn({ id: conn.id }, "upstream connection closed");
      conn.status = "errored";
      this.emitStatus(conn.id, "errored");
      this.scheduleReconnect(conn.id);
    };
    conn.client.onerror = (err) => {
      this.log.warn({ id: conn.id, err: err.message }, "upstream error");
      conn.status = "errored";
      conn.lastError = err;
      this.emitStatus(conn.id, "errored");
    };
  }

  private scheduleReconnect(id: string): void {
    if (this.closing) return;
    const cfg = this.cfg.servers[id];
    if (!cfg) return;
    const attempt = (this.restartCounts.get(id) ?? 0) + 1;
    const max = cfg.transport === "stdio" ? cfg.maxRestarts : 5;
    if (attempt > max) {
      this.log.error({ id, attempt }, "giving up reconnect");
      return;
    }
    const baseBackoff = cfg.transport === "stdio" ? cfg.restartBackoffMs : 500;
    const delay = Math.min(baseBackoff * Math.pow(2, attempt - 1), 30_000);
    this.restartCounts.set(id, attempt);
    this.log.info({ id, attempt, delayMs: delay }, "scheduling upstream reconnect");
    const timer = setTimeout(() => {
      this.restartTimers.delete(id);
      this.connectOne(id).catch((err) => {
        this.log.warn({ id, err: errMsg(err) }, "reconnect attempt failed");
      });
    }, delay);
    this.restartTimers.set(id, timer);
  }

  /**
   * Mark a connection as having a particular status (used by tests).
   */
  setStatus(id: string, status: UpstreamStatus): void {
    const conn = this.conns.get(id);
    if (conn) conn.status = status;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
