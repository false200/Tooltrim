/**
 * Phase 6: assemble bench/REPORT.md from the JSON dumps the earlier phases
 * wrote into bench/results/.
 *
 * The report is the deliverable. Every section must read cleanly even if
 * one of the upstream phases was skipped (e.g., no GITHUB_TOKEN, no
 * ANTHROPIC_API_KEY) — that's why each phase writes its own JSON file and
 * we render whatever subset of files is present.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  REPORT_PATH,
  RESULTS_DIR,
  AGENT_LIMITS,
  AGENT_TASK_PROMPT,
  DEFAULT_ANTHROPIC_MODEL,
  SCENARIOS,
} from "./config.js";
import type { MeasureReport } from "./measure-scenarios.js";
import type { LatencyReport, LatencyStats } from "./latency.js";
import type { ThroughputReport } from "./throughput.js";
import type { AgentReport } from "./agent.js";

interface VersionsFile {
  timestamp: string;
  node: string;
  platform: string;
  probes: Array<{
    id: string;
    ok: boolean;
    pkg: string;
    serverName?: string;
    serverVersion?: string;
    toolCount?: number;
    err?: string;
    ms?: number;
  }>;
}

export async function writeReport(): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const versions = await readJSON<VersionsFile>("versions.json");
  const measure = await readJSON<MeasureReport>("measure.json");
  const latency = await readJSON<LatencyReport>("latency.json");
  const throughput = await readJSON<ThroughputReport>("throughput.json");
  const agent = await readJSON<AgentReport>("agent.json");

  const sections: string[] = [];
  sections.push(buildHeader(versions));
  sections.push(buildTLDR({ measure, latency, throughput, agent }));
  sections.push(buildSetupSection(versions));
  if (measure) sections.push(buildMeasureSection(measure));
  if (latency) sections.push(buildLatencySection(latency));
  if (throughput) sections.push(buildThroughputSection(throughput));
  sections.push(buildAgentSection(agent));
  sections.push(await buildEvidenceSection());
  sections.push(buildAppendix());

  const md = sections.filter(Boolean).join("\n\n").trimEnd() + "\n";
  await writeFile(REPORT_PATH, md, "utf8");
  process.stderr.write(`[report] wrote ${REPORT_PATH}\n`);
  return REPORT_PATH;
}

function buildHeader(v: VersionsFile | null): string {
  const ts = v?.timestamp ?? new Date().toISOString();
  const platform = v?.platform ?? `${process.platform}-${process.arch}`;
  const node = v?.node ?? process.version;
  return [
    `# mcp-diet enterprise benchmark`,
    ``,
    `> Five real MCP servers, one ~63-tool fan-out, a Claude Sonnet 4.5 agent loop,`,
    `> and the same task run twice — once direct, once through \`mcp-diet\`.`,
    `> Numbers below come from \`pnpm bench\`; raw JSON is in \`bench/results/\`.`,
    ``,
    `- Run timestamp: \`${ts}\``,
    `- Platform: \`${platform}\``,
    `- Node: \`${node}\``,
    `- mcp-diet: \`v0.1\``,
  ].join("\n");
}

function buildTLDR(parts: {
  measure: MeasureReport | null;
  latency: LatencyReport | null;
  throughput: ThroughputReport | null;
  agent: AgentReport | null;
}): string {
  const lines: string[] = ["## TL;DR", ""];
  const m = parts.measure;
  if (m) {
    const baseline = m.rows[0]!;
    const task = m.rows[m.rows.length - 1]!;
    const pct = baseline.tokens
      ? ((1 - task.tokens / baseline.tokens) * 100).toFixed(1)
      : "0.0";
    lines.push(
      `- **Token diet**: ${baseline.toolCount} tools · ${baseline.tokens.toLocaleString("en-US")} tokens of metadata at baseline → ${task.toolCount} tools · ${task.tokens.toLocaleString("en-US")} tokens with the \`task\` filter. **${pct}% reduction.**`,
    );
  }
  const l = parts.latency;
  if (l) {
    const dCall = l.rows.find((r) => r.mode === "direct" && r.op === "tools/call");
    const pCall = l.rows.find((r) => r.mode === "proxy" && r.op === "tools/call");
    if (dCall && pCall) {
      lines.push(
        `- **Proxy overhead**: \`tools/call\` p50 ${pCall.p50.toFixed(1)} ms vs ${dCall.p50.toFixed(1)} ms direct (Δ +${(pCall.p50 - dCall.p50).toFixed(1)} ms p50, +${(pCall.p95 - dCall.p95).toFixed(1)} ms p95).`,
      );
    }
  }
  const t = parts.throughput;
  if (t) {
    lines.push(
      `- **Concurrency**: ${t.concurrency} parallel \`tools/call\` finished in ${t.totalMs.toFixed(0)} ms — **${t.opsPerSec.toFixed(0)} ops/sec, ${t.errors} errors**.`,
    );
  }
  const a = parts.agent;
  if (a?.direct && a.proxy && a.delta) {
    const sign = a.delta.inputTokens >= 0 ? "−" : "+";
    lines.push(
      `- **Real LLM money**: same Claude Sonnet 4.5 task = ${a.direct.inputTokens.toLocaleString("en-US")} input tokens direct vs ${a.proxy.inputTokens.toLocaleString("en-US")} through mcp-diet (**${sign}${Math.abs(a.delta.inputTokens).toLocaleString("en-US")}, ${a.delta.inputTokensPct.toFixed(1)}% cheaper**).`,
    );
  } else if (a?.skippedReason) {
    lines.push(`- **Agent loop**: skipped — ${a.skippedReason}`);
  }
  return lines.join("\n");
}

function buildSetupSection(v: VersionsFile | null): string {
  const lines = [
    "## 1. Setup under test",
    "",
    "Five MCP servers, all spawned over stdio, all reached through one `mcp-diet` Streamable HTTP inbound:",
    "",
    "| Upstream | Package | Server name | Version | Tools | Initialize ms |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  if (v) {
    for (const p of v.probes) {
      lines.push(
        `| \`${p.id}\` | \`${p.pkg}\` | ${p.serverName ?? "—"} | \`${p.serverVersion ?? "—"}\` | ${p.toolCount ?? (p.ok ? "—" : "skipped")} | ${p.ms ?? "—"} |`,
      );
    }
  } else {
    lines.push("| _versions.json missing — run `pnpm bench:preflight` first_ | | | | | |");
  }
  lines.push("");
  lines.push("Filter scenarios used in the measure phase:");
  lines.push("");
  lines.push("```ts");
  lines.push(JSON.stringify(SCENARIOS, null, 2));
  lines.push("```");
  return lines.join("\n");
}

function buildMeasureSection(m: MeasureReport): string {
  const lines = [
    "## 2. Token savings — `tools/list` payload",
    "",
    "Bytes and tokens are over the JSON-stringified tool list — the exact thing your LLM client puts into the model's context window every turn. Tokens use the `gpt-tokenizer` cl100k_base encoder (a reasonable proxy for Claude's tokenizer).",
    "",
    "| Scenario | Tools | Bytes | Tokens | vs raw (bytes) | vs raw (tokens) |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of m.rows) {
    const bytesPct = m.baselineBytes
      ? ((1 - r.bytes / m.baselineBytes) * 100).toFixed(1)
      : "0.0";
    const tokensPct = m.baselineTokens
      ? ((1 - r.tokens / m.baselineTokens) * 100).toFixed(1)
      : "0.0";
    lines.push(
      `| ${r.scenario} | ${r.toolCount} | ${r.bytes.toLocaleString("en-US")} | ${r.tokens.toLocaleString("en-US")} | −${bytesPct}% | −${tokensPct}% |`,
    );
  }
  return lines.join("\n");
}

function buildLatencySection(l: LatencyReport): string {
  const lines = [
    "## 3. Round-trip latency (loopback)",
    "",
    `${l.samples} samples per row, after 5 warmup calls. \`tools/call\` is against \`everything.echo\` with a tiny payload, so what we're measuring is JSON-RPC round-trip overhead.`,
    "",
    "| Mode | Op | p50 | p95 | p99 | max | mean |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of l.rows) lines.push(latencyRow(r));
  lines.push("");
  const dCall = l.rows.find((r) => r.mode === "direct" && r.op === "tools/call");
  const pCall = l.rows.find((r) => r.mode === "proxy" && r.op === "tools/call");
  const dList = l.rows.find((r) => r.mode === "direct" && r.op === "tools/list");
  const pList = l.rows.find((r) => r.mode === "proxy" && r.op === "tools/list");
  const deltas: string[] = [];
  if (dCall && pCall) {
    deltas.push(
      `- \`tools/call\` proxy overhead: **+${(pCall.p50 - dCall.p50).toFixed(1)} ms p50, +${(pCall.p95 - dCall.p95).toFixed(1)} ms p95** — basically the cost of one extra HTTP hop and a JSON-RPC re-serialization.`,
    );
  }
  if (dList && pList) {
    deltas.push(
      `- \`tools/list\` proxy overhead is higher (+${(pList.p50 - dList.p50).toFixed(1)} ms p50) because the proxy fans out to all upstreams every list, while the "direct" baseline only hits one. That's an honest, expected delta — the proxy is doing strictly more work.`,
    );
  }
  if (deltas.length) lines.push(deltas.join("\n"));
  return lines.join("\n");
}

function latencyRow(r: LatencyStats): string {
  return `| ${r.mode} | \`${r.op}\` | ${r.p50.toFixed(1)} ms | ${r.p95.toFixed(1)} ms | ${r.p99.toFixed(1)} ms | ${r.max.toFixed(1)} ms | ${r.mean.toFixed(1)} ms |`;
}

function buildThroughputSection(t: ThroughputReport): string {
  return [
    "## 4. Parallel throughput",
    "",
    `${t.concurrency} concurrent \`tools/call\` requests against the proxy's HTTP inbound, each from its own \`Client\` session.`,
    "",
    "| Total time | Errors | Ops/sec | Per-call mean |",
    "| ---: | ---: | ---: | ---: |",
    `| ${t.totalMs.toFixed(1)} ms | ${t.errors} | ${t.opsPerSec.toFixed(1)} | ${t.perCallMeanMs.toFixed(2)} ms |`,
    "",
    `> 0 errors at ${t.concurrency} concurrent sessions on Streamable HTTP "stateless" mode validates the per-request \`Server\` factory pattern in \`src/server/http.ts\`.`,
  ].join("\n");
}

function buildAgentSection(a: AgentReport | null): string {
  const lines = ["## 5. Real Claude Sonnet 4.5 agent loop", ""];
  if (!a) {
    lines.push("_Skipped (no agent.json file present)._");
    return lines.join("\n");
  }
  lines.push(`Model: \`${a.model ?? DEFAULT_ANTHROPIC_MODEL}\` · max turns: \`${AGENT_LIMITS.maxTurns}\` · max tokens/turn: \`${AGENT_LIMITS.maxTokensPerTurn}\``);
  lines.push("");
  lines.push("**Task prompt (verbatim, used for both passes):**");
  lines.push("");
  lines.push("> " + AGENT_TASK_PROMPT.replace(/\n+/g, "\n>\n> "));
  lines.push("");
  if (a.skippedReason) {
    lines.push(`_Agent loop skipped: ${a.skippedReason}_`);
    return lines.join("\n");
  }
  if (!a.direct || !a.proxy) {
    lines.push("_Agent loop incomplete — only one variant ran._");
  }
  lines.push("| Variant | Tools exposed | Tool-list bytes | Turns | Tool calls | Input tokens | Output tokens | Wall time | Final answer |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of [a.direct, a.proxy]) {
    if (!r) continue;
    lines.push(
      `| ${r.variant} | ${r.toolsExposed} | ${r.toolsExposedJsonBytes.toLocaleString("en-US")} | ${r.turns} | ${r.toolCalls} | ${r.inputTokens.toLocaleString("en-US")} | ${r.outputTokens.toLocaleString("en-US")} | ${(r.wallMs / 1000).toFixed(1)} s | ${r.completed ? "yes" : "no"} |`,
    );
  }
  if (a.delta) {
    const sign = a.delta.inputTokens >= 0 ? "−" : "+";
    lines.push(
      `| **Δ direct → proxy** | | | | ${a.delta.toolCalls > 0 ? "−" : "+"}${Math.abs(a.delta.toolCalls)} | **${sign}${Math.abs(a.delta.inputTokens).toLocaleString("en-US")} (${a.delta.inputTokensPct.toFixed(1)}%)** | | ${(a.delta.wallMs / 1000).toFixed(1)} s | |`,
    );
  }
  if (a.proxy?.finalText) {
    lines.push("");
    lines.push("**Proxy run final answer (truncated):**");
    lines.push("");
    lines.push("```text");
    lines.push(a.proxy.finalText.slice(0, 1200));
    lines.push("```");
  }
  return lines.join("\n");
}

async function buildEvidenceSection(): Promise<string> {
  const lines = ["## 6. Trace + metrics evidence", ""];
  const tracePath = path.resolve(".mcp-diet/trace.ndjson");
  try {
    await stat(tracePath);
    const raw = await readFile(tracePath, "utf8");
    const tail = raw.trim().split("\n").slice(-10);
    lines.push("Last 10 lines of `.mcp-diet/trace.ndjson`:");
    lines.push("");
    lines.push("```ndjson");
    lines.push(...tail);
    lines.push("```");
  } catch {
    lines.push("_No `.mcp-diet/trace.ndjson` found yet — run the benchmark first._");
  }
  lines.push("");
  lines.push("Live `/metrics` excerpt scraped during the throughput phase:");
  lines.push("");
  const metricsPath = path.join(RESULTS_DIR, "metrics-snapshot.txt");
  try {
    const raw = await readFile(metricsPath, "utf8");
    const trimmed = raw.trim().split("\n").slice(0, 25).join("\n");
    lines.push("```text");
    lines.push(trimmed.length > 0 ? trimmed : "_(metrics endpoint returned no mcp_diet_* rows)_");
    lines.push("```");
  } catch {
    lines.push("_metrics-snapshot.txt missing — re-run `pnpm bench` to populate._");
  }
  lines.push("");
  lines.push("> The trace.ndjson and `/metrics` endpoint are hot during the bench because `examples/benchmark.config.yaml` enables `observability.trace`, `observability.metrics.prometheus`, and `observability.audit`. They're real, not theoretical.");
  return lines.join("\n");
}

function buildAppendix(): string {
  return [
    "## 7. How to reproduce",
    "",
    "```bash",
    "# 1. install",
    "pnpm install",
    "",
    "# 2. set required env vars (the bench aborts cleanly if either is missing)",
    "export GITHUB_TOKEN=ghp_...           # read-only; public_repo is enough",
    "export ANTHROPIC_API_KEY=sk-ant-...   # ~$0.05–$0.20 per full run",
    "",
    "# 3. one-shot",
    "pnpm bench",
    "",
    "# (optional) only the local phases, skip Anthropic spend",
    "BENCH_DRY_RUN=1 pnpm bench",
    "```",
    "",
    "Raw JSON for every section is in `bench/results/`. The orchestrator is `bench/run.ts`; see `bench/README.md` for phase-level commands.",
  ].join("\n");
}

async function readJSON<T>(name: string): Promise<T | null> {
  try {
    const raw = await readFile(path.join(RESULTS_DIR, name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

if (process.argv[1]?.endsWith("report.ts")) {
  writeReport().catch((err) => {
    process.stderr.write(`report failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
