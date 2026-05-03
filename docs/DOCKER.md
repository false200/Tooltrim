# Tooltrim in Docker

A self-contained way to run Tooltrim (`tooltrim` CLI) and the bench harness on any Linux
host without installing Node, pnpm, or any of the upstream MCP servers
yourself. Useful for:

- A clean Linux "truth" environment from a Windows or macOS dev box.
- Reproducing `bench/REPORT.md` numbers on a different machine (the README
  **hero** block is refreshed from a full `pnpm bench` in this image so the
  baseline stays **linux-x64** / pinned Node).
- Dropping the proxy on a small VM behind an SSH tunnel for WAN-like
  benchmarking.

## Build

```bash
docker build -t tooltrim:dev .
```

The image is multi-stage (`node:20-bookworm-slim`):

1. `deps` — `pnpm install --frozen-lockfile`.
2. `build` — `pnpm build` produces `dist/`.
3. `runtime` — slim final image with `dist/`, the `bench/` harness, the five
   upstream MCP servers warmed in the npm cache, `dumb-init` as PID 1, and
   ports `8799` (MCP HTTP) + `9464` (Prometheus) exposed.

## Run the proxy (default)

The container's default command starts `tooltrim` against
[`examples/benchmark.docker.config.yaml`](../examples/benchmark.docker.config.yaml),
which binds inbound HTTP on `0.0.0.0:8799` and Prometheus on `0.0.0.0:9464`
inside the container.

```bash
docker run --rm -d --name mcpd \
  -p 127.0.0.1:8799:8799 \
  -p 127.0.0.1:9464:9464 \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  tooltrim:dev

# verify
curl -fsS http://127.0.0.1:9464/metrics | head -5
docker logs mcpd | head -20

docker stop mcpd
```

> Safety: always bind the host port to `127.0.0.1:...` (as above), not
> `0.0.0.0:...`. The proxy speaks MCP without any auth by default — keep it
> off the LAN unless you're putting a TLS reverse-proxy + auth in front.

## Run the bench inside the container

The bench harness lives in `bench/` and reads
[`examples/benchmark.config.yaml`](../examples/benchmark.config.yaml). It
boots its own Tooltrim instance programmatically, so you don't need a
separate proxy container running.

```bash
mkdir -p bench/results

# fast: local phases only, no Anthropic spend
docker run --rm \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  -v "$PWD/bench/results:/app/bench/results" \
  tooltrim:dev \
  pnpm bench --skip-agent

# full: includes the Claude Sonnet 4.5 agent loop (~$0.05–$0.20 per run)
docker run --rm \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -v "$PWD/bench/results:/app/bench/results" \
  -v "$PWD/bench:/app/bench" \
  tooltrim:dev \
  pnpm bench
```

After the run, `bench/REPORT.md` and `bench/results/*.json` are written into
the mounted host directory.

## Use it as a remote proxy via SSH tunnel (Option A)

Run the container on a Linux host (Ubuntu PC, VM, etc.) bound to loopback,
then forward the port from your dev machine. No public exposure required.

```bash
# on the Linux host
docker run --rm -d --name mcpd \
  -p 127.0.0.1:8799:8799 -p 127.0.0.1:9464:9464 \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  tooltrim:dev

# on your dev machine
ssh -N -L 8799:127.0.0.1:8799 user@LINUX_HOST
# in another shell, point clients at http://127.0.0.1:8799/mcp
```

The `bench/latency.ts` and `bench/throughput.ts` scripts currently boot
their own proxy in-process; see the parent plan for `BENCH_PROXY_URL` if you
want them to target the containerized proxy directly.

## Useful flags

| Flag | What it does |
| --- | --- |
| `-p 127.0.0.1:8799:8799` | Expose MCP HTTP only on the host's loopback. |
| `-p 127.0.0.1:9464:9464` | Same for Prometheus `/metrics`. |
| `-e GITHUB_TOKEN=...` | Lets the `github` upstream connect; otherwise the bench skips it. |
| `-e ANTHROPIC_API_KEY=...` | Lets `pnpm bench` run the Claude agent loop. |
| `-v "$PWD/bench/results:/app/bench/results"` | Persist raw bench JSON to the host. |
| `-v "$PWD/bench:/app/bench"` | Persist `bench/REPORT.md` (and everything else) to the host. |
| `--rm` | Don't leave dead containers around between runs. |

## Image hygiene

- The `.dockerignore` excludes `node_modules`, `dist`, `.tooltrim`, local
  bench results and reports, and any `.env*` files — secrets never end up in
  a layer.
- `dumb-init` is PID 1 so the upstream `npx` children get reaped when the
  container stops.
- `examples/benchmark.config.yaml` is left as a loopback-bound config for
  host-native use; the Docker variant lives next to it as
  `examples/benchmark.docker.config.yaml`.
