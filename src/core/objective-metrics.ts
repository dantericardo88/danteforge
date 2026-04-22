// Objective Metrics — machine-verifiable quality signals that cannot be faked by LLM self-assessment.
// Inspired by:
//   - danger/danger-js: causal attribution DSL at change boundaries
//   - relative-ci/bundle-stats: snapshot-diff model for structured regression reports
//   - bencherdev/bencher: statistical baseline tracking with threshold alerting
//
// The key insight: LLM-scored quality is a conflict of interest (the scorer improves what it scores).
// Objective metrics ground the score in signals the LLM cannot retroactively influence:
//   eslint error count, TypeScript error count, test pass rate, bundle size.
// Hybrid score = 0.6 × objective + 0.4 × LLM — gives objective signals majority weight.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ObjectiveMetrics {
  eslintErrors: number;
  eslintWarnings: number;
  typescriptErrors: number;
  /** Fraction of tests passing: passCount / totalCount. -1 if no test results available. */
  testPassRate: number;
  testCount: number;
  /** Bytes of primary build output (dist/index.js). 0 if not found. */
  bundleSizeBytes: number;
  capturedAt: string;
}

export interface QualitySnapshot {
  metrics: ObjectiveMetrics;
  /** Normalised score 0-10. Lower errors = higher score. */
  objectiveScore: number;
  /** LLM-assigned score passed in externally (0-10). */
  llmScore: number;
  /** Weighted hybrid: 0.6 × objective + 0.4 × llm. */
  hybridScore: number;
}

export interface SnapshotDiff {
  deltaEslintErrors: number;
  deltaTypescriptErrors: number;
  deltaTestPassRate: number;      // positive = improvement
  deltaBundleSizeBytes: number;   // negative = improvement (smaller)
  deltaObjectiveScore: number;    // positive = improvement
  deltaHybridScore: number;
  /** true when any metric regressed beyond its threshold */
  hasRegression: boolean;
  regressions: string[];
}

export interface ObjectiveMetricsOptions {
  cwd?: string;
  /** Inject for testing — return raw stdout from eslint --format json */
  _runLint?: (cwd: string) => Promise<string>;
  /** Inject for testing — return raw stderr from tsc --noEmit */
  _runTypecheck?: (cwd: string) => Promise<string>;
  /** Inject for testing — return { passed, total } */
  _runTests?: (cwd: string) => Promise<{ passed: number; total: number }>;
  /** Inject for testing — return bytes */
  _getBundleSize?: (cwd: string) => Promise<number>;
}

// ── Metric capture ────────────────────────────────────────────────────────────

async function runLintDefault(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'npx',
      ['eslint', '.', '--format', 'json', '--max-warnings', '99999'],
      { cwd, timeout: 60_000 },
    );
    return stdout;
  } catch (err: any) {
    // eslint exits non-zero when there are errors — stdout still has JSON
    return (err as { stdout?: string }).stdout ?? '[]';
  }
}

async function runTypecheckDefault(cwd: string): Promise<string> {
  try {
    await execFileAsync('npx', ['tsc', '--noEmit'], { cwd, timeout: 120_000 });
    return '';
  } catch (err: any) {
    return (err as { stderr?: string; stdout?: string }).stderr
      ?? (err as { stdout?: string }).stdout
      ?? '';
  }
}

async function runTestsDefault(cwd: string): Promise<{ passed: number; total: number }> {
  try {
    const { stdout } = await execFileAsync(
      'npx',
      ['tsx', '--test', 'tests/**/*.test.ts'],
      { cwd, timeout: 180_000 },
    );
    const passMatch = /pass\s+(\d+)/.exec(stdout);
    const totalMatch = /tests\s+(\d+)/.exec(stdout);
    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    return { passed, total };
  } catch {
    return { passed: 0, total: 0 };
  }
}

async function getBundleSizeDefault(cwd: string): Promise<number> {
  try {
    const candidates = ['dist/index.js', 'dist/index.cjs', 'out/index.js'];
    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(path.join(cwd, candidate));
        return stat.size;
      } catch { /* try next */ }
    }
    return 0;
  } catch {
    return 0;
  }
}

function parseLintOutput(raw: string): { errors: number; warnings: number } {
  try {
    const results = JSON.parse(raw) as Array<{ errorCount: number; warningCount: number }>;
    const errors = results.reduce((sum, r) => sum + (r.errorCount ?? 0), 0);
    const warnings = results.reduce((sum, r) => sum + (r.warningCount ?? 0), 0);
    return { errors, warnings };
  } catch {
    return { errors: 0, warnings: 0 };
  }
}

function parseTypecheckOutput(raw: string): number {
  if (!raw.trim()) return 0;
  // Count lines matching "error TS\d+:"
  const matches = raw.match(/error TS\d+:/g);
  return matches ? matches.length : 0;
}

/**
 * Capture all objective quality metrics for the project at `cwd`.
 * All sub-commands are injected for testing — production uses real tool invocations.
 */
export async function captureObjectiveMetrics(
  opts: ObjectiveMetricsOptions = {},
): Promise<ObjectiveMetrics> {
  const cwd = opts.cwd ?? process.cwd();
  const runLint = opts._runLint ?? runLintDefault;
  const runTypecheck = opts._runTypecheck ?? runTypecheckDefault;
  const runTests = opts._runTests ?? runTestsDefault;
  const getBundleSize = opts._getBundleSize ?? getBundleSizeDefault;

  const [lintRaw, tscRaw, testResult, bundleSize] = await Promise.all([
    runLint(cwd).catch(() => '[]'),
    runTypecheck(cwd).catch(() => ''),
    runTests(cwd).catch(() => ({ passed: 0, total: 0 })),
    getBundleSize(cwd).catch(() => 0),
  ]);

  const { errors: eslintErrors, warnings: eslintWarnings } = parseLintOutput(lintRaw);
  const typescriptErrors = parseTypecheckOutput(tscRaw);
  const testPassRate = testResult.total > 0
    ? testResult.passed / testResult.total
    : -1;

  return {
    eslintErrors,
    eslintWarnings,
    typescriptErrors,
    testPassRate,
    testCount: testResult.total,
    bundleSizeBytes: bundleSize,
    capturedAt: new Date().toISOString(),
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Convert raw objective metrics into a normalised 0-10 score.
 * Scoring philosophy (from bencher/danger-js patterns):
 *   - Start at 10.0
 *   - Deduct for each error/failure type, capped so a single bad metric can't crush the score
 *   - Test pass rate failure is the most severe penalty
 */
export function scoreObjectiveMetrics(metrics: ObjectiveMetrics): number {
  let score = 10.0;

  // ESLint errors: -0.3 per error, max -2.0 deduction
  score -= Math.min(2.0, metrics.eslintErrors * 0.3);

  // TypeScript errors: -0.5 per error, max -2.5 deduction
  score -= Math.min(2.5, metrics.typescriptErrors * 0.5);

  // Test pass rate: critical — 0% passing → -4.0, 100% → 0
  if (metrics.testPassRate >= 0) {
    score -= (1 - metrics.testPassRate) * 4.0;
  }

  // Bundle size: gentle penalty only if very large (> 10 MB)
  if (metrics.bundleSizeBytes > 10_000_000) {
    score -= Math.min(0.5, (metrics.bundleSizeBytes - 10_000_000) / 10_000_000);
  }

  return Math.max(0, Math.min(10, score));
}

/**
 * Blend objective and LLM scores.
 * Objective gets majority weight (0.6) because it cannot be gamed by the scoring LLM.
 * Pattern derived from danger/danger-js: trust machine signals over perception.
 */
export function hybridScore(objectiveScore: number, llmScore: number): number {
  return Math.round((0.6 * objectiveScore + 0.4 * llmScore) * 100) / 100;
}

/**
 * Build a full QualitySnapshot from metrics and an LLM score.
 */
export function buildSnapshot(metrics: ObjectiveMetrics, llmScore: number): QualitySnapshot {
  const objectiveScore = scoreObjectiveMetrics(metrics);
  return {
    metrics,
    objectiveScore,
    llmScore,
    hybridScore: hybridScore(objectiveScore, llmScore),
  };
}

// ── Snapshot diff (bundle-stats pattern) ─────────────────────────────────────

/**
 * Diff two snapshots to produce a structured regression report.
 * Positive delta = improvement. Negative delta = regression.
 * Pattern from relative-ci/bundle-stats: walk both blobs, emit { baseline, current, diff }.
 */
export function diffSnapshots(
  baseline: QualitySnapshot,
  current: QualitySnapshot,
  thresholds = { errorIncrease: 1, testPassRateDrop: 0.01, bundleSizeIncrease: 50_000 },
): SnapshotDiff {
  const deltaEslintErrors = current.metrics.eslintErrors - baseline.metrics.eslintErrors;
  const deltaTypescriptErrors = current.metrics.typescriptErrors - baseline.metrics.typescriptErrors;
  const deltaTestPassRate = current.metrics.testPassRate - baseline.metrics.testPassRate;
  const deltaBundleSizeBytes = current.metrics.bundleSizeBytes - baseline.metrics.bundleSizeBytes;
  const deltaObjectiveScore = current.objectiveScore - baseline.objectiveScore;
  const deltaHybridScore = current.hybridScore - baseline.hybridScore;

  const regressions: string[] = [];
  if (deltaEslintErrors > thresholds.errorIncrease) {
    regressions.push(`ESLint errors +${deltaEslintErrors}`);
  }
  if (deltaTypescriptErrors > thresholds.errorIncrease) {
    regressions.push(`TypeScript errors +${deltaTypescriptErrors}`);
  }
  if (deltaTestPassRate < -thresholds.testPassRateDrop) {
    regressions.push(`Test pass rate ${(deltaTestPassRate * 100).toFixed(1)}%`);
  }
  if (deltaBundleSizeBytes > thresholds.bundleSizeIncrease) {
    regressions.push(`Bundle size +${(deltaBundleSizeBytes / 1024).toFixed(0)} KB`);
  }

  return {
    deltaEslintErrors,
    deltaTypescriptErrors,
    deltaTestPassRate,
    deltaBundleSizeBytes,
    deltaObjectiveScore,
    deltaHybridScore,
    hasRegression: regressions.length > 0,
    regressions,
  };
}

// ── Snapshot persistence ──────────────────────────────────────────────────────

export function getSnapshotDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', 'quality-snapshots');
}

export async function saveSnapshot(
  snapshot: QualitySnapshot,
  cwd?: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<string> {
  const dir = getSnapshotDir(cwd);
  const filename = `snapshot-${Date.now()}.json`;
  const filePath = path.join(dir, filename);
  const write = _fsWrite ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  await write(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

export async function loadLatestSnapshot(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
  _listDir?: (p: string) => Promise<string[]>,
): Promise<QualitySnapshot | null> {
  const dir = getSnapshotDir(cwd);
  const listDir = _listDir ?? (async (p: string) => {
    try { return await fs.readdir(p); } catch { return []; }
  });
  const read = _fsRead ?? ((p: string) => fs.readFile(p, 'utf8'));

  const files = (await listDir(dir))
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    const raw = await read(path.join(dir, files[0]));
    return JSON.parse(raw) as QualitySnapshot;
  } catch {
    return null;
  }
}
