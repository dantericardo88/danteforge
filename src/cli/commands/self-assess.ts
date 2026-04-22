// Self-Assess — DanteForge running its own quality measurement on itself.
// Captures objective metrics (eslint errors, TS errors, test pass rate, bundle size),
// writes a baseline snapshot, and diffs against the previous baseline to surface
// whether DanteForge's own quality is improving over time.
//
// This closes the "self-validation" gap: the system that improves others must
// also improve itself, with machine-verifiable evidence — not LLM self-praise.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import {
  captureObjectiveMetrics,
  buildSnapshot,
  diffSnapshots,
  loadLatestSnapshot,
  saveSnapshot,
  type ObjectiveMetrics,
  type QualitySnapshot,
  type SnapshotDiff,
  type ObjectiveMetricsOptions,
} from '../../core/objective-metrics.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelfAssessOptions {
  cwd?: string;
  /** LLM score to blend with objective score. Default 7.0 (neutral). */
  llmScore?: number;
  /** Compare against previous baseline and report diff. Default true. */
  compareBaseline?: boolean;
  /** Inject for testing — replaces captureObjectiveMetrics */
  _captureMetrics?: (opts: ObjectiveMetricsOptions) => Promise<ObjectiveMetrics>;
  /** Inject for testing — replaces loadLatestSnapshot */
  _loadBaseline?: (cwd?: string) => Promise<QualitySnapshot | null>;
  /** Inject for testing — replaces saveSnapshot */
  _saveSnapshot?: (snapshot: QualitySnapshot, cwd?: string) => Promise<string>;
}

export interface SelfAssessResult {
  current: QualitySnapshot;
  previous: QualitySnapshot | null;
  diff: SnapshotDiff | null;
  snapshotPath: string;
  /** true if hybrid score improved vs previous baseline */
  improved: boolean;
  summary: string;
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function runSelfAssess(opts: SelfAssessOptions = {}): Promise<SelfAssessResult> {
  const cwd = opts.cwd ?? process.cwd();
  const llmScore = opts.llmScore ?? 7.0;
  const compareBaseline = opts.compareBaseline ?? true;

  const captureMetrics = opts._captureMetrics ?? captureObjectiveMetrics;
  const loadBaseline = opts._loadBaseline ?? loadLatestSnapshot;
  const saveFn = opts._saveSnapshot ?? saveSnapshot;

  logger.info('[self-assess] Capturing objective quality metrics for DanteForge...');

  // Capture current objective metrics
  const metrics = await captureMetrics({ cwd });
  const current = buildSnapshot(metrics, llmScore);

  logger.info(`[self-assess] ESLint errors: ${metrics.eslintErrors} | TS errors: ${metrics.typescriptErrors} | Test pass rate: ${metrics.testPassRate >= 0 ? (metrics.testPassRate * 100).toFixed(1) + '%' : 'N/A'} | Bundle: ${(metrics.bundleSizeBytes / 1024).toFixed(0)} KB`);
  logger.info(`[self-assess] Objective score: ${current.objectiveScore.toFixed(2)}/10 | Hybrid score: ${current.hybridScore.toFixed(2)}/10`);

  // Load previous baseline for comparison
  let previous: QualitySnapshot | null = null;
  let diff: SnapshotDiff | null = null;

  if (compareBaseline) {
    previous = await loadBaseline(cwd).catch(() => null);
    if (previous) {
      diff = diffSnapshots(previous, current);
      if (diff.hasRegression) {
        logger.warn('[self-assess] REGRESSIONS detected vs previous baseline:');
        for (const r of diff.regressions) {
          logger.warn(`  - ${r}`);
        }
      } else {
        logger.success('[self-assess] No regressions vs previous baseline.');
      }
      logger.info(`[self-assess] Hybrid score delta: ${diff.deltaHybridScore >= 0 ? '+' : ''}${diff.deltaHybridScore.toFixed(2)}`);
    } else {
      logger.info('[self-assess] No previous baseline found — this run establishes the baseline.');
    }
  }

  // Persist snapshot
  const snapshotPath = await saveFn(current, cwd);
  logger.info(`[self-assess] Snapshot saved: ${path.relative(cwd, snapshotPath)}`);

  const improved = previous !== null && current.hybridScore > previous.hybridScore;

  const summary = buildSummary(current, previous, diff);
  logger.info(summary);

  return { current, previous, diff, snapshotPath, improved, summary };
}

// ── Report ────────────────────────────────────────────────────────────────────

function buildSummary(
  current: QualitySnapshot,
  previous: QualitySnapshot | null,
  diff: SnapshotDiff | null,
): string {
  const lines: string[] = [
    '── DanteForge Self-Assessment ────────────────────────────────',
    `  Objective score : ${current.objectiveScore.toFixed(2)}/10`,
    `  Hybrid score    : ${current.hybridScore.toFixed(2)}/10`,
    `  ESLint errors   : ${current.metrics.eslintErrors}`,
    `  TypeScript errs : ${current.metrics.typescriptErrors}`,
    `  Test pass rate  : ${current.metrics.testPassRate >= 0 ? (current.metrics.testPassRate * 100).toFixed(1) + '%' : 'N/A'} (${current.metrics.testCount} tests)`,
    `  Bundle size     : ${(current.metrics.bundleSizeBytes / 1024).toFixed(0)} KB`,
  ];

  if (diff && previous) {
    lines.push('');
    lines.push('  vs previous baseline:');
    lines.push(`    Hybrid score  : ${diff.deltaHybridScore >= 0 ? '+' : ''}${diff.deltaHybridScore.toFixed(2)}`);
    lines.push(`    ESLint errors : ${diff.deltaEslintErrors >= 0 ? '+' : ''}${diff.deltaEslintErrors}`);
    lines.push(`    TS errors     : ${diff.deltaTypescriptErrors >= 0 ? '+' : ''}${diff.deltaTypescriptErrors}`);
    if (diff.hasRegression) {
      lines.push(`    ⚠ Regressions : ${diff.regressions.join(', ')}`);
    } else {
      lines.push('    ✓ No regressions');
    }
  } else if (!previous) {
    lines.push('  (first baseline — no comparison available)');
  }

  lines.push('──────────────────────────────────────────────────────────────');
  return lines.join('\n');
}
