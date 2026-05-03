import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { LeanMcpConfig } from "../config/schema.js";

export interface AuditEvent {
  ts?: string;
  upstream: string;
  tool: string;
  ok: boolean;
  durMs?: number;
  /** Identity claims extracted from the inbound auth token (sub, iss, aud, scope). */
  identity?: Record<string, unknown>;
  argHash?: string;
  err?: string;
}

/**
 * Append-only audit logger. Used to record every `tools/call` so an external
 * compliance pipeline can reconstruct who invoked what.
 *
 * NDJSON-on-disk only in v0.1; OTLP/Loki sinks would slot in here later.
 */
export class AuditLogger {
  private readonly enabled: boolean;
  private readonly filePath: string;
  private dirEnsured = false;

  constructor(enabled: boolean, filePath: string) {
    this.enabled = enabled;
    this.filePath = filePath;
  }

  static fromConfig(cfg: LeanMcpConfig): AuditLogger {
    return new AuditLogger(cfg.observability.audit.enabled, cfg.observability.audit.path);
  }

  async record(ev: AuditEvent): Promise<void> {
    if (!this.enabled) return;
    if (!this.dirEnsured) {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      this.dirEnsured = true;
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...ev });
    await appendFile(this.filePath, line + "\n", "utf8");
  }
}
