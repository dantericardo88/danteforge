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
import { checkOutcomeIntegrity, formatIntegrityReport, integrityCapFor } from '../../matrix/engines/outcome-integrity.js';
import { effectiveStatus, type FrontierSpec } from '../../core/frontier-spec.js';
import { recordDeclarations } from '../../core/declarations-ledger.js';

/** Score above this requires an independently court-VALIDATED frontier_spec. */
const FRONTIER_GATE_THRESHOLD = 8.0;

/**
 * The frontier gate makes "9.0 = the competitive frontier" binding, AND independently reviewed.
 *   ≤8.0 — real execution, capability proven (real run + frozen target), but NOT court-confirmed.
 *   >8.0 — requires frontier_spec.status === 'validated', which ONLY the frontier-review-court sets
 *          (builder-never-judges, K-of-M consensus). A frozen-but-unvalidated spec caps at 8.0: the
 *          target is declared and a real run exists, but no independent reviewer has confirmed it
 *          genuinely matches the named competitor. This is what makes autonomous-to-9 honest — the
 *          builder cannot self-certify a 9.0. (A `validated` spec edited after the fact goes `stale`
 *          via effectiveStatus and drops back to 8.0.)
 */
export function applyFrontierGate(score: number, dim: unknown): { score: number; capped: boolean } {
  if (score <= FRONTIER_GATE_THRESHOLD) return { score, capped: false };
  const spec = (dim as { frontier_spec?: FrontierSpec }).frontier_spec;
  const status = spec ? effectiveStatus(spec) : 'none';
  if (status === 'validated') return { score, capped: false };
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
  /** Seam: declarations-ledger writer override. `null` disables the ledger write. */
  _recordDeclarations?: typeof recordDeclarations | null;
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
  integrityCap?: 'SHARED_RECEIPT' | 'SEAM_USAGE' | 'CALLSITE_DECOUPLED' | 'ORPHAN_CALLSITE' | 'NO_FRONTIER_SPEC';
}

export interface ValidateCliResult {
  dimensions: ValidateDimResult[];
  allPassed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RUNTIME_KINDS = new Set(['cli-smoke', 'runtime-exec', 'e2e-workflow']);
// --quick keeps only the fast checks (typecheck + unit-test tiers).
const QUICK_TIERS = new Set(['T1', 'T2']);

// Integrity caps are shared with the loadMatrix-derived path via integrityCapFor
// (outcome-integrity.ts) so the headline score can never drift above this honest
// value. NO_FRONTIER_SPEC is layered on separately below (frontier-spec gate).
function applyIntegrityCaps(
  score: number,
  dimId: string,
  report: import('../../matrix/engines/outcome-integrity.js').IntegrityReport | null,
): { cappedScore: number; integrityCap: 'SHARED_RECEIPT' | 'SEAM_USAGE' | 'CALLSITE_DECOUPLED' | 'ORPHAN_CALLSITE' | 'NO_FRONTIER_SPEC' | undefined } {
  return integrityCapFor(score, dimId, report);
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

  // Run outcomes — --runtime-only keeps runtime kinds; --quick keeps only T1/T2 tiers.
  // Either filter shrinks the run below the declared set, so a filtered run can never
  // satisfy the gate-confirmed ledger condition below (total === declared length).
  const filterOutcomes = (outcomes: Outcome[] | undefined): Outcome[] | undefined => {
    if (!outcomes) return outcomes;
    let kept = outcomes;
    if (options.runtimeOnly) kept = kept.filter(o => RUNTIME_KINDS.has(o.kind ?? 'shell'));
    if (options.quick) kept = kept.filter(o => QUICK_TIERS.has(o.tier));
    return kept;
  };

  const runResult = await runAllOutcomes({
    cwd,
    dimensions: dimsWithOutcomes.map(d => ({
      id: d.id,
      outcomes: filterOutcomes((d as unknown as Record<string, unknown>)['outcomes'] as Outcome[] | undefined),
    })),
    forceCold: options.forceCold ?? true,
    _onProgress: onProgress,
    // Disable the PER-OUTCOME Time Machine commit — validate already does ONE at the end; per-outcome
    // commits are redundant and heavy on a large repo.
    _createTimeMachineCommit: null,
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

    // THE LEDGER WRITE (durable persistence for gate-confirmed earns): matrix.json is
    // kernel-owned and never committed by agents, so a git reset / matrix rewrite wipes
    // its uncommitted outcomes[] (fleet run 1: earns evaporated on 3/3 repos). Snapshot
    // this dim's DECLARED outcomes to the self-gitignored declarations ledger — but ONLY
    // on the gate-confirmed condition: every declared outcome ran (no --quick /
    // --runtime-only filtering) and passed, with NO integrity violation MEMBERSHIP at
    // all (adversarial finding 11: integrityCapFor only reports a cap when it BITES —
    // score above the cap — so a seamed/shared/decoupled/orphan/unscannable dim scoring
    // below its cap carries integrityCap === undefined yet is NOT gate-clean). The
    // integrity report itself is required: when the pre-flight failed, cleanliness is
    // unverified, so the write is refused (fail-closed). A failing, capped, flagged, or
    // partial run must never snapshot — that would launder an unproven declaration into
    // durability.
    const declaredOutcomes = (dim as unknown as Record<string, unknown>)['outcomes'] as Outcome[];
    const dimIntegrityClean =
      integrityReport !== null &&
      [
        integrityReport.seamedDims,
        integrityReport.sharedReceiptDims,
        integrityReport.decoupledDims,
        integrityReport.orphanDims,
        integrityReport.unscannableDims,
      ].every(list => !(list ?? []).includes(dim.id));
    const gateConfirmed =
      total > 0 &&
      total === declaredOutcomes.length &&
      failing === 0 &&
      integrityCap === undefined &&
      dimIntegrityClean;
    if (gateConfirmed && options._recordDeclarations !== null) {
      const recordFn = options._recordDeclarations ?? recordDeclarations;
      try {
        await recordFn(cwd, dim.id, declaredOutcomes);
      } catch { /* the ledger is a recovery net — it never blocks validation */ }
    }
  }

  const allPassed = results.every(r => r.failingOutcomes === 0);

  // Write derived scores back to matrix.json so scores.derived reflects receipt evidence.
  // ALWAYS persist the freshly recomputed value — UP AND DOWN (the rank-8 split-brain
  // fix). The old guard (`failingOutcomes === 0 && scoreAfter > 0`) persisted only earns,
  // so after a regression the stale inflated derived sat in matrix.json while live
  // derivation said lower, and every consumer of the persisted value saw the inflated
  // one. Decreases are exactly the writes honesty depends on.
  try {
    const liveMatrix = await loadMatrix(cwd);
    if (liveMatrix) {
      let changed = false;
      for (const r of results) {
        const dim = liveMatrix.dimensions.find(d => d.id === r.dimensionId);
        if (!dim) continue;
        const fresh = Math.round(r.scoreAfter * 100) / 100;
        if (dim.scores['derived'] !== fresh) {
          dim.scores['derived'] = fresh;
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
