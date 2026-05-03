import { describe, expect, it } from "vitest";
import { tooltrimConfigSchema } from "../../src/config/schema.js";
import { validateConfig } from "../../src/config/load.js";

describe("config schema", () => {
  it("accepts a minimal stdio-only config", () => {
    const cfg = tooltrimConfigSchema.parse({
      servers: {
        x: { transport: "stdio", command: ["node", "x.js"] },
      },
    });
    expect(cfg.servers.x.transport).toBe("stdio");
    expect(cfg.namespaceSeparator).toBe(".");
    expect(cfg.shrink.mode).toBe("rules");
    expect(cfg.inbound.stdio).toBe(true);
  });

  it("rejects invalid server ids", () => {
    expect(() =>
      tooltrimConfigSchema.parse({
        servers: { "weird id!": { transport: "stdio", command: ["x"] } },
      }),
    ).toThrow();
  });

  it("requires command to be a non-empty array for stdio", () => {
    expect(() =>
      validateConfig({
        servers: { x: { transport: "stdio", command: [] } },
      }),
    ).toThrow();
  });

  it("accepts http transport with passthrough auth", () => {
    const cfg = tooltrimConfigSchema.parse({
      servers: {
        api: { transport: "http", url: "https://example.com/mcp", auth: "passthrough" },
      },
    });
    expect(cfg.servers.api.transport).toBe("http");
    expect(cfg.servers.api.transport === "http" && cfg.servers.api.auth).toBe("passthrough");
  });

  it("validates URL format for http", () => {
    expect(() =>
      tooltrimConfigSchema.parse({
        servers: { api: { transport: "http", url: "not-a-url" } },
      }),
    ).toThrow();
  });

  it("normalizes empty optional sections via defaults", () => {
    const cfg = tooltrimConfigSchema.parse({
      servers: { x: { transport: "stdio", command: ["a"] } },
    });
    expect(cfg.filters.allow).toEqual([]);
    expect(cfg.filters.deny).toEqual([]);
    expect(cfg.observability.audit.enabled).toBe(false);
    expect(cfg.observability.metrics.prometheus.enabled).toBe(false);
  });
});
