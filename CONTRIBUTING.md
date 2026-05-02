# Contributing to mcp-diet

Thanks for your interest! `mcp-diet` is a small project; a quick PR is usually faster than a long discussion.

## Local setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs unit + integration suites. The integration tests spawn a local fixture MCP server over stdio, so they need Node 20+ but no network.

## Running the CLI in dev

```bash
pnpm dlx tsx src/cli.ts measure --config examples/demo.config.json
```

## Style

- TypeScript strict mode is on. Don't disable it.
- Prefer the lowest-level MCP SDK primitives (`Server`, `setRequestHandler`) for proxy code — `McpServer.registerTool` is for static tool authors.
- Keep the shrinker deterministic: same input → same output bytes. If you need an LLM, do it offline and cache the result.
- Logs go through `pino`. When stdio is the inbound transport, **everything** goes to stderr — never `console.log`.

## Commit messages

Conventional commits are nice but not enforced. A short imperative summary is fine.

## Releasing (maintainers)

1. Bump `version` in `package.json`.
2. Push a `vX.Y.Z` tag.
3. The `release.yml` workflow runs the tests and publishes to npm.

## Reporting issues

Please include:

- the version of `mcp-diet` (`mcp-diet --version`),
- the **redacted** config (use `mcp-diet validate-config` — it strips token-like fields),
- a few lines of `.mcp-diet/trace.ndjson` if relevant.

By contributing, you agree your work is licensed under the same [MIT license](LICENSE) as the project.
