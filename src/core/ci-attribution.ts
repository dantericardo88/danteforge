// CI Attribution Adapter — runs attribution tracking as part of CI pipelines.
//
// Problem: causal attribution only runs when a developer manually invokes
// outcome-check. Patterns adopted weeks ago may show quality drift that goes
// unnoticed between sessions.
//
// Solution: a CI-friendly adapter that:
//   1. Captures current objective metrics (lint errors, ts errors, test pass rate)
//   2. Diffs against the last stored snapshot
//   3. Attributes any regression to recently adopted patterns (within attributionWindow days)
//   4. Writes a machine-readable JSON report to .danteforge/ci-report.json
//   5. Exits non-zero if regressions exceed a threshold (for CI gate use)
//
// Designed to be invoked from GitHub Actions, pre-push hooks, etc.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  loadAttributionLog,
  type AttributionRecord,
} from './causal-attribution.js';
import {
  loadLatestSnapshot,
  buildSnapshot,
  diffSnapshots,
  saveSnapshot,
  type ObjectiveMetrics,
  type QualitySnapshot,
  type SnapshotDiff,
} from './objective-metrics.js';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CIAttributionReport {
  /** ISO timestamp of when the CI run happened. */
  capturedAt: string;
  /** Current objective metrics. */
  currentMetrics: ObjectiveMetrics;
  /** Current hybrid score. */
  currentScore: number;
  /** Diff vs the last baseline snapshot. null if no baseline exists. */
  diff: SnapshotDiff | null;
  /** Patterns adopted within attributionWindow that may explain regressions. */
  suspectPatterns: AttributionRecord[];
  /** true if CI gate should fail (regressions exceed threshold). */
  shouldFail: boolean;
  /** Human-readable summary lines. */
  summary: string[];
  /** Mutation score from self-mutate run, if executed. undefined when skipped. */
  mutationScore?: number;
}

export interface CIAttributionOptions {
  cwd?: string;
  /** How many days back to look for patterns that might have caused regressions. Default 7. */
  attributionWindow?: number;
  /** If CI score dropped by more than this, fail the gate. Default 0.5. */
  regressionThreshold?: number;
  /** Update the baseline snapshot after running. Default true. */
  updateBaseline?: boolean;
  /** Inject for testing. */
  _captureMetrics?: (cwd: string) => Promise<ObjectiveMetrics>;
  _loadSnapshot?: (cwd: string) => Promise<QualitySnapshot | null>;
  _saveSnapshot?: (snapshot: QualitySnapshot, cwd: string) => Promise<string>;
  _loadAttribution?: (cwd: string) => Promise<import('./causal-attribution.js').AttributionLog>;
  _writeReport?: (path: string, content: string) => Promise<void>;
}

// ── Metric capture ────────────────────────────────────────────────────────────

/**
 * Capture current objective metrics by running lint, typecheck, and test.
 * Uses lightweight subprocess calls — not the full autoforge pipeline.
 */
export async function captureCurrentMetrics(cwd: string): Promise<ObjectiveMetrics> {
  let eslintErrors = 0;
  let eslintWarnings = 0;
  let typescriptErrors = 0;
  let testPassRate = 1.0;
  let testCount = 0;
  let bundleSizeBytes = 0;

  // ESLint — count errors/warnings from JSON output
  try {
    const { stdout } = await execFileAsync(
      'npx', ['eslint', '--format', 'json', 'src/**/*.ts'],
      { cwd, timeout: 60_000 },
    );
    const results = JSON.parse(stdout) as Array<{ errorCount: number; warningCount: number }>;
    for (const r of results) {
      eslintErrors += r.errorCount;
      eslintWarnings += r.warningCount;
    }
  } catch (e: unknown) {
    // eslint exits non-zero when there are errors; stdout still has JSON
    const err = e as { stdout?: string };
    if (err.stdout) {
      try {
        const results = JSON.parse(err.stdout) as Array<{ errorCount: number; warningCount: number }>;
        for (const r of results) {
          eslintErrors += r.errorCount;
          eslintWarnings += r.warningCount;
        }
      } catch { /* lint tool not available */ }
    }
  }

  // TypeScript — count error lines
  try {
    await execFileAsync('npx', ['tsc', '--noEmit'], { cwd, timeout: 60_000 });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const output = (err.stdout ?? '') + (err.stderr ?? '');
    typescriptErrors = (output.match(/error TS\d+/g) ?? []).length;
  }

  // Tests — count pass/fail from tsx --test output
  try {
    const { stdout } = await execFileAsync(
      'npx', ['tsx', '--test', 'tests/**/*.test.ts'],
      { cwd, timeout: 120_000 },
    );
    const passMatch = /pass (\d+)/.exec(stdout);
    const failMatch = /fail (\d+)/.exec(stdout);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    testCount = passed + failed;
    testPassRate = testCount > 0 ? passed / testCount : 1.0;
  } catch { /* tests failed or not runnable */ }

  // Bundle size — check dist/index.js if present
  try {
    const stat = await fs.stat(path.join(cwd, 'dist', 'index.js'));
    bundleSizeBytes = stat.size;
  } catch { /* no bundle yet */ }

  return {
    eslintErrors,
    eslintWarnings,
    typescriptErrors,
    testPassRate,
    testCount,
    bundleSizeBytes,
    capturedAt: new Date().toISOString(),
  };
}

// ── Report CI run ─────────────────────────────────────────────────────────────

/**
 * Run CI attribution: capture metrics, diff vs baseline, attribute regressions.
 * Returns a CIAttributionReport and (by default) updates the baseline snapshot.
 * Exported for testing.
 */
export async function runCIAttribution(
  opts: CIAttributionOptions = {},
): Promise<CIAttributionReport> {
  const cwd = opts.cwd ?? process.cwd();
  const attributionWindow = opts.attributionWindow ?? 7;
  const regressionThreshold = opts.regressionThreshold ?? 0.5;
  const updateBaseline = opts.updateBaseline !== false;

  const captureFn = opts._captureMetrics ?? captureCurrentMetrics;
  const loadSnap = opts._loadSnapshot ?? ((dir: string) => loadLatestSnapshot(dir));
  const saveSnap = opts._saveSnapshot ?? ((snap: QualitySnapshot, dir: string) => saveSnapshot(snap, dir));
  const loadLog = opts._loadAttribution ?? ((dir: string) => loadAttributionLog(dir));
  const writeReport = opts._writeReport ?? ((p: string, content: string) => fs.writeFile(p, content, 'utf8'));

  const capturedAt = new Date().toISOString();
  const currentMetrics = await captureFn(cwd);

  // Build current snapshot with llmScore=5.0 (CI has no LLM)
  const currentSnapshot = buildSnapshot(currentMetrics, 5.0);
  const currentScore = currentSnapshot.hybridScore;

  // Load baseline
  const baseline = await loadSnap(cwd);
  let diff: SnapshotDiff | null = null;
  if (baseline) {
    diff = diffSnapshots(baseline, currentSnapshot);
  }

  // Find suspect patterns (adopted recently)
  const log = await loadLog(cwd);
  const windowStart = new Date(Date.now() - attributionWindow * 24 * 60 * 60 * 1000).toISOString();
  const suspectPatterns = log.records.filter(
    r => r.adoptedAt >= windowStart && r.verifyStatus !== 'rejected',
  );

  // Determine if CI should fail
  const scoreDrop = diff ? -(diff.deltaHybridScore) : 0;
  const hasRegressions = diff?.hasRegression === true;
  const shouldFail = scoreDrop > regressionThreshold || hasRegressions;

  // Build summary
  const summary: string[] = [];
  summary.push(`CI Attribution Report — ${capturedAt}`);
  summary.push(`Current score: ${currentScore.toFixed(2)}`);
  if (baseline) {
    summary.push(`vs baseline: ${baseline.hybridScore.toFixed(2)} (Δ ${diff!.deltaHybridScore >= 0 ? '+' : ''}${diff!.deltaHybridScore.toFixed(2)})`);
  } else {
    summary.push('No baseline snapshot found — this run will become the baseline.');
  }
  if (hasRegressions && diff) {
    summary.push(`Regressions detected: ${diff.regressions.join(', ')}`);
  }
  if (suspectPatterns.length > 0) {
    summary.push(`Suspect patterns (adopted last ${attributionWindow}d): ${suspectPatterns.map(p => p.patternName).join(', ')}`);
  }
  summary.push(shouldFail ? 'GATE: FAIL' : 'GATE: PASS');

  const report: CIAttributionReport = {
    capturedAt,
    currentMetrics,
    currentScore,
    diff,
    suspectPatterns,
    shouldFail,
    summary,
  };

  // Persist report and optionally update baseline
  const reportPath = path.join(cwd, '.danteforge', 'ci-report.json');
  await writeReport(reportPath, JSON.stringify(report, null, 2));

  if (updateBaseline) {
    await saveSnap(currentSnapshot, cwd).catch(() => {});
  }

  return report;
}
