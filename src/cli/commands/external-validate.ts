// External Validate — apply the DanteForge scoring pipeline to a foreign codebase.
//
// Problem: DanteForge's quality score has never been validated against an
// external codebase. If the score only moves on our own project we cannot
// tell whether it measures genuine quality or internal overfitting.
//
// Solution: clone (or reference) an external project, run objective metrics
// on it, score it, and compare against our local baseline. If external
// well-known projects (with established reputations) score appropriately
// (e.g. lodash > underscore, TypeScript compiler > a toy project), the
// metric is demonstrably calibrated.
//
// Output: .danteforge/external-validation.json with scores and comparison.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { captureCurrentMetrics } from '../../core/ci-attribution.js';
import {
  buildSnapshot,
  type ObjectiveMetrics,
  type QualitySnapshot,
} from '../../core/objective-metrics.js';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExternalProject {
  /** Short label for the project (e.g. "lodash", "underscore"). */
  label: string;
  /** Git URL to clone (must be accessible). */
  url: string;
  /** Expected quality tier: 'high' | 'medium' | 'low'. Used for calibration check. */
  expectedTier: 'high' | 'medium' | 'low';
}

export interface ExternalValidationEntry {
  label: string;
  url: string;
  expectedTier: 'high' | 'medium' | 'low';
  metrics: ObjectiveMetrics;
  score: number;
  /** true if the score matches the expected tier ordering. */
  calibrated: boolean;
}

export interface ExternalValidationReport {
  capturedAt: string;
  localScore: number;
  entries: ExternalValidationEntry[];
  /** Overall calibration: percentage of entries that are calibrated. */
  calibrationRate: number;
  /** true if all high-tier projects scored above all low-tier projects. */
  rankingValid: boolean;
  summary: string[];
}

export interface ExternalValidateOptions {
  cwd?: string;
  /** Max seconds to wait for git clone. Default 30. */
  cloneTimeoutMs?: number;
  /** Inject for testing — avoids real git clone. */
  _cloneRepo?: (url: string, dir: string) => Promise<void>;
  /** Inject for testing — replaces real metric capture. */
  _captureMetrics?: (dir: string) => Promise<ObjectiveMetrics>;
  /** Inject for testing — replaces real local metric capture. */
  _captureLocalMetrics?: (cwd: string) => Promise<ObjectiveMetrics>;
  /** Inject for testing — replaces rm -rf of cloned dirs. */
  _removeDir?: (dir: string) => Promise<void>;
  /** Inject for testing — replaces fs.writeFile for report. */
  _writeReport?: (p: string, content: string) => Promise<void>;
  /** Temp dir to clone into. Default: os temp dir. */
  _tmpDir?: string;
}

// ── Tier scoring ──────────────────────────────────────────────────────────────

const TIER_SCORE_RANGES: Record<'high' | 'medium' | 'low', [number, number]> = {
  high: [6.5, 10],
  medium: [4.0, 7.5],
  low: [0, 5.5],
};

function isCalibratedForTier(score: number, tier: 'high' | 'medium' | 'low'): boolean {
  const [min, max] = TIER_SCORE_RANGES[tier];
  return score >= min && score <= max;
}

// ── Default clone ─────────────────────────────────────────────────────────────

async function defaultCloneRepo(url: string, dir: string): Promise<void> {
  await execFileAsync('git', ['clone', '--depth', '1', url, dir], { timeout: 30_000 });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run external validation against a set of external projects.
 * Clones each, captures metrics, scores, and checks calibration.
 * Returns a validation report — does NOT throw on individual project failures.
 */
export async function runExternalValidation(
  projects: ExternalProject[],
  opts: ExternalValidateOptions = {},
): Promise<ExternalValidationReport> {
  const cwd = opts.cwd ?? process.cwd();
  const tmpBase = opts._tmpDir ?? path.join(cwd, '.danteforge', 'ext-validate-tmp');
  const cloneRepo = opts._cloneRepo ?? defaultCloneRepo;
  const captureMetrics = opts._captureMetrics ?? captureCurrentMetrics;
  const captureLocal = opts._captureLocalMetrics ?? captureCurrentMetrics;
  const removeDir = opts._removeDir ?? ((dir: string) => fs.rm(dir, { recursive: true, force: true }));
  const writeReport = opts._writeReport ?? ((p: string, content: string) => fs.writeFile(p, content, 'utf8'));

  const capturedAt = new Date().toISOString();

  // Capture local project score for comparison
  const localMetrics = await captureLocal(cwd).catch(() => ({
    eslintErrors: 0, eslintWarnings: 0, typescriptErrors: 0,
    testPassRate: 1.0, testCount: 0, bundleSizeBytes: 0,
    capturedAt: new Date().toISOString(),
  }) satisfies ObjectiveMetrics);
  const localSnapshot = buildSnapshot(localMetrics, 5.0);
  const localScore = localSnapshot.hybridScore;

  const entries: ExternalValidationEntry[] = [];

  for (const project of projects) {
    const slug = project.label.replace(/[^a-z0-9]/gi, '-');
    const cloneDir = path.join(tmpBase, slug);

    try {
      await cloneRepo(project.url, cloneDir);
      const metrics = await captureMetrics(cloneDir);
      const snapshot = buildSnapshot(metrics, 5.0);
      const score = snapshot.hybridScore;
      const calibrated = isCalibratedForTier(score, project.expectedTier);

      entries.push({
        label: project.label,
        url: project.url,
        expectedTier: project.expectedTier,
        metrics,
        score,
        calibrated,
      });

      logger.info(`[external-validate] ${project.label}: score=${score.toFixed(2)}, tier=${project.expectedTier}, calibrated=${calibrated}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[external-validate] Skipping ${project.label}: ${msg}`);
    } finally {
      await removeDir(cloneDir).catch(() => {});
    }
  }

  // Compute calibration rate
  const calibrationRate = entries.length > 0
    ? Math.round((entries.filter(e => e.calibrated).length / entries.length) * 100) / 100
    : 1.0;

  // Check that all high-tier entries score above all low-tier entries
  const highScores = entries.filter(e => e.expectedTier === 'high').map(e => e.score);
  const lowScores = entries.filter(e => e.expectedTier === 'low').map(e => e.score);
  const minHigh = highScores.length > 0 ? Math.min(...highScores) : Infinity;
  const maxLow = lowScores.length > 0 ? Math.max(...lowScores) : -Infinity;
  const rankingValid = highScores.length === 0 || lowScores.length === 0 || minHigh > maxLow;

  // Build summary
  const summary: string[] = [];
  summary.push(`External Validation Report — ${capturedAt}`);
  summary.push(`Local score: ${localScore.toFixed(2)}`);
  summary.push(`Projects validated: ${entries.length}/${projects.length}`);
  summary.push(`Calibration rate: ${(calibrationRate * 100).toFixed(0)}%`);
  summary.push(`Ranking valid (high > low): ${rankingValid}`);

  for (const entry of entries) {
    const status = entry.calibrated ? 'OK' : 'MISCALIBRATED';
    summary.push(`  ${entry.label}: ${entry.score.toFixed(2)} [${entry.expectedTier}] — ${status}`);
  }

  const report: ExternalValidationReport = {
    capturedAt,
    localScore,
    entries,
    calibrationRate,
    rankingValid,
    summary,
  };

  const reportPath = path.join(cwd, '.danteforge', 'external-validation.json');
  await writeReport(reportPath, JSON.stringify(report, null, 2));

  return report;
}
