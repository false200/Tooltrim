# Tooltrim

[![npm](https://img.shields.io/npm/v/tooltrim.svg)](https://www.npmjs.com/package/tooltrim)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

⚡ **Drop-in [MCP](https://modelcontextprotocol.io) proxy** — aggregate N upstream servers into one endpoint, filter and shrink the tool list, trace every call, and measure tokens saved.

**Tooltrim** (`tooltrim` on npm) sits in front of your MCP servers so your agent sees one smaller tool catalog instead of every definition from every server.

*Disclaimer: not affiliated with Anthropic, the MCP spec authors, or any upstream MCP server project.*

---

## ⚡ Features

**`tooltrim`** — One MCP entry in your editor instead of five. Fans out to every upstream in your config.

**`tooltrim measure`** — Wondering if this is worth it? Prints a before/after token table from your real config.

**Glob filters** — `github.*` yes, `github.delete_*` no. Same rules on list *and* call, so denied tools stay denied.

**Deterministic shrinker** — Trims bloated descriptions and dedupes JSON-Schema. Same input → same bytes, every time.

**NDJSON tracing** — Every JSON-RPC frame logged. Finally see what your agent is actually doing.

**Prometheus + OpenTelemetry** — Metrics, traces, and audit hooks for production deployments.

And the numbers (5 official `@modelcontextprotocol/*` servers, reproducible in [`bench/REPORT.md`](bench/REPORT.md)):

```text
Scenario                Tools  Tokens  vs raw
all (raw)                  63  10,401   −0.0%
common (filter+shrink)     17   3,084  −70.3%
task   (filter+shrink)      3     656  −93.7%
```

---

## Table of Contents

- [⚡ Features](#-features)
- [📦 Installation](#-installation)
- [🧪 Usage](#-usage)
- [⚙️ Configuration](#️-configuration)
- [🛠️ Requirements](#️-requirements)
- [📁 Repo & Contributions](#-repo--contributions)
- [📄 License](#-license)

⸻

## 📦 Installation

### npx (recommended for editors)

No install. Point Cursor / Claude Desktop / Codex at:

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

Use your **project root** (folder with `tooltrim.config.yaml`) as the working directory.

### npm

```bash
npm install -g tooltrim    # global CLI on your PATH
npm install tooltrim       # local dep — copy examples from node_modules
```

Also: `pnpm add tooltrim`, `yarn add tooltrim`.

### Docker

```bash
docker build -t tooltrim .
```

See [`docs/DOCKER.md`](docs/DOCKER.md) for run flags and benchmark mounts.

⸻

## 🧪 Usage

### Start the proxy

```bash
npx -y tooltrim
# or
tooltrim start --config tooltrim.config.yaml
```

Reads `tooltrim.config.yaml` from the current directory (or pass `--config`). Fans out to all upstreams and exposes one merged MCP endpoint.

### Measure token savings

```bash
npx -y tooltrim measure --config tooltrim.config.yaml
```

Connects to your upstreams, lists tools raw vs filtered vs shrunk, and prints a token/byte table. This is how the README hero numbers are produced.

### Validate config

```bash
npx -y tooltrim validate-config
```

Parses and validates your config, redacts secrets, prints JSON. Run this before opening an issue.

### Tail the trace log

```bash
tooltrim trace tail
tooltrim trace tail --no-pretty   # pipe to jq / Loki / Datadog
```

### Point your editor at Tooltrim

1. Copy the example config:

```bash
cp node_modules/tooltrim/examples/tooltrim.config.yaml ./tooltrim.config.yaml
# or grab it from this repo: examples/tooltrim.config.yaml
```

2. Edit `servers:` for your MCPs.
3. Add the `npx -y tooltrim` stdio entry above to your MCP client config.

Replace per-server MCP entries with this single one.

⸻

## ⚙️ Configuration

Minimal example — full reference in [`examples/tooltrim.config.yaml`](examples/tooltrim.config.yaml).

```yaml
servers:
  github:
    transport: stdio
    command: ["npx", "-y", "@modelcontextprotocol/server-github"]
    env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }
  linear:
    transport: http
    url: https://mcp.linear.app/sse
    auth: passthrough

filters:
  allow: ["github.*", "linear.create_*"]
  deny:  ["github.delete_*", "*.admin_*"]

shrink:
  mode: rules
  maxDescriptionChars: 160
  dedupeSchemas: true

inbound:
  stdio: true
  http:
    enabled: true
    port: 8787
    path: /mcp

observability:
  trace:   { sink: file, path: .tooltrim/trace.ndjson }
  metrics: { prometheus: { enabled: true, port: 9464 } }
```

**Filtering** — globs match the namespaced name `<server>.<tool>`. Empty `allow` = everything; non-empty `allow` = gate; `deny` always wins.

**Config search paths** — `tooltrim.config.yaml`, `.tooltrim.json`, `"tooltrim"` key in `package.json`, or `--config <path>`.

`${VAR}` in any string is expanded from the environment.

⸻

## 🛠️ Requirements

- **Node.js 20+**
- **npx** (bundled with Node) for editor stdio transport
- Upstream MCP servers reachable via stdio spawn or HTTP URL

⸻

## 📁 Repo & Contributions

🛠️ **Repo:** https://github.com/false200/Tooltrim  
📦 **npm:** https://www.npmjs.com/package/tooltrim  
📊 **Benchmarks:** [`bench/REPORT.md`](bench/REPORT.md)

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports with `tooltrim validate-config` output are gold.

⸻

## 📄 License

[MIT](LICENSE)
