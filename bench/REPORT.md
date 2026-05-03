# Tooltrim enterprise benchmark

> Five real MCP servers, one ~63-tool fan-out, a Claude Sonnet 4.5 agent loop,
> and the same task run twice — once direct, once through `Tooltrim`.
> Numbers below come from `pnpm bench`; raw JSON is in `bench/results/`.

- Run timestamp: `2026-05-03T17:36:40.633Z`
- Platform: `win32-x64`
- Node: `v24.12.0`
- Tooltrim: `v0.1`

## TL;DR

- **Token diet**: 63 tools · 10,401 tokens of metadata at baseline → 3 tools · 656 tokens with the `task` filter. **93.7% reduction.**
- **Proxy overhead**: `tools/call` p50 2.1 ms vs 0.3 ms direct (Δ +1.9 ms p50, +2.8 ms p95).
- **Concurrency**: 50 parallel `tools/call` finished in 101 ms — **495 ops/sec, 0 errors**.
- **Real LLM money**: same Claude Sonnet 4.5 task = 54,714 input tokens direct vs 12,690 through Tooltrim (**−42,024, 76.8% cheaper**).

## 1. Setup under test

Five MCP servers, all spawned over stdio, all reached through one `Tooltrim` Streamable HTTP inbound:

| Upstream | Package | Server name | Version | Tools | Initialize ms |
| --- | --- | --- | --- | --- | --- |
| `everything` | `@modelcontextprotocol/server-everything` | mcp-servers/everything | `2.0.0` | 13 | 3002 |
| `filesystem` | `@modelcontextprotocol/server-filesystem` | secure-filesystem-server | `0.2.0` | 14 | 2127 |
| `memory` | `@modelcontextprotocol/server-memory` | memory-server | `0.6.3` | 9 | 1861 |
| `sequentialthinking` | `@modelcontextprotocol/server-sequential-thinking` | sequential-thinking-server | `0.2.0` | 1 | 2338 |
| `github` | `@modelcontextprotocol/server-github` | github-mcp-server | `0.6.2` | 26 | 1981 |

Filter scenarios used in the measure phase:

```ts
{
  "all": {
    "allow": [],
    "deny": []
  },
  "common": {
    "allow": [
      "everything.echo",
      "everything.add",
      "everything.printEnv",
      "everything.longRunningOperation",
      "everything.sampleLLM",
      "filesystem.read_file",
      "filesystem.read_multiple_files",
      "filesystem.list_directory",
      "filesystem.search_files",
      "filesystem.get_file_info",
      "memory.create_entities",
      "memory.add_observations",
      "memory.open_nodes",
      "memory.search_nodes",
      "memory.read_graph",
      "sequentialthinking.sequentialthinking",
      "github.search_repositories",
      "github.get_file_contents",
      "github.list_issues",
      "github.get_issue",
      "github.search_code"
    ],
    "deny": [
      "*.delete_*",
      "*.create_or_update_*"
    ]
  },
  "task": {
    "allow": [
      "github.get_file_contents",
      "memory.create_entities",
      "memory.open_nodes"
    ],
    "deny": []
  }
}
```

## 2. Token savings — `tools/list` payload

Bytes and tokens are over the JSON-stringified tool list — the exact thing your LLM client puts into the model's context window every turn. Tokens use the `gpt-tokenizer` cl100k_base encoder (a reasonable proxy for Claude's tokenizer).

| Scenario | Tools | Bytes | Tokens | vs raw (bytes) | vs raw (tokens) |
| --- | ---: | ---: | ---: | ---: | ---: |
| all (raw) | 63 | 49,505 | 10,401 | −0.0% | −0.0% |
| all (shrunk) | 63 | 45,276 | 9,590 | −8.5% | −7.8% |
| common (filter+shrink) | 17 | 14,488 | 3,084 | −70.7% | −70.3% |
| task (filter+shrink) | 3 | 3,165 | 656 | −93.6% | −93.7% |

## 3. Round-trip latency (loopback)

100 samples per row, after 5 warmup calls. `tools/call` is against `everything.echo` with a tiny payload, so what we're measuring is JSON-RPC round-trip overhead.

| Mode | Op | p50 | p95 | p99 | max | mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| direct | `tools/list` | 1.5 ms | 3.1 ms | 4.3 ms | 4.3 ms | 1.7 ms |
| direct | `tools/call` | 0.3 ms | 0.4 ms | 1.5 ms | 1.5 ms | 0.3 ms |
| proxy | `tools/list` | 28.2 ms | 36.4 ms | 48.8 ms | 48.8 ms | 28.6 ms |
| proxy | `tools/call` | 2.1 ms | 3.2 ms | 4.9 ms | 4.9 ms | 2.2 ms |

- `tools/call` proxy overhead: **+1.9 ms p50, +2.8 ms p95** — basically the cost of one extra HTTP hop and a JSON-RPC re-serialization.
- `tools/list` proxy overhead is higher (+26.7 ms p50) because the proxy fans out to all upstreams every list, while the "direct" baseline only hits one. That's an honest, expected delta — the proxy is doing strictly more work.

## 4. Parallel throughput

50 concurrent `tools/call` requests against the proxy's HTTP inbound, each from its own `Client` session.

| Total time | Errors | Ops/sec | Per-call mean |
| ---: | ---: | ---: | ---: |
| 101.0 ms | 0 | 494.9 | 2.02 ms |

> 0 errors at 50 concurrent sessions on Streamable HTTP "stateless" mode validates the per-request `Server` factory pattern in `src/server/http.ts`.

## 5. Real Claude Sonnet 4.5 agent loop

Model: `claude-sonnet-4-5` · max turns: `8` · max tokens/turn: `1024`

**Task prompt (verbatim, used for both passes):**

> Use the GitHub MCP server to fetch the README of the modelcontextprotocol/servers repository (owner: modelcontextprotocol, repo: servers, path: README.md, ref: main).
>
> From it, identify the three most prominently-listed reference servers and write a short 1-line summary for each.
>
> Store the result in the memory MCP server by calling create_entities once with three entities, each having entityType 'mcp_server' and a single observation that contains the 1-line summary.
>
> Then read it back with open_nodes and present the three summaries as your final answer.

| Variant | Tools exposed | Tool-list bytes | Turns | Tool calls | Input tokens | Output tokens | Wall time | Final answer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| direct | 63 | 37,769 | 4 | 3 | 54,714 | 624 | 18.3 s | yes |
| proxy | 3 | 1,509 | 4 | 3 | 12,690 | 534 | 13.5 s | yes |
| **Δ direct → proxy** | | | | +0 | **−42,024 (76.8%)** | | 4.8 s | |

**Proxy run final answer (truncated):**

```text
Perfect! Here are the three most prominently-listed reference servers from the Model Context Protocol servers repository:

1. **Everything** - Reference / test server with prompts, resources, and tools

2. **Fetch** - Web content fetching and conversion for efficient LLM usage

3. **Filesystem** - Secure file operations with configurable access controls

These three servers are listed first in the "Reference Servers" section of the README and represent core demonstration implementations of the MCP protocol's capabilities.
```

## 6. Trace + metrics evidence

Last 10 lines of `.tooltrim/trace.ndjson`:

```ndjson
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":22,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":22,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":21,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":20,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":19,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":18,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":17,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":15,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":14,"msg":"tools/call"}
{"level":"info","time":"2026-05-03T17:37:01.058Z","trace":true,"dir":"in","upstream":"everything","method":"tools/call","name":"everything.echo","ok":true,"durMs":14,"msg":"tools/call"}
```

Live `/metrics` excerpt scraped during the throughput phase:

```text
tooltrim_calls_total{upstream="everything",tool="everything.echo",ok="true",service="tooltrim"} 51
tooltrim_call_duration_ms_bucket{le="25",service="tooltrim",upstream="everything",tool="everything.echo",ok="true"} 16
tooltrim_call_duration_ms_bucket{le="100",service="tooltrim",upstream="everything",tool="everything.echo",ok="true"} 51
tooltrim_call_duration_ms_bucket{le="250",service="tooltrim",upstream="everything",tool="everything.echo",ok="true"} 51
tooltrim_call_duration_ms_sum{service="tooltrim",upstream="everything",tool="everything.echo",ok="true"} 1629
tooltrim_call_duration_ms_count{service="tooltrim",upstream="everything",tool="everything.echo",ok="true"} 51
tooltrim_upstream_up{upstream="github",service="tooltrim"} 1
tooltrim_upstream_up{upstream="memory",service="tooltrim"} 1
tooltrim_upstream_up{upstream="sequentialthinking",service="tooltrim"} 1
tooltrim_upstream_up{upstream="everything",service="tooltrim"} 1
tooltrim_upstream_up{upstream="filesystem",service="tooltrim"} 1
```

> The trace.ndjson and `/metrics` endpoint are hot during the bench because `examples/benchmark.config.yaml` enables `observability.trace`, `observability.metrics.prometheus`, and `observability.audit`. They're real, not theoretical.

## 7. How to reproduce

```bash
# 1. install
pnpm install

# 2. set required env vars (the bench aborts cleanly if either is missing)
export GITHUB_TOKEN=ghp_...           # read-only; public_repo is enough
export ANTHROPIC_API_KEY=sk-ant-...   # ~$0.05–$0.20 per full run

# 3. one-shot
pnpm bench

# (optional) only the local phases, skip Anthropic spend
BENCH_DRY_RUN=1 pnpm bench
```

Raw JSON for every section is in `bench/results/`. The orchestrator is `bench/run.ts`; see `bench/README.md` for phase-level commands.
