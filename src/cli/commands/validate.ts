// validate.ts — Depth Doctrine: run dimension outcomes and report whether
// the score ceiling was lifted.
//
// "Code without a receipt is a hypothesis, not a feature."
//
// This command is the operator's tool for proving that a dimension actually
// works. Until `danteforge validate <dim>` passes, the dimension is structurally
// capped at 7.0 (depth doctrine, receipt-ceiling.ts).
//
// Relationship to `danteforge outcomes`:
//   - `outcomes` is the raw runner: run outcomes, write evidence, report tiers.
//   - `validate` is the depth-doctrine entry: shows before/after score ceiling,
//     explains what changed, and exits 1 if any outcome fails (CI gate).
//
// Usage:
//   danteforge validate <dimId>          Run outcomes for one dimension
//   danteforge validate --all            Run outcomes for all dimensions
//   danteforge validate <dimId> --quick  Run only T1/T2 outcomes (quick check)
//   danteforge validate <dimId> --json   Machine-readable output

import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { loadMatrix, saveMatrix } from '../../core/compete-matrix.js';
import { runAllOutcomes, loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import {
  computeDerivedScoreWithBreakdown,
  type DimensionForScoring,
} from '../../core/derived-score.js';
import { applyLegacyReceiptCeiling, LEGACY_NO_RECEIPT_CEILING } from '../../matrix/engines/receipt-ceiling.js';
import type { Outcome } from '../../matrix/types/outcome.js';
import { SCORING_DOCTRINE_SHORT } from '../../core/scoring-doctrine.js';
import { checkOutcomeIntegrity, formatIntegrityReport } from '../../matrix/engines/outcome-integrity.js';
import { effectiveStatus, type FrontierSpec } from '../../core/frontier-spec.js';

/** Score above this requires a frozen frontier_spec — i.e. a defined competitive-frontier target. */
const FRONTIER_GATE_THRESHOLD = 8.0;

/**
 * The frontier gate makes "9.0 = the competitive frontier" binding, not just defined.
 * 8.0 = real execution, capability proven, but NO competitive-frontier target declared.
 * >8.0 requires a frozen (non-stale) frontier_spec naming the oss/closed-source competitor
 * to match-or-beat. Without it, a dim cannot claim to be AT the frontier — only that its
 * own capability runs. Caps at 8.0; the operator authors+freezes a spec to lift it.
 */
export function applyFrontierGate(score: number, dim: unknown): { score: number; capped: boolean } {
  if (score <= FRONTIER_GATE_THRESHOLD) return { score, capped: false };
  const spec = (dim as { frontier_spec?: FrontierSpec }).frontier_spec;
  const status = spec ? effectiveStatus(spec) : 'none';
  if (status === 'frozen' || status === 'validated') return { score, capped: false };
  return { score: FRONTIER_GATE_THRESHOLD, capped: true };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValidateCliOptions {
  dimId?: string;
  all?: boolean;
  quick?: boolean;
  json?: boolean;
  cwd?: string;
  forceCold?: boolean;
  /** Filter to runtime-only outcome kinds (cli-smoke, runtime-exec, e2e-workflow). */
  runtimeOnly?: boolean;
  // Injection seams for tests
  _loadMatrix?: typeof loadMatrix;
  _onProgress?: (msg: string) => void;
  _createTimeMachineCommit?: ((opts: { cwd: string; paths: string[]; label: string }) => Promise<unknown>) | null;
}

export interface ValidateDimResult {
  dimensionId: string;
  label: string;
  scoreBefore: number;
  scoreAfter: number;
  ceilingLifted: boolean;
  ceilingWas: number | null;
  totalOutcomes: number;
  passingOutcomes: number;
  failingOutcomes: number;
  error?: string;
  /** Set when an integrity violation capped the score below what outcomes earned. */
  integrityCap?: 'SHARED_RECEIPT' | 'SEAM_USAGE' | 'CALLSITE_DECOUPLED' | 'NO_FRONTIER_SPEC';
}

export interface ValidateCliResult {
  dimensions: ValidateDimResult[];
  allPassed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RUNTIME_KINDS = new Set(['cli-smoke', 'runtime-exec', 'e2e-workflow']);

function applyIntegrityCaps(
  score: number,
  dimId: string,
  report: import('../../matrix/engines/outcome-integrity.js').IntegrityReport | null,
): { cappedScore: number; integrityCap: 'SHARED_RECEIPT' | 'SEAM_USAGE' | 'CALLSITE_DECOUPLED' | 'NO_FRONTIER_SPEC' | undefined } {
  if (!report) return { cappedScore: score, integrityCap: undefined };
  // Seam is the strictest cap (6.0) — check first so a dim that is both seamed and
  // shared/decoupled gets the lower ceiling.
  if (report.seamedDims.includes(dimId) && score > 6.0)
    return { cappedScore: 6.0, integrityCap: 'SEAM_USAGE' };
  if (report.sharedReceiptDims.includes(dimId) && score > 7.0)
    return { cappedScore: 7.0, integrityCap: 'SHARED_RECEIPT' };
  if (report.decoupledDims.includes(dimId) && score > 7.0)
    return { cappedScore: 7.0, integrityCap: 'CALLSITE_DECOUPLED' };
  return { cappedScore: score, integrityCap: undefined };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runValidateCli(options: ValidateCliOptions): Promise<ValidateCliResult> {
  const cwd = options.cwd ?? process.cwd();
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  logger.info(`[scoring-doctrine] ${SCORING_DOCTRINE_SHORT}`);

  const matrix = await loadMatrixFn(cwd);
  if (!matrix) {
    throw new Error(`No matrix.json found at ${path.join(cwd, '.danteforge', 'compete', 'matrix.json')}`);
  }

  // Determine which dimensions to validate
  const targetDims = options.all
    ? matrix.dimensions
    : matrix.dimensions.filter(d => d.id === options.dimId);

  if (targetDims.length === 0) {
    const available = matrix.dimensions.map(d => d.id).join(', ');
    throw new Error(
      options.dimId
        ? `Dimension "${options.dimId}" not found. Available: ${available}`
        : 'No dimensions found in matrix.json',
    );
  }

  // Filter to only dims that have outcomes declared
  const dimsWithOutcomes = targetDims.filter(
    d => Array.isArray((d as unknown as Record<string, unknown>)['outcomes']) &&
         ((d as unknown as Record<string, unknown>)['outcomes'] as unknown[]).length > 0,
  );

  if (dimsWithOutcomes.length === 0) {
    const dimLabel = options.all ? 'any dimension' : `"${options.dimId}"`;
    logger.warn(
      `No outcomes declared for ${dimLabel}. ` +
      `Add outcomes to matrix.json to enable validation. ` +
      `Until then, scores are capped at ${LEGACY_NO_RECEIPT_CEILING} (depth doctrine).`,
    );
    return { dimensions: [], allPassed: false };
  }

  // Load evidence BEFORE running to compute "before" scores
  const evidenceBefore = await loadOutcomeEvidence(cwd);
  const beforeScores = new Map<string, number>();
  for (const dim of dimsWithOutcomes) {
    const dfs = buildDfs(dim);
    const breakdown = computeDerivedScoreWithBreakdown(dfs, evidenceBefore);
    beforeScores.set(dim.id, applyLegacyReceiptCeiling(breakdown.score, breakdown));
  }

  // Determine tier filter for --quick mode (only T1/T2 — fast checks)
  const tierFilter = options.quick ? ['T1', 'T2'] : undefined;
  const onProgress = options._onProgress ?? ((msg: string) => logger.info(chalk.dim(msg)));

  if (!options.json) {
    logger.info('');
    logger.info(chalk.bold('danteforge validate') + chalk.dim(' — Depth Doctrine Receipt Runner'));
    logger.info(chalk.dim('─'.repeat(60)));
    logger.info(chalk.dim(`Running outcomes for ${dimsWithOutcomes.length} dimension(s)…`));
    logger.info('');
  }

  // Integrity pre-flight: detect cross-dim shared receipts, seamed tests, market dims
  let integrityReport: import('../../matrix/engines/outcome-integrity.js').IntegrityReport | null = null;
  try {
    integrityReport = await checkOutcomeIntegrity(
      matrix.dimensions as Parameters<typeof checkOutcomeIntegrity>[0],
      cwd,
    );
    if (!integrityReport.clean && !options.json) {
      logger.warn(chalk.yellow('\n⚠  ' + formatIntegrityReport(integrityReport)));
      logger.warn(chalk.yellow('   Violations cap derived scores. Fix outcomes to unlock honest 9.0.'));
      logger.info('');
    }
  } catch { /* best-effort — integrity check never blocks validation */ }

  // Run outcomes — optionally filter to runtime-only kinds
  const filterOutcomes = (outcomes: Outcome[] | undefined): Outcome[] | undefined => {
    if (!options.runtimeOnly || !outcomes) return outcomes;
    return outcomes.filter(o => RUNTIME_KINDS.has(o.kind ?? 'shell'));
  };

  const runResult = await runAllOutcomes({
    cwd,
    dimensions: dimsWithOutcomes.map(d => ({
      id: d.id,
      outcomes: filterOutcomes((d as unknown as Record<string, unknown>)['outcomes'] as Outcome[] | undefined),
    })),
    forceCold: options.forceCold ?? true,
    _onProgress: onProgress,
  });

  // Load evidence AFTER running to compute "after" scores
  const evidenceAfter = await loadOutcomeEvidence(cwd);

  // Build per-dim results
  const results: ValidateDimResult[] = [];
  for (const dim of dimsWithOutcomes) {
    const dfs = buildDfs(dim);
    const breakdown = computeDerivedScoreWithBreakdown(dfs, evidenceAfter);
    const scoreAfter = applyLegacyReceiptCeiling(breakdown.score, breakdown);
    const scoreBefore = beforeScores.get(dim.id) ?? 0;

    const dimRunResult = runResult.perDimension.find(r => r.dimensionId === dim.id);
    const total = dimRunResult?.total ?? 0;
    const passing = dimRunResult?.passing ?? 0;
    const failing = dimRunResult?.failing ?? 0;

    // Apply integrity caps: shared receipts → 7.0, seamed outcomes → 6.0
    const integrity = applyIntegrityCaps(scoreAfter, dim.id, integrityReport);
    // Frontier gate: >8.0 requires a frozen frontier_spec (the competitive target). This
    // makes "9.0 = the frontier" binding — a proven capability with no declared frontier
    // target caps at 8.0.
    const frontier = applyFrontierGate(integrity.cappedScore, dim);
    const cappedScore = frontier.score;
    const integrityCap = frontier.capped ? 'NO_FRONTIER_SPEC' as const : integrity.integrityCap;

    // Ceiling lifted = score was capped at legacy ceiling before, now above it
    const wasCapped = scoreBefore <= LEGACY_NO_RECEIPT_CEILING && !breakdown.usedLegacyFallback;
    const ceilingLifted = wasCapped && cappedScore > LEGACY_NO_RECEIPT_CEILING;

    results.push({
      dimensionId: dim.id,
      label: dim.label,
      scoreBefore,
      scoreAfter: cappedScore,
      ceilingLifted,
      ceilingWas: scoreBefore <= LEGACY_NO_RECEIPT_CEILING ? LEGACY_NO_RECEIPT_CEILING : null,
      totalOutcomes: total,
      passingOutcomes: passing,
      failingOutcomes: failing,
      integrityCap,
    });
  }

  const allPassed = results.every(r => r.failingOutcomes === 0);

  // Write derived scores back to matrix.json so scores.derived reflects receipt evidence.
  try {
    const liveMatrix = await loadMatrix(cwd);
    if (liveMatrix) {
      let changed = false;
      for (const r of results) {
        const dim = liveMatrix.dimensions.find(d => d.id === r.dimensionId);
        if (dim && r.failingOutcomes === 0 && r.scoreAfter > 0) {
          dim.scores['derived'] = Math.round(r.scoreAfter * 100) / 100;
          changed = true;
        }
      }
      if (changed) await saveMatrix(liveMatrix, cwd);
    }
  } catch { /* never block validation output */ }

  // Time Machine: record the validation run for audit trail.
  try {
    const commitFn = options._createTimeMachineCommit === null ? null
      : options._createTimeMachineCommit
      ?? (await import('../../core/time-machine.js')).createTimeMachineCommit;
    if (commitFn) {
      const dimLabel = options.all ? 'all' : (options.dimId ?? 'unknown');
      await commitFn({
        cwd,
        paths: ['.danteforge/outcome-evidence'],
        label: `validate/${dimLabel}/${allPassed ? 'PASS' : 'FAIL'}`,
      });
    }
  } catch { /* best-effort — TM never blocks validation */ }

  if (options.json) {
    process.stdout.write(JSON.stringify({ cwd, allPassed, dimensions: results }, null, 2) + '\n');
    return { dimensions: results, allPassed };
  }

  // Human-readable output
  printResults(results, allPassed);
  return { dimensions: results, allPassed };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildDfs(dim: { id: string; scores: Record<string, number> }): DimensionForScoring {
  const d = dim as unknown as Record<string, unknown>;
  return {
    id: dim.id,
    outcomes: d['outcomes'] as Outcome[] | undefined,
    declared_ceiling: d['declared_ceiling'] as DimensionForScoring['declared_ceiling'],
    legacy_score: dim.scores['self'],
    scores: dim.scores,
  };
}

function printResults(results: ValidateDimResult[], allPassed: boolean): void {
  logger.info('');
  logger.info(chalk.bold('Validation Results'));
  logger.info(chalk.dim('─'.repeat(60)));

  for (const r of results) {
    const status = r.failingOutcomes === 0
      ? chalk.green('PASS')
      : chalk.red('FAIL');

    const scoreChange = r.scoreAfter > r.scoreBefore
      ? chalk.green(` → ${r.scoreAfter.toFixed(1)}`)
      : r.scoreAfter < r.scoreBefore
        ? chalk.red(` → ${r.scoreAfter.toFixed(1)}`)
        : chalk.dim(` → ${r.scoreAfter.toFixed(1)}`);

    const ceilingNote = r.ceilingLifted
      ? chalk.green(' ✓ ceiling lifted')
      : r.failingOutcomes === 0 && r.ceilingWas !== null
        ? ''
        : '';

    logger.info(
      `  [${status}] ${r.dimensionId.padEnd(32)} ` +
      `${r.scoreBefore.toFixed(1)}${scoreChange}  ` +
      `(${r.passingOutcomes}/${r.totalOutcomes} outcomes)${ceilingNote}`,
    );

    if (r.failingOutcomes > 0) {
      logger.info(chalk.dim(`         ${r.failingOutcomes} outcome(s) failed — run with --force-cold to re-execute`));
    }
    if (r.integrityCap === 'NO_FRONTIER_SPEC') {
      logger.info(chalk.yellow(`         Capped at ${r.scoreAfter.toFixed(1)} — no frozen frontier_spec. To exceed 8.0, declare the competitive target: danteforge frontier-spec init ${r.dimensionId} → check → freeze`));
    } else if (r.integrityCap) {
      logger.info(chalk.yellow(`         Score capped at ${r.scoreAfter.toFixed(1)} by ${r.integrityCap} integrity violation`));
    }
    if (r.ceilingLifted) {
      logger.info(chalk.green(`         Score ceiling lifted: was capped at ${r.ceilingWas}, now ${r.scoreAfter.toFixed(1)}`));
    }
  }

  logger.info('');
  logger.info(chalk.dim('─'.repeat(60)));

  if (allPassed) {
    logger.info(chalk.green.bold('✓ All outcomes passed. Score ceilings lifted where applicable.'));
    logger.info(chalk.dim('  Re-run `danteforge score` to see updated scores.'));
  } else {
    const failCount = results.filter(r => r.failingOutcomes > 0).length;
    logger.info(chalk.red.bold(`✗ ${failCount} dimension(s) have failing outcomes.`));
    logger.info(chalk.dim('  Fix the failing outcomes, then re-run `danteforge validate`.'));
    logger.info(chalk.dim(`  Dimensions with failing outcomes are capped at ${LEGACY_NO_RECEIPT_CEILING} (depth doctrine).`));
  }
  logger.info('');
}
