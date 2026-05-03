# LeanMCP enterprise benchmark

End-to-end harness that proves LeanMCP against five real MCP servers and
a real Claude Sonnet 4.5 agent loop. Output is `bench/REPORT.md`.

## Quick start

```bash
pnpm install

# required env vars (the bench aborts cleanly if either is missing)
export GITHUB_TOKEN=ghp_...           # read-only PAT, public_repo is enough
export ANTHROPIC_API_KEY=sk-ant-...   # ~$0.05–$0.20 per full run

pnpm bench
```

PowerShell:

```powershell
$env:GITHUB_TOKEN = "ghp_..."
$env:ANTHROPIC_API_KEY = "sk-ant-..."
pnpm bench
```

The harness is safe to re-run: every phase writes its own JSON file under
`bench/results/` and `bench/report.ts` renders the report from whichever
files are present.

## Docker (Linux, reproducible)

The checked-in [`REPORT.md`](REPORT.md) hero numbers are produced with
**`pnpm bench` inside the `leanmcp:dev` image** (linux-x64, Node 20) so the
README and the report stay aligned regardless of your host OS.

```bash
docker build -t leanmcp:dev .

docker run --rm \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -v "$(pwd)/bench/results:/app/bench/results" \
  -v "$(pwd)/bench:/app/bench" \
  leanmcp:dev \
  pnpm bench
```

PowerShell: use `${PWD}\bench\...` for the volume paths. Full build/run notes:
[`docs/DOCKER.md`](../docs/DOCKER.md).

## What gets measured

| Phase | What it does | Output |
| --- | --- | --- |
| `preflight` | Spawns each of the 5 upstreams over stdio, runs `initialize`, lists tools, records resolved package versions. | `bench/results/versions.json` |
| `measure` | For 4 filter scenarios (raw / shrunk / common / task) records bytes + tokens of the merged tool list. | `bench/results/measure.json` |
| `latency` | 100 samples each of `tools/list` and `tools/call (everything.echo)` direct vs through the proxy. | `bench/results/latency.json` |
| `throughput` | 50 concurrent `tools/call` against the proxy, ops/sec + error count. | `bench/results/throughput.json` |
| `agent` | Locked task run twice (direct fan-out vs LeanMCP), Claude Sonnet 4.5, capped at 8 turns × 1024 tokens. | `bench/results/agent{,-direct,-proxy}.json` |
| `report` | Stitches everything into `bench/REPORT.md`. | `bench/REPORT.md` |

## Flags

```
pnpm bench                          # everything
pnpm bench -- --skip-agent          # skip the Anthropic call
pnpm bench -- --only=measure,report # cherry-pick phases
BENCH_DRY_RUN=1 pnpm bench          # alternate way to skip Anthropic
BENCH_LATENCY_SAMPLES=200 pnpm bench
BENCH_CONCURRENCY=100 pnpm bench
```

Individual phases can also be run as standalone scripts (no orchestrator):

```bash
pnpm bench:preflight
node node_modules/tsx/dist/cli.mjs bench/measure-scenarios.ts
node node_modules/tsx/dist/cli.mjs bench/latency.ts
node node_modules/tsx/dist/cli.mjs bench/throughput.ts
node node_modules/tsx/dist/cli.mjs bench/agent.ts
node node_modules/tsx/dist/cli.mjs bench/report.ts
```

## How the agent comparison stays apples-to-apples

Same model, same prompt, same `max_tokens`, same `maxTurns`, identical task.
Tool names are namespaced as `<upstream>.<tool>` in both passes, so the
prompt context the model sees is structurally identical apart from the
tool-list itself. The proxy pass exposes only the 3 tools the task needs;
the direct pass exposes all ~63. Anthropic returns `usage.input_tokens`
on every response — we sum across the entire conversation. That delta is
the real number.

## Files

- `bench/run.ts` — orchestrator (the `pnpm bench` entry point)
- `bench/config.ts` — central definitions: 5 upstreams, 3 filter scenarios, agent task prompt
- `bench/preflight.ts` — verify every upstream actually starts
- `bench/measure-scenarios.ts` — token-savings table
- `bench/latency.ts` — p50/p95/p99 round-trip table
- `bench/throughput.ts` — 50× concurrent stress test
- `bench/agent.ts` — Claude Sonnet 4.5 tool-use loop, twice
- `bench/direct-client.ts` — N-Client fan-out helper used as the no-proxy baseline
- `bench/report.ts` — Markdown writer
- `examples/benchmark.config.yaml` — the proxy config the bench loads
