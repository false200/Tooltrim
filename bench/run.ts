/**
 * Entry point for `pnpm bench`. Runs every phase in order, catching per-phase
 * errors so that — for example — a missing GITHUB_TOKEN doesn't kill the
 * local-only sections of the report.
 *
 * CLI flags:
 *   --skip-agent          don't call Anthropic
 *   --only=<phase,...>    run a comma-separated subset (preflight,measure,latency,throughput,agent,report)
 *   --report-out=<path>   override the REPORT.md output path (defaults to bench/REPORT.md)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMeasureScenarios } from "./measure-scenarios.js";
import { runLatency } from "./latency.js";
import { runThroughput } from "./throughput.js";
import { runAgentBench } from "./agent.js";
import { writeReport } from "./report.js";
import { BENCH_DIR, BENCH_ROOT } from "./config.js";

interface Phase {
  id: string;
  label: string;
  run: () => Promise<unknown>;
  optional?: boolean;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipAgent = args.includes("--skip-agent");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.replace("--only=", "").split(",")) : null;

  const phases: Phase[] = [
    {
      id: "preflight",
      label: "preflight (5 upstreams: spawn + initialize + listTools)",
      run: async () => {
        runPreflight();
      },
    },
    {
      id: "measure",
      label: "measure-scenarios (token savings across all/common/task filters)",
      run: () => runMeasureScenarios(),
    },
    {
      id: "latency",
      label: "latency (100 samples, direct vs proxy, list+call)",
      run: () => runLatency(),
    },
    {
      id: "throughput",
      label: "throughput (50 concurrent tools/call)",
      run: () => runThroughput(),
    },
    {
      id: "agent",
      label: "agent loop (Claude Sonnet 4.5, direct vs proxy)",
      run: () => runAgentBench(),
      optional: true,
    },
    {
      id: "report",
      label: "report (writes bench/REPORT.md)",
      run: () => writeReport(),
    },
  ];

  const results: Record<string, { ok: boolean; ms: number; err?: string }> = {};
  for (const phase of phases) {
    if (only && !only.has(phase.id)) continue;
    if (phase.id === "agent" && skipAgent) {
      process.stderr.write(`\n[run] skipping ${phase.id} (--skip-agent)\n`);
      continue;
    }
    process.stderr.write(`\n========== ${phase.id}: ${phase.label} ==========\n`);
    const start = Date.now();
    try {
      await phase.run();
      results[phase.id] = { ok: true, ms: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const ms = Date.now() - start;
      results[phase.id] = { ok: false, ms, err: msg };
      process.stderr.write(`[run] ${phase.id} FAILED in ${ms}ms: ${msg}\n`);
      if (!phase.optional) {
        process.stderr.write(`[run] non-optional phase failed; the report will still render whatever phases did succeed.\n`);
      }
    }
  }

  process.stderr.write("\n========== run summary ==========\n");
  for (const [id, r] of Object.entries(results)) {
    process.stderr.write(`${r.ok ? "OK  " : "FAIL"}  ${id.padEnd(12)}  ${r.ms.toString().padStart(6)} ms${r.err ? "  -- " + r.err : ""}\n`);
  }
}

function runPreflight(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tsx = path.join(BENCH_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(here, "preflight.ts");
  const r = spawnSync(process.execPath, [tsx, script], {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (r.status !== 0) {
    throw new Error(`preflight exited with code ${r.status}`);
  }
}

main().catch((err) => {
  process.stderr.write(`bench/run.ts crashed: ${(err as Error).message}\n`);
  process.exit(1);
});
