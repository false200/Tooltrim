# Tooltrim

> An open-source [Model Context Protocol](https://modelcontextprotocol.io) proxy that puts your tool list on a diet.
> Aggregate N MCP servers, filter and shrink the noise, and trace every call.

[![npm](https://img.shields.io/npm/v/tooltrim.svg)](https://www.npmjs.com/package/tooltrim)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why

Connect three or four MCP servers in a single session and the **tool metadata alone routinely eats 40-50% of the context window** before the user has even typed a question.
The MCP team's [2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) explicitly calls out gateways, proxies, and observability as priority work.

**Tooltrim** (`tooltrim` on npm) is a small, drop-in proxy that sits in front of N upstream MCP servers and:

- **filters** their tool / resource / prompt lists down to the ones your project actually uses,
- **shrinks** verbose tool descriptions and dedupes JSON-Schema sub-trees, deterministically,
- **traces** every JSON-RPC frame as NDJSON so you can finally see what your agent is doing,
- and **measures** how much context you saved.

It speaks both `stdio` and `Streamable HTTP` in both directions, runs stateless behind a load balancer, and exports Prometheus + OpenTelemetry.

---

## The hero

Measured against five real, official `@modelcontextprotocol/*` servers (`server-everything` + `server-filesystem` + `server-memory` + `server-sequential-thinking` + `server-github`). The numbers below match the checked-in [`bench/REPORT.md`](bench/REPORT.md): full **`pnpm bench`** inside the **`tooltrim:dev` Docker image** (Debian bookworm, **linux-x64**, Node **20.18**), so CI and contributors get the same Linux-shaped baseline as the README—not a hand-tuned Windows-only run.

```text
Scenario                Tools  Bytes   Tokens  vs raw (tokens)
all (raw)                  63  49,505  10,401         −0.0%
all (shrunk)               63  45,276   9,590         −7.8%
common (filter+shrink)     17  14,488   3,084        −70.3%
task   (filter+shrink)      3   3,165     656        −93.7%

Proxy round-trip overhead  +3.7 ms p50 / +6.7 ms p95  (tools/call, bench harness loopback inside container)
Throughput                 50 concurrent calls,  0 errors,  ~271 ops/sec
Agent (Claude Sonnet 4.5)  ~77% fewer cumulative input tokens (direct vs Tooltrim task filter) — see report §5
```

Full reproducible report: [`bench/REPORT.md`](bench/REPORT.md). Run the harness on the host with `pnpm bench`, or in Docker (same numbers on Linux) — see [`docs/DOCKER.md`](docs/DOCKER.md) and [`bench/README.md`](bench/README.md).

---

## Install and use

Published as [`tooltrim` on npm](https://www.npmjs.com/package/tooltrim). You do **not** need to clone this repository to run it.

### Prerequisites

- **Node.js 20+** ([nodejs.org](https://nodejs.org))

### 1. Install (pick one)

| How | Command | Best for |
|-----|---------|----------|
| **In your project** | `npm install tooltrim` | Copying `examples/` from `node_modules`, CI, apps that depend on Tooltrim |
| **Global CLI** | `npm install -g tooltrim` | Running `tooltrim` on your PATH anywhere |
| **No install** | *(skip)* — use `npx -y tooltrim …` below | Editors / MCP only; `npx` pulls the package from npm when needed |

Equivalent package managers: `pnpm add tooltrim`, `yarn add tooltrim`, or `pnpm dlx tooltrim --version` to confirm the registry.

### 2. Config file in your project root

Tooltrim reads **`tooltrim.config.yaml`** from the current working directory (see [Config files](#config-files) for search paths).

**If you used `npm install tooltrim` in that project**, copy the example and edit `servers:` for your MCPs:

```bash
# macOS / Linux
cp node_modules/tooltrim/examples/tooltrim.config.yaml ./tooltrim.config.yaml
```

```powershell
# Windows (PowerShell or cmd)
copy node_modules\tooltrim\examples\tooltrim.config.yaml .\tooltrim.config.yaml
```

**If you never run `npm install`**, create `tooltrim.config.yaml` yourself using the [Configuration](#configuration) snippet below, or install once only to copy the example, then remove `tooltrim` from `package.json` if you prefer a clean tree and rely on `npx -y tooltrim` in the editor.

Check the file:

```bash
npx -y tooltrim validate-config
```

### 3. Point your MCP client at Tooltrim

Use **`npx`** with **`-y`** so the IDE never blocks on an install prompt.

Cursor / Claude Desktop / Codex stdio config:

```json
{
  "mcpServers": {
    "tooltrim": {
      "command": "npx",
      "args": ["-y", "tooltrim"]
    }
  }
}
```

The client should use the **project root** (folder that contains `tooltrim.config.yaml`) as the process working directory when it launches `npx`.

### 4. What you get

`tooltrim` fans out to every upstream in your config and exposes **one** merged, filtered, shrunk tool list to the client—replace per-server MCP entries with this single entry.

---

## Configuration

A complete example lives in [`examples/tooltrim.config.yaml`](examples/tooltrim.config.yaml).

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
  cachePath: .tooltrim/shrink-cache.json

inbound:
  stdio: true
  http:
    enabled: true
    host: 127.0.0.1
    port: 8787
    path: /mcp
    sessions: stateless          # stateless | redis://... (v0.2)

observability:
  trace:   { sink: file, path: .tooltrim/trace.ndjson }
  metrics: { prometheus: { enabled: true, port: 9464 } }
  audit:   { enabled: true, path: .tooltrim/audit.ndjson }
```

`${VAR}` and `${VAR:-default}` are expanded from the environment in any string value.

### Config files

`tooltrim` searches for one of these, walking up from the cwd:

- `tooltrim.config.yaml` / `.yml`
- `tooltrim.config.json`
- `tooltrim.config.js` / `.mjs`
- `.tooltrim.yaml` / `.yml` / `.json`
- a `"tooltrim"` key in `package.json`

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

Output is hashed and cached in `.tooltrim/shrink-cache.json`, so the same description always shrinks to the same bytes — your agent never sees a moving target.

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
tooltrim trace tail              # follow with pretty-printing
tooltrim trace tail --no-pretty  # raw NDJSON, pipe to jq / Loki / Datadog
```

### Metrics

Prometheus endpoint at `http://<host>:9464/metrics`:

| metric | type | labels |
| --- | --- | --- |
| `tooltrim_calls_total` | counter | `upstream`, `tool`, `ok` |
| `tooltrim_call_duration_ms` | histogram | `upstream`, `tool`, `ok` |
| `tooltrim_tokens_saved` | gauge | `upstream` |
| `tooltrim_upstream_up` | gauge | `upstream` |

A starter Grafana dashboard is in [`examples/grafana-dashboard.json`](examples/grafana-dashboard.json).

### OpenTelemetry

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or enable it in config) and Tooltrim initializes the Node SDK with an OTLP/HTTP trace exporter.

### Audit

Every `tools/call` lands in `.tooltrim/audit.ndjson` with the identity claims (`sub`, `iss`, `aud`, `scope`, `client_id`) decoded — but **not** verified — from the inbound `Authorization` Bearer token. Run a real auth gateway in front of Tooltrim if you need cryptographic verification.

---

## CLI

```text
tooltrim                       # start the proxy (default)
tooltrim start                 # explicit
tooltrim measure               # before/after token report; the README hero
tooltrim validate-config       # parse + validate, no startup
tooltrim validate-file <path>  # validate a JSON file against the schema
tooltrim trace tail            # tail the NDJSON trace
```

All commands accept `-c, --config <path>`.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — especially bug reports with a config that reproduces the issue.

## License

[MIT](LICENSE)
