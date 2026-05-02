# mcp-diet

> An open-source [Model Context Protocol](https://modelcontextprotocol.io) proxy that puts your tool list on a diet.
> Aggregate N MCP servers, filter and shrink the noise, and trace every call.

[![npm](https://img.shields.io/npm/v/mcp-diet.svg)](https://www.npmjs.com/package/mcp-diet)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why

Connect three or four MCP servers in a single session and the **tool metadata alone routinely eats 40-50% of the context window** before the user has even typed a question.
The MCP team's [2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) explicitly calls out gateways, proxies, and observability as priority work.

`mcp-diet` is a small, drop-in proxy that sits in front of N upstream MCP servers and:

- **filters** their tool / resource / prompt lists down to the ones your project actually uses,
- **shrinks** verbose tool descriptions and dedupes JSON-Schema sub-trees, deterministically,
- **traces** every JSON-RPC frame as NDJSON so you can finally see what your agent is doing,
- and **measures** how much context you saved.

It speaks both `stdio` and `Streamable HTTP` in both directions, runs stateless behind a load balancer, and exports Prometheus + OpenTelemetry.

---

## The hero

Measured against five real, official `@modelcontextprotocol/*` servers (`server-everything` + `server-filesystem` + `server-memory` + `server-sequential-thinking` + `server-github`):

```text
Scenario                Tools  Bytes   Tokens  vs raw (tokens)
all (raw)                  63  49,505  10,401         −0.0%
all (shrunk)               63  45,276   9,590         −7.8%
common (filter+shrink)     17  14,488   3,084        −70.3%
task   (filter+shrink)      3   3,165     656        −93.7%

Proxy round-trip overhead  +3.1 ms p50 / +4.6 ms p95  (tools/call, loopback)
Throughput                 50 concurrent calls,  0 errors,  ~365 ops/sec
```

Full reproducible report: [`bench/REPORT.md`](bench/REPORT.md). Run it yourself with `pnpm bench`.

---

## Quickstart

```bash
# 1. install (no global, no daemon, just npx)
pnpm dlx mcp-diet --version    # or: npx mcp-diet --version

# 2. drop a config in your repo root
cp node_modules/mcp-diet/examples/mcp-diet.config.yaml .

# 3. point your MCP client at mcp-diet instead of the individual servers
```

Cursor / Claude Desktop / Codex stdio config:

```json
{
  "mcpServers": {
    "diet": {
      "command": "npx",
      "args": ["-y", "mcp-diet"]
    }
  }
}
```

That's it. `mcp-diet` will read `mcp-diet.config.yaml` from the cwd, fan out to every upstream listed there, and present a single merged, filtered, shrunk tool list to your client.

---

## Configuration

A complete example lives in [`examples/mcp-diet.config.yaml`](examples/mcp-diet.config.yaml).

```yaml
servers:
  github:
    transport: stdio
    command: ["npx", "-y", "@modelcontextprotocol/server-github"]
    env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }
  linear:
    transport: http
    url: https://mcp.linear.app/sse
    auth: passthrough             # forward inbound Authorization upstream
  pg:
    transport: stdio
    command: ["uvx", "mcp-server-postgres", "--url", "${PG_URL}"]

filters:
  allow: ["github.*", "linear.create_*", "pg.query"]
  deny:  ["github.delete_*", "*.admin_*"]

shrink:
  mode: rules                    # rules | off | llm (v0.2)
  maxDescriptionChars: 160
  dedupeSchemas: true
  cachePath: .mcp-diet/shrink-cache.json

inbound:
  stdio: true
  http:
    enabled: true
    host: 127.0.0.1
    port: 8787
    path: /mcp
    sessions: stateless          # stateless | redis://... (v0.2)

observability:
  trace:   { sink: file, path: .mcp-diet/trace.ndjson }
  metrics: { prometheus: { enabled: true, port: 9464 } }
  audit:   { enabled: true, path: .mcp-diet/audit.ndjson }
```

`${VAR}` and `${VAR:-default}` are expanded from the environment in any string value.

### Config files

`mcp-diet` searches for one of these, walking up from the cwd:

- `mcp-diet.config.yaml` / `.yml`
- `mcp-diet.config.json`
- `mcp-diet.config.js` / `.mjs`
- `.mcp-diet.yaml` / `.yml` / `.json`
- a `"mcp-diet"` key in `package.json`

You can also pass `--config <path>` to any command.

---

## How filtering works

Globs are evaluated against the **namespaced** name `<serverId>.<toolName>` using [micromatch](https://github.com/micromatch/micromatch).

- empty `allow` ⇒ everything is allowed,
- non-empty `allow` ⇒ only matches are allowed,
- `deny` is applied after `allow` and always wins.

The same filter is enforced on `tools/list`, `resources/list`, `prompts/list`, **and** `tools/call`, so a denied tool can't be invoked even if the client cached its name.

## How shrinking works

The default `rules` mode is fully deterministic:

1. Strip Markdown decoration (headings, bold, italics, links, code fences).
2. Drop boilerplate prefixes (`"This tool ..."`, `"Use this when ..."`).
3. Strip mid-sentence boilerplate (`"Returns a JSON object containing ..."`).
4. Remove filler phrases (`"please"`, `"in order to"`, `"utilize"`).
5. Truncate at the first sentence boundary past `maxDescriptionChars`.
6. JSON-Schema dedup: any sub-tree that appears 2+ times is hoisted to `$defs` and replaced with `$ref`.

Output is hashed and cached in `.mcp-diet/shrink-cache.json`, so the same description always shrinks to the same bytes — your agent never sees a moving target.

The `llm` mode (v0.2) adds an optional offline pass that can be checked into git for reproducibility.

---

## Observability

### Tracing

Every JSON-RPC frame in or out is one NDJSON line:

```json
{"level":"info","time":"2026-05-02T22:00:00.000Z","trace":true,"dir":"out","upstream":"github","method":"tools/call","name":"github.create_issue","msg":"tools/call"}
{"level":"info","time":"2026-05-02T22:00:00.231Z","trace":true,"dir":"in","upstream":"github","method":"tools/call","name":"github.create_issue","ok":true,"durMs":231,"msg":"tools/call"}
```

```bash
mcp-diet trace tail              # follow with pretty-printing
mcp-diet trace tail --no-pretty  # raw NDJSON, pipe to jq / Loki / Datadog
```

### Metrics

Prometheus endpoint at `http://<host>:9464/metrics`:

| metric | type | labels |
| --- | --- | --- |
| `mcp_diet_calls_total` | counter | `upstream`, `tool`, `ok` |
| `mcp_diet_call_duration_ms` | histogram | `upstream`, `tool`, `ok` |
| `mcp_diet_tokens_saved` | gauge | `upstream` |
| `mcp_diet_upstream_up` | gauge | `upstream` |

A starter Grafana dashboard is in [`examples/grafana-dashboard.json`](examples/grafana-dashboard.json).

### OpenTelemetry

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or enable it in config) and `mcp-diet` initializes the Node SDK with an OTLP/HTTP trace exporter.

### Audit

Every `tools/call` lands in `.mcp-diet/audit.ndjson` with the identity claims (`sub`, `iss`, `aud`, `scope`, `client_id`) decoded — but **not** verified — from the inbound `Authorization` Bearer token. Run a real auth gateway in front of `mcp-diet` if you need cryptographic verification.

---

## CLI

```text
mcp-diet                       # start the proxy (default)
mcp-diet start                 # explicit
mcp-diet measure               # before/after token report; the README hero
mcp-diet validate-config       # parse + validate, no startup
mcp-diet validate-file <path>  # validate a JSON file against the schema
mcp-diet trace tail            # tail the NDJSON trace
```

All commands accept `-c, --config <path>`.

---

## Architecture

```mermaid
flowchart LR
  subgraph Client[MCP Client]
    C[Cursor / Claude / Codex]
  end
  subgraph Proxy[mcp-diet]
    IN1[stdio inbound]
    IN2[Streamable HTTP inbound]
    CORE[Aggregator + Filter + Shrinker]
    POL[OAuth pass-through]
    OBS[Tracer + Prometheus + OTel]
    OUT[Upstream Manager]
  end
  subgraph Up[Upstreams]
    U1[GitHub MCP]
    U2[Linear MCP]
    U3[Postgres MCP]
  end
  C --> IN1
  C --> IN2
  IN1 --> CORE
  IN2 --> CORE
  CORE --> POL
  POL --> OUT
  CORE --> OBS
  OUT --> U1
  OUT --> U2
  OUT --> U3
```

`mcp-diet` uses the **low-level** `Server` from [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (not `McpServer.registerTool`) because the tool set is dynamic. In stateless Streamable HTTP mode it spins up a fresh `Server` per request, sharing the upstream connections, routing tables, filter, and shrinker through the persistent `Aggregator`.

---

## Roadmap

- [ ] **v0.2** LLM-assisted shrinking (`mode: llm`) with a checked-in offline cache.
- [ ] **v0.2** Cross-restart session resumability via Redis (`Last-Event-ID`).
- [ ] **v0.2** [Server cards](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) (`.well-known/mcp.json`) discovery.
- [ ] **v0.2** Per-upstream `tokenRewrite` hook for OAuth-on-behalf-of flows.
- [ ] **v0.3** Web dashboard reading the NDJSON trace.
- [ ] **v0.3** Tool execution sandboxing (Docker / Firecracker).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — especially bug reports with a config that reproduces the issue.

## License

[MIT](LICENSE)
