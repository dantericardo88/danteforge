// graded-evaluator.ts — DanteForge's adoption of the frontier loop's CONTINUOUS-EVALUATOR contract.
//
// THE BUG IT FIXES (council 2026-06-22 + the OSS-loop harvest): the build loop drove on a BINARY
// capability_test (exit 0/1). Once it passed there was no gradient, so the builder was skipped and no
// capability was built — dims plateaued below 7 and the court never convened. Every serious self-improvement
// loop on the frontier — OpenEvolve (AlphaEvolve), AIDE, the Darwin Gödel Machine, OpenPipe ART, TextGrad —
// drives on a CONTINUOUS, empirical evaluator instead. This is the same contract:
//
//   evaluate(dim) -> { combinedScore in [0,1], metrics, artifacts }
//
// directly modeled on OpenEvolve's `EvaluationResult(metrics={"combined_score": 0.85, ...}, artifacts={...})`
// and AIDE's `MetricValue{value, maximize}`. The build loop CLIMBS combinedScore; the artifacts ARE the
// verifiable T5 evidence (no separate authoring step); the court reads the SAME score — one bar, end to end.
//
// FAIL-CLOSED invariant: an evaluator that does not emit a parseable continuous score yields ran=false and
// score 0 — NEVER a fabricated pass. A graded axis must be as honest as the binary one it replaces.

import { execFile } from 'node:child_process';

export interface EvaluationResult {
  /** Continuous score in [0,1] — the build loop's climbing target AND the court's read. */
  combinedScore: number;
  /** Named continuous sub-metrics (MAP-Elites-style diversity / diagnosis). */
  metrics: Record<string, number>;
  /** Side-channel evidence — the run's real output. This IS the outcome receipt, not a separate artifact. */
  artifacts: Record<string, string>;
  /** True iff a continuous score was actually parsed. A crash / no-score run is ran=false (fail closed). */
  ran: boolean;
  /** Why ran=false, for the operator (empty when ran=true). */
  reason?: string;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Parse an EvaluationResult from an evaluator command's output. Two accepted shapes (most-specific first):
 *  1. A JSON object line carrying `combined_score` (mirrors OpenEvolve exactly), optionally `metrics` +
 *     `artifacts`. The LAST such line wins, so an evaluator may log freely then print its final verdict.
 *  2. A sentinel line `EVAL_SCORE: 0.65` for simple shell evaluators with no JSON.
 * No parseable score → ran=false, score 0 (fail closed — never a fabricated pass).
 */
export function parseEvaluation(stdout: string): EvaluationResult {
  const lines = stdout.split(/\r?\n/).reverse();
  for (const raw of lines) {
    const t = raw.trim();
    if (!t.startsWith('{') || !t.includes('combined_score')) continue;
    try {
      const j = JSON.parse(t) as { combined_score?: unknown; metrics?: Record<string, number>; artifacts?: Record<string, string> };
      if (typeof j.combined_score === 'number' && Number.isFinite(j.combined_score)) {
        return {
          combinedScore: clamp01(j.combined_score),
          metrics: j.metrics && typeof j.metrics === 'object' ? j.metrics : {},
          artifacts: j.artifacts && typeof j.artifacts === 'object' ? j.artifacts : {},
          ran: true,
        };
      }
    } catch { /* not valid JSON on this line — keep scanning upward */ }
  }
  const m = stdout.match(/EVAL_SCORE:\s*(-?[0-9]*\.?[0-9]+)/);
  if (m) {
    const v = Number.parseFloat(m[1]!);
    if (Number.isFinite(v)) return { combinedScore: clamp01(v), metrics: {}, artifacts: {}, ran: true };
  }
  return { combinedScore: 0, metrics: {}, artifacts: {}, ran: false, reason: 'evaluator produced no parseable combined_score / EVAL_SCORE — treated as 0 (fail closed)' };
}

export interface RunGradedEvaluatorOptions {
  timeoutMs?: number;
  /** Seam: run the command, returning {exitCode, stdout}. Defaults to a real subprocess. */
  _run?: (command: string, cwd: string, timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

async function defaultRun(command: string, cwd: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    execFile(command, { cwd, shell: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ exitCode: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** Run a dimension's graded evaluator command and parse its continuous EvaluationResult. A non-zero exit does
 *  NOT by itself fail the result (an evaluator legitimately reports a low score on a failing run) — only the
 *  ABSENCE of a parseable score does (fail closed). The stderr tail is attached as an artifact for diagnosis. */
export async function runGradedEvaluator(command: string, cwd: string, options: RunGradedEvaluatorOptions = {}): Promise<EvaluationResult> {
  const run = options._run ?? defaultRun;
  const { stdout, stderr } = await run(command, cwd, options.timeoutMs ?? 120_000);
  const result = parseEvaluation(stdout);
  if (stderr.trim()) result.artifacts = { ...result.artifacts, stderr: stderr.slice(-4000) };
  return result;
}

/** Selection comparison (AIDE's MetricValue.__gt__): is `candidate` a strictly BETTER result than `incumbent`?
 *  A candidate that did not run is never better. This is what lets the build loop KEEP only improving attempts. */
export function isBetter(candidate: EvaluationResult, incumbent: EvaluationResult): boolean {
  if (!candidate.ran) return false;
  if (!incumbent.ran) return true;
  return candidate.combinedScore > incumbent.combinedScore;
}

/** The build loop's dispatch decision: keep climbing (dispatch the builder) while the score is below target.
 *  Unlike the binary gate, this stays true at a PASSING-but-imperfect score, so the loop never plateaus until
 *  the real frontier bar is met. */
export function shouldClimb(current: EvaluationResult, target: number): boolean {
  return !current.ran || current.combinedScore < target;
}
