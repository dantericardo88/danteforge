// Self-Assess — DanteForge running its own quality measurement on itself.
// Captures objective metrics (eslint errors, TS errors, test pass rate, bundle size),
// writes a baseline snapshot, and diffs against the previous baseline to surface
// whether DanteForge's own quality is improving over time.
//
// This closes the "self-validation" gap: the system that improves others must
// also improve itself, with machine-verifiable evidence — not LLM self-praise.

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

/** A concrete, machine-readable improvement proposal derived from objective metrics. */
export interface ImprovementProposal {
  /** Short label for the gap area (e.g. "eslint-errors", "test-coverage", "bundle-size"). */
  area: 'eslint-errors' | 'typescript-errors' | 'test-coverage' | 'bundle-size' | 'score-regression' | 'general';
  /** One-sentence human description of what to fix. */
  description: string;
  /** Priority rank: P0 = critical, P1 = high, P2 = medium. */
  priority: 'P0' | 'P1' | 'P2';
  /** Measurable acceptance criterion — what "done" looks like. */
  acceptanceCriteria: string;
  /** Suggested file path(s) to look at first (relative to cwd). May be empty. */
  suggestedFiles: string[];
  /** Current metric value as a string for display. */
  currentValue: string;
  /** Target metric value as a string for display. */
  targetValue: string;
}

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
  /** Concrete, prioritized improvement proposals derived from objective metrics. */
  improvementProposals: ImprovementProposal[];
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function runSelfAssess(opts: SelfAssessOptions = {}): Promise<SelfAssessResult> {
  const cwd = opts.cwd ?? process.cwd();

  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession(cwd);
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'self-assess: objective metric capture', context: { cwd }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block */ }

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

  // Generate concrete improvement proposals from the metrics
  const improvementProposals = buildImprovementProposals(metrics, current, diff);
  if (improvementProposals.length > 0) {
    logger.info(`[self-assess] ${improvementProposals.length} improvement proposal(s) generated:`);
    for (const p of improvementProposals) {
      logger.info(`  [${p.priority}] ${p.area}: ${p.description}`);
    }
  }

  const summary = buildSummary(current, previous, diff);
  logger.info(summary);

  // --- Decision-node: record completion (best-effort) ---
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession(cwd);
    await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'self-assess: objective metric capture [complete]', result: 'self-assess complete', success: true, latencyMs: Date.now() - _dnT0 });
  } catch { /* best-effort */ }

  return { current, previous, diff, snapshotPath, improved, summary, improvementProposals };
}

// ── Improvement Proposal Generator ────────────────────────────────────────────

/**
 * Derive concrete, measurable improvement proposals from objective metrics.
 * Each proposal specifies what to fix, how to verify it, and which files to start with.
 */
export function buildImprovementProposals(
  metrics: ObjectiveMetrics,
  current: QualitySnapshot,
  diff: SnapshotDiff | null,
): ImprovementProposal[] {
  const proposals: ImprovementProposal[] = [];

  // P0: TypeScript errors block compilation — highest priority
  if (metrics.typescriptErrors > 0) {
    proposals.push({
      area: 'typescript-errors',
      priority: 'P0',
      description: `Fix ${metrics.typescriptErrors} TypeScript compilation error(s) that block the build`,
      acceptanceCriteria: 'npm run typecheck exits 0 with 0 errors',
      suggestedFiles: ['src/cli/index.ts', 'src/core/state.ts'],
      currentValue: `${metrics.typescriptErrors} errors`,
      targetValue: '0 errors',
    });
  }

  // P0: ESLint errors above threshold are structural defects
  if (metrics.eslintErrors > 5) {
    proposals.push({
      area: 'eslint-errors',
      priority: metrics.eslintErrors > 20 ? 'P0' : 'P1',
      description: `Eliminate ${metrics.eslintErrors} ESLint error(s) — run npm run lint:fix then fix remaining`,
      acceptanceCriteria: 'npm run lint exits 0 with 0 errors',
      suggestedFiles: ['src/cli/', 'src/core/'],
      currentValue: `${metrics.eslintErrors} errors`,
      targetValue: '0 errors',
    });
  }

  // P1: Test pass rate below 100%
  if (metrics.testPassRate >= 0 && metrics.testPassRate < 1.0) {
    const failCount = Math.round(metrics.testCount * (1 - metrics.testPassRate));
    proposals.push({
      area: 'test-coverage',
      priority: metrics.testPassRate < 0.95 ? 'P0' : 'P1',
      description: `Fix ${failCount} failing test(s) — pass rate is ${(metrics.testPassRate * 100).toFixed(1)}%`,
      acceptanceCriteria: 'npm test exits 0 with 100% pass rate',
      suggestedFiles: ['tests/'],
      currentValue: `${(metrics.testPassRate * 100).toFixed(1)}% (${failCount} failing)`,
      targetValue: '100%',
    });
  }

  // P1: Score regression vs previous baseline
  if (diff?.hasRegression) {
    const regressedAreas = diff.regressions.join('; ');
    proposals.push({
      area: 'score-regression',
      priority: 'P1',
      description: `Recover from score regression: ${regressedAreas}`,
      acceptanceCriteria: `Hybrid score >= previous baseline (${current.hybridScore.toFixed(2)}/10)`,
      suggestedFiles: [],
      currentValue: `${current.hybridScore.toFixed(2)}/10 (regressed)`,
      targetValue: 'No regressions vs baseline',
    });
  }

  // P2: Bundle size warning (>5MB is unusually large for a CLI)
  const bundleMb = metrics.bundleSizeBytes / (1024 * 1024);
  if (bundleMb > 5) {
    proposals.push({
      area: 'bundle-size',
      priority: 'P2',
      description: `Reduce bundle size from ${bundleMb.toFixed(1)} MB — consider dynamic imports for heavy deps`,
      acceptanceCriteria: 'Bundle size < 5 MB',
      suggestedFiles: ['src/cli/index.ts', 'tsup.config.ts'],
      currentValue: `${bundleMb.toFixed(1)} MB`,
      targetValue: '< 5 MB',
    });
  }

  // P2: If overall score is below 8.0, suggest general improvement
  if (current.hybridScore < 8.0 && proposals.length === 0) {
    proposals.push({
      area: 'general',
      priority: 'P2',
      description: `Hybrid score is ${current.hybridScore.toFixed(2)}/10 — run self-improve to identify specific gaps`,
      acceptanceCriteria: 'Hybrid score >= 9.0/10',
      suggestedFiles: [],
      currentValue: `${current.hybridScore.toFixed(2)}/10`,
      targetValue: '9.0/10',
    });
  }

  // Sort: P0 first, then P1, then P2
  const priority = { P0: 0, P1: 1, P2: 2 };
  proposals.sort((a, b) => priority[a.priority] - priority[b.priority]);
  return proposals;
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
