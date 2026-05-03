# LeanMCP — Linux container image
#
# Default behavior: starts the LeanMCP proxy on 0.0.0.0:8799 (MCP Streamable HTTP)
# and 0.0.0.0:9464 (Prometheus). It fans out to five upstream MCP servers via
# `npx`, so we warm the npm cache for those packages during build to make the
# first call fast and self-contained.
#
# Override CMD to run the bench harness instead, e.g.:
#   docker run --rm leanmcp:dev pnpm bench --skip-agent
#
# Multi-stage layout:
#   1. deps    — install ALL dependencies (incl. dev) for build + bench
#   2. build   — compile TypeScript -> dist
#   3. runtime — slim final image with deps + dist + bench harness

ARG NODE_VERSION=20.18.0
ARG PNPM_VERSION=10.26.0

# -----------------------------------------------------------------------------
# Stage 1: deps — pnpm install with frozen lockfile
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION

ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH" \
    CI=true

# Install a pinned pnpm without corepack (corepack hits npmjs.org for "latest"
# even when packageManager isn't pinned, which fails on flaky networks).
RUN npm install -g pnpm@${PNPM_VERSION} \
    || (sleep 5 && npm install -g pnpm@${PNPM_VERSION})

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: build — produce dist/
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG PNPM_VERSION

ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH"

RUN npm install -g pnpm@${PNPM_VERSION} \
    || (sleep 5 && npm install -g pnpm@${PNPM_VERSION})

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 3: runtime — slim image we actually ship/run
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG PNPM_VERSION

ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH" \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# Native deps that some npx-resolved MCP servers may pull in (sqlite3, sharp,
# etc.). Cheap and rare, but keeps `npx -y <server>` from breaking on first call.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dumb-init \
        git \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@${PNPM_VERSION} \
    || (sleep 5 && npm install -g pnpm@${PNPM_VERSION})

WORKDIR /app

# Copy built artifacts and the dependency tree from earlier stages.
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist          ./dist

# Source files the bench harness still needs at runtime (it imports from src/
# via tsx and uses bench/*.ts directly).
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY bin       ./bin
COPY src       ./src
COPY bench     ./bench
COPY examples  ./examples
COPY README.md LICENSE ./

# Warm the npm cache so the five upstream MCP servers don't pay a fresh
# download on the first proxy/bench run inside a container.
RUN set -eux; \
    for pkg in \
      @modelcontextprotocol/server-everything \
      @modelcontextprotocol/server-filesystem \
      @modelcontextprotocol/server-memory \
      @modelcontextprotocol/server-sequential-thinking \
      @modelcontextprotocol/server-github ; do \
        npm pack --silent "$pkg" --pack-destination=/tmp >/dev/null 2>&1 || true; \
    done; \
    rm -f /tmp/*.tgz

# Filesystem upstream needs a sandbox dir; the bench config defaults to
# /app/bench/sandbox via BENCH_FS_ROOT.
RUN mkdir -p /app/bench/sandbox /app/bench/results /app/.leanmcp

EXPOSE 8799 9464

# dumb-init reaps zombie children spawned by the upstream stdio servers.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default: start the proxy. Override with `pnpm bench [...]` etc.
CMD ["node", "bin/leanmcp", "start", "--config", "examples/benchmark.docker.config.yaml"]
