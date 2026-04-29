// ============================================================================
// swe-bench-probe.ts
//
// Read-only probe over `.danteforge/bench-results.json` (produced by the
// DanteCode `dantecode bench` runner). Used by ascend-engine to:
//
//   1. Override the matrix dimension `swe_bench` self-score with the actual
//      pass rate from the most recent bench run, instead of relying on the
//      generic harsh-scorer which has no SWE-bench dimension at all.
//
//   2. Build a focused forge goal that names specific failure modes ("19
//      test_assertion failures, 10 timeouts, 7 empty patches") so the
//      improvement cycle attacks measurable targets, not abstract goals.
//
// The probe never spawns the bench runner. Running benchmarks is expensive
// (real provider calls). The user invokes `dantecode bench` when they
// want fresh data; the probe just reads what's there.
// ============================================================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface SweBenchRun {
  run_id: string;
  timestamp: string;
  model: string;
  total: number;
  resolved: number;
  pass_rate: number;
  failure_modes: string[];
}

export interface SweBenchAggregated {
  last_updated: string;
  best_pass_rate: number;
  best_model: string;
  runs: SweBenchRun[];
}

export interface SweBenchScore {
  /** 0.0 - 10.0 — pass rate × 10, rounded to 1 decimal. */
  displayScore: number;
  /** 0.0 - 1.0 — raw pass rate from the latest run. */
  passRate: number;
  /** Total instances in the latest run. */
  instancesTotal: number;
  /** Latest run id (e.g., "run-2026-04-21-010"). */
  latestRunId: string;
  /** Failure mode counts ["test_assertion:19", ...] from the latest run. */
  failureModes: string[];
  /** ISO timestamp of the latest run. */
  timestamp: string;
}

const BENCH_RESULTS_PATH = path.join('.danteforge', 'bench-results.json');
const FAILURE_ANALYSIS_PATH = path.join('.danteforge', 'swe-bench-failure-analysis.md');

/**
 * Read the latest SWE-bench pass rate and convert it to a 0-10 display score.
 * Returns null when no bench-results file exists or it has no runs.
 *
 * Score formula: passRate × 10. So 56% → 5.6, 70% → 7.0, 100% → 10.0.
 */
export async function readSweBenchScore(cwd: string): Promise<SweBenchScore | null> {
  const filePath = path.join(cwd, BENCH_RESULTS_PATH);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  let data: SweBenchAggregated;
  try {
    data = JSON.parse(raw) as SweBenchAggregated;
  } catch {
    return null;
  }

  const runs = Array.isArray(data.runs) ? data.runs : [];
  if (runs.length === 0) return null;

  // The runs array is in newest-first order in the canonical layout
  // (run-2026-04-21-010 comes before run-2026-04-21-009). Pick the first.
  const latest = runs[0]!;
  const passRate = typeof latest.pass_rate === 'number' ? latest.pass_rate : 0;

  return {
    displayScore: Math.round(passRate * 100) / 10, // 0.56 → 5.6
    passRate,
    instancesTotal: latest.total ?? 0,
    latestRunId: latest.run_id ?? 'unknown',
    failureModes: Array.isArray(latest.failure_modes) ? latest.failure_modes : [],
    timestamp: latest.timestamp ?? '',
  };
}

/**
 * Build a forge goal for the SWE-bench dimension. Includes the current pass
 * rate, target, top failure modes, and a pointer to the failure-analysis
 * doc when present. The goal is suitable for `danteforge forge "<goal>"`.
 */
export async function formatSweBenchGoal(
  cwd: string,
  target: number,
): Promise<string> {
  const score = await readSweBenchScore(cwd);

  if (!score) {
    return [
      `Improve SWE-bench performance: target ${target.toFixed(1)}/10.`,
      `No bench-results.json found at .danteforge/bench-results.json. First run:`,
      `  dantecode bench --instances 100 --model anthropic/claude-sonnet-4-6`,
      `Then re-run ascend so this cycle can target specific failure modes.`,
    ].join('\n');
  }

  const failureSummary = score.failureModes.length > 0
    ? score.failureModes.join(', ')
    : '(no failure modes captured)';

  const analysisPath = path.join(cwd, FAILURE_ANALYSIS_PATH);
  const hasAnalysis = await fs.access(analysisPath).then(() => true).catch(() => false);

  const lines = [
    `Improve SWE-bench performance: ${score.displayScore.toFixed(1)}/10 → target ${target.toFixed(1)}/10.`,
    `Latest run: ${score.latestRunId} resolved ${Math.round(score.passRate * score.instancesTotal)}/${score.instancesTotal} (${(score.passRate * 100).toFixed(0)}%).`,
    `Top failure modes: ${failureSummary}.`,
  ];

  if (hasAnalysis) {
    lines.push(
      `Read .danteforge/swe-bench-failure-analysis.md for the per-pattern fix list. Pick ONE pattern (highest priority that hasn't been addressed yet) and ship the fix in this cycle.`,
    );
  } else {
    lines.push(
      `Pick the largest failure-mode bucket from the list above and ship a fix that reduces its count in the next bench run.`,
    );
  }

  return lines.join('\n');
}

/**
 * Predicate: does this matrix dimension id mean "the SWE-bench dimension"?
 * Accepts the snake_case matrix id and the camelCase variant.
 */
export function isSweBenchDimension(dimId: string): boolean {
  return dimId === 'swe_bench' || dimId === 'sweBench' || dimId === 'swe-bench';
}
