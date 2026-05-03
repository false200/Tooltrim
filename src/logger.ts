import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export interface LoggerConfig {
  level?: LogLevel;
  /** When true, every log line goes to stderr instead of stdout. Required when stdio is the inbound MCP transport. */
  toStderr?: boolean;
}

let rootLogger: Logger | undefined;

export function configureLogger(cfg: LoggerConfig = {}): Logger {
  const options: LoggerOptions = {
    level: cfg.level ?? (process.env.MCP_DIET_LOG_LEVEL as LogLevel) ?? "info",
    base: { name: "tooltrim" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  const stream: DestinationStream | undefined = cfg.toStderr
    ? pino.destination({ dest: 2, sync: false })
    : undefined;
  rootLogger = stream ? pino(options, stream) : pino(options);
  return rootLogger;
}

export function getLogger(): Logger {
  if (!rootLogger) rootLogger = configureLogger();
  return rootLogger;
}

export function child(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}
