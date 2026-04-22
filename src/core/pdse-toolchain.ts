// PDSE Toolchain Grounding — runs real tsc/test/lint and adjusts PDSE dimension scores
// All I/O is injectable for testability. All commands are best-effort and never throw.
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScoreResult } from './pdse.js';
import type { ScoredArtifact } from './pdse-config.js';

const execAsync = promisify(exec);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolchainMetrics {
  tscErrors: number;
  testsPassing: number;
  testsFailing: number;
  lintErrors: number;
  coveragePct: number | null;
  gatherDurationMs: number;
}

export interface GatherToolchainMetricsOptions {
  /** Timeout per command in ms. Default: 30_000 */
  timeoutMs?: number;
  /** Injection seam — override shell execution for tests */
  _runCommand?: (cmd: string, cwd: string) => Promise<string>;
}

// ── Default command runner ────────────────────────────────────────────────────

async function defaultRunCommand(cmd: string, cwd: string, timeoutMs: number): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: timeoutMs });
    return stdout + stderr;
  } catch (err: unknown) {
    // exec rejects on non-zero exit — capture stdout+stderr from the error object
    if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
      return String((err as { stdout: unknown }).stdout ?? '') +
             String((err as { stderr: unknown }).stderr ?? '');
    }
    return '';
  }
}

// ── Parsers ───────────────────────────────────────────────────────────────────

/** Parse TypeScript error count from `tsc --noEmit` output */
export function parseTscErrors(output: string): number {
  // "Found N error(s)" — TypeScript summary line
  const match = output.match(/Found (\d+) error/);
  if (match) return parseInt(match[1], 10);
  // Count individual "error TS" lines as fallback
  const lines = output.match(/error TS\d+:/g);
  return lines ? lines.length : 0;
}

/** Parse passing/failing test counts from Node test runner or Mocha */
export function parseTestCounts(output: string): { passing: number; failing: number } {
  // Node.js built-in test runner: "# pass N" / "# fail N"
  const nodePass = output.match(/^ℹ pass (\d+)/m) ?? output.match(/# pass (\d+)/m);
  const nodeFail = output.match(/^ℹ fail (\d+)/m) ?? output.match(/# fail (\d+)/m);
  if (nodePass || nodeFail) {
    return {
      passing: nodePass ? parseInt(nodePass[1], 10) : 0,
      failing: nodeFail ? parseInt(nodeFail[1], 10) : 0,
    };
  }
  // Mocha: "N passing" / "N failing"
  const mochaPass = output.match(/(\d+) passing/);
  const mochaFail = output.match(/(\d+) failing/);
  return {
    passing: mochaPass ? parseInt(mochaPass[1], 10) : 0,
    failing: mochaFail ? parseInt(mochaFail[1], 10) : 0,
  };
}

/** Parse ESLint problem count from lint output */
export function parseLintErrors(output: string): number {
  // ESLint summary: "N problems (M errors, K warnings)"
  const match = output.match(/(\d+) problem/);
  if (match) return parseInt(match[1], 10);
  // Count individual error lines as fallback
  const errLines = output.match(/ error /g);
  return errLines ? errLines.length : 0;
}

/** Try to extract a coverage percentage from test output */
export function parseCoverage(output: string): number | null {
  // c8/Istanbul: "All files | N%" or "Lines    : N%"
  const match = output.match(/Lines\s*[:|]\s*([\d.]+)%/) ??
                output.match(/All files\s*\|[^|]*\|\s*([\d.]+)/) ??
                output.match(/coverage[:\s]+([\d.]+)%/i);
  if (match) return parseFloat(match[1]);
  return null;
}

// ── Main gatherer ─────────────────────────────────────────────────────────────

/**
 * Run real toolchain commands and return structured metrics.
 * All commands are best-effort — a single failure returns zeroed metrics for
 * that tool without affecting others.
 */
export async function gatherToolchainMetrics(
  cwd: string,
  opts?: GatherToolchainMetricsOptions,
): Promise<ToolchainMetrics> {
  const timeout = opts?.timeoutMs ?? 30_000;
  const run = opts?._runCommand
    ? (cmd: string) => opts._runCommand!(cmd, cwd)
    : (cmd: string) => defaultRunCommand(cmd, cwd, timeout);

  const start = Date.now();

  let tscErrors = 0;
  let testsPassing = 0;
  let testsFailing = 0;
  let lintErrors = 0;
  let coveragePct: number | null = null;

  // TypeScript check
  try {
    const tscOut = await run('npx tsc --noEmit 2>&1');
    tscErrors = parseTscErrors(tscOut);
  } catch { /* best-effort */ }

  // Test run
  try {
    const testOut = await run('npm test 2>&1');
    const counts = parseTestCounts(testOut);
    testsPassing = counts.passing;
    testsFailing = counts.failing;
    coveragePct = parseCoverage(testOut);
  } catch { /* best-effort */ }

  // Lint
  try {
    const lintOut = await run('npm run lint 2>&1');
    lintErrors = parseLintErrors(lintOut);
  } catch { /* best-effort */ }

  return {
    tscErrors,
    testsPassing,
    testsFailing,
    lintErrors,
    coveragePct,
    gatherDurationMs: Date.now() - start,
  };
}

// ── Score adjuster ────────────────────────────────────────────────────────────

/**
 * Apply toolchain metrics to PDSE scores as post-processing adjustments.
 * Pure function — no I/O.
 *
 * Deduction rules:
 *   freshness   -= min(8, tscErrors * 2)    — 4+ tsc errors removes full 8pt cap
 *   testability -= min(10, testsFailing * 2) — 5+ failures removes full 10pt cap
 *   clarity     -= min(5, lintErrors)        — 5+ lint errors removes 5pt cap
 */
export function applyToolchainToScores(
  scores: Record<ScoredArtifact, ScoreResult>,
  metrics: ToolchainMetrics,
): Record<ScoredArtifact, ScoreResult> {
  const freshnessDeduction = Math.min(8, metrics.tscErrors * 2);
  const testabilityDeduction = Math.min(10, metrics.testsFailing * 2);
  const clarityDeduction = Math.min(5, metrics.lintErrors);

  if (freshnessDeduction === 0 && testabilityDeduction === 0 && clarityDeduction === 0) {
    return scores; // No adjustment needed — fast path
  }

  const adjusted: Record<string, ScoreResult> = {};
  for (const [artifact, result] of Object.entries(scores)) {
    const dims = { ...result.dimensions };
    dims.freshness = Math.max(0, dims.freshness - freshnessDeduction);
    dims.testability = Math.max(0, dims.testability - testabilityDeduction);
    dims.clarity = Math.max(0, dims.clarity - clarityDeduction);

    const newScore = Object.values(dims).reduce((s, v) => s + v, 0);

    // Recompute autoforgeDecision based on adjusted score
    const newDecision = newScore >= 90 ? 'advance' :
                        newScore >= 75 ? 'warn' :
                        newScore >= 50 ? 'pause' : 'blocked';

    adjusted[artifact] = {
      ...result,
      dimensions: dims,
      score: newScore,
      autoforgeDecision: newDecision,
    };
  }
  return adjusted as Record<ScoredArtifact, ScoreResult>;
}
