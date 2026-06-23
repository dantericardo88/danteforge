// gap.ts — Depth Doctrine gap analyzer.
//
// Shows exactly what's needed to reach the next score tier for any dimension.
// The operator's tool for understanding "why am I stuck at 7.0 and how do I
// reach 9.0?"
//
// Usage:
//   danteforge gap <dimId>     Show gap analysis for one dimension
//   danteforge gap --all       Show gap analysis for all dimensions
//   danteforge gap --json      Machine-readable output

import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import {
  computeDerivedScoreWithBreakdown,
  type DimensionForScoring,
} from '../../core/derived-score.js';
import { TIER_SCORE_CAPS, type CapabilityTier } from '../../matrix/types/capability-test.js';
import { scoreBand } from '../../core/score-bands.js';
import { splitFleetLanes } from '../../core/frontier-queue.js';
import { LEGACY_NO_RECEIPT_CEILING } from '../../matrix/engines/receipt-ceiling.js';
import { runHardenGate } from '../../matrix/engines/hardener.js';
import { MARKET_CAPPED_DIMS, MARKET_DIM_MAX_SCORE } from '../../core/market-dims.js';
import type { Outcome, OutcomeEvidence } from '../../matrix/types/outcome.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GapBlocker {
  kind: 'no-outcomes' | 'harden-check' | 'stale-evidence' | 'missing-tier' | 'quality-gate' | 'legacy-ceiling' | 'market-cap';
  detail: string;
  remedy: string;
}

export interface GapAnalysis {
  dimensionId: string;
  label: string;
  currentScore: number;
  currentTier: string;
  nextTier: string | null;
  nextTierScore: number | null;
  blockers: GapBlocker[];
  nextAction: string;
}

export interface GapCliOptions {
  dimId?: string;
  all?: boolean;
  json?: boolean;
  cwd?: string;
  _loadMatrix?: typeof loadMatrix;
}

export interface GapCliResult {
  dimensions: GapAnalysis[];
}

// ── Tier order for "next tier" computation ────────────────────────────────────

const TIER_ORDER: CapabilityTier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

// ── Main entry ───────────────────────────────────────────────────────────────

export async function runGapCli(options: GapCliOptions): Promise<GapCliResult> {
  const cwd = options.cwd ?? process.cwd();
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;

  const matrix = await loadMatrixFn(cwd);
  if (!matrix) {
    throw new Error(`No matrix.json found. Run 'danteforge compete --init' first.`);
  }

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

  const evidence = await loadOutcomeEvidence(cwd);

  // Integrity report computed ONCE (council 2026-06-22): gap previously omitted integrityCapFor, so it
  // over-counted vs the headline (the live "14 dims at 8.0 vs 9 at 7.0"). Passed into the canonical
  // deriveDimScoreGated so gap returns the SAME number loadMatrix's headline does.
  let integrityReport: import('../../matrix/engines/outcome-integrity.js').IntegrityReport | null = null;
  try {
    const { checkOutcomeIntegrity } = await import('../../matrix/engines/outcome-integrity.js');
    integrityReport = await checkOutcomeIntegrity(
      matrix.dimensions as unknown as Parameters<typeof checkOutcomeIntegrity>[0],
      cwd,
    );
  } catch { integrityReport = null; }

  const analyses: GapAnalysis[] = [];
  for (const dim of targetDims) {
    const analysis = await analyzeDimension(dim, evidence, cwd, integrityReport);
    analyses.push(analysis);
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ dimensions: analyses }, null, 2) + '\n');
  } else {
    printGapReport(analyses);
  }

  return { dimensions: analyses };
}

// ── Per-dimension analysis ───────────────────────────────────────────────────

async function analyzeDimension(
  dim: { id: string; label: string; scores: Record<string, number>; sprint_history?: unknown[] },
  evidence: OutcomeEvidence,
  cwd: string,
  integrityReport: import('../../matrix/engines/outcome-integrity.js').IntegrityReport | null,
): Promise<GapAnalysis> {
  const d = dim as unknown as Record<string, unknown>;
  const outcomes = Array.isArray(d['outcomes']) ? d['outcomes'] as Outcome[] : [];

  const dfs: DimensionForScoring = {
    id: dim.id,
    outcomes: outcomes.length > 0 ? outcomes : undefined,
    declared_ceiling: d['declared_ceiling'] as CapabilityTier | undefined,
    legacy_score: dim.scores['self'],
    scores: dim.scores,
  };

  // Canonical gated derivation (derive-gated.ts) — the SAME chain (freshness → derive(now) → receipt-ceiling →
  // integrityCapFor → frontier → grounding) loadMatrix's headline uses, so gap can never disagree with it.
  // Previously gap omitted `now` AND integrityCapFor (council 2026-06-22 finding: the 14-vs-9 drift).
  const { deriveDimScoreGated } = await import('../../core/derive-gated.js');
  const gated = await deriveDimScoreGated(
    dim as unknown as Parameters<typeof deriveDimScoreGated>[0], evidence, new Date(), integrityReport,
  );
  // null score = UNVERIFIED (a dim with only stale operational-tier evidence) → the T2 unverified floor (5.0),
  // matching loadMatrix's drop-to-unverified. The breakdown is recomputed for the tier detail in that case.
  const breakdown = gated.breakdown ?? computeDerivedScoreWithBreakdown(dfs, evidence, new Date());
  const score = gated.score ?? 5.0;


  // Market-capped meta-dims are bounded by EXTERNAL signals (adoption/enterprise/token telemetry)
  // that internal evidence cannot certify — at the cap they are DONE, not blocked. Coaching tier
  // climbs here sends the loop into unwinnable churn, so short-circuit with the honest answer.
  if (MARKET_CAPPED_DIMS.has(dim.id) && score >= MARKET_DIM_MAX_SCORE) {
    return {
      dimensionId: dim.id, label: dim.label,
      currentScore: MARKET_DIM_MAX_SCORE, currentTier: 'market-cap',
      nextTier: null, nextTierScore: null,
      blockers: [{
        kind: 'market-cap',
        detail: `Hard market cap ${MARKET_DIM_MAX_SCORE.toFixed(1)} — this meta-dimension needs real external adoption/telemetry, which cannot be built or fabricated internally.`,
        remedy: 'Done at cap. Score moves only when genuine external market evidence exists (real users, contracts, telemetry).',
      }],
      nextAction: `At the ${MARKET_DIM_MAX_SCORE.toFixed(1)} market cap — no internal work can move this dim; spend the loop's budget elsewhere.`,
    };
  }

  const blockers: GapBlocker[] = [];

  // Determine current tier label
  let currentTier = 'legacy';
  if (breakdown.highestFullPassedTier) {
    currentTier = breakdown.highestFullPassedTier;
  }

  // Find next achievable tier
  let nextTier: CapabilityTier | null = null;
  let nextTierScore: number | null = null;
  for (const tier of TIER_ORDER) {
    if (TIER_SCORE_CAPS[tier] > score) {
      nextTier = tier;
      nextTierScore = TIER_SCORE_CAPS[tier];
      break;
    }
  }

  // --- Blocker analysis ---

  // 1. No outcomes declared → legacy ceiling
  if (outcomes.length === 0) {
    blockers.push({
      kind: 'no-outcomes',
      detail: `No outcomes declared — score capped at ${LEGACY_NO_RECEIPT_CEILING} (depth doctrine)`,
      remedy: `Add outcomes[] to this dim in matrix.json. Start: danteforge validate ${dim.id}`,
    });
  }

  // 2. Legacy ceiling active
  if (breakdown.usedLegacyFallback && score >= LEGACY_NO_RECEIPT_CEILING) {
    blockers.push({
      kind: 'legacy-ceiling',
      detail: `Legacy receipt ceiling active — cannot exceed ${LEGACY_NO_RECEIPT_CEILING} without outcomes`,
      remedy: `Declare at least one outcome to unlock higher tiers`,
    });
  }

  // 3. Stale evidence (outcomes exist but some not passing)
  if (outcomes.length > 0) {
    for (const pt of breakdown.perTier) {
      if (!pt.allPassing && pt.declared > 0) {
        blockers.push({
          kind: 'stale-evidence',
          detail: `Tier ${pt.tier}: ${pt.passing}/${pt.declared} passing (${pt.declared - pt.passing} failing)`,
          remedy: `Run: danteforge validate ${dim.id} --force-cold`,
        });
      }
    }
  }

  // 4. Missing higher tiers
  if (outcomes.length > 0 && nextTier) {
    const hasTierOutcome = outcomes.some(o => o.tier === nextTier);
    if (!hasTierOutcome) {
      blockers.push({
        kind: 'missing-tier',
        detail: `No ${nextTier} outcome declared — needed to unlock ${nextTierScore?.toFixed(1)}`,
        remedy: `Declare a ${nextTier} outcome in matrix.json. See docs/CAPABILITY-TIERS.md`,
      });
    }
  }

  // 5. T7 multi-receipt check — fires whenever dim has outcomes but < 3 at T5+
  if (outcomes.length > 0) {
    const highTierCount = outcomes.filter(o => {
      const rank = TIER_ORDER.indexOf(o.tier as CapabilityTier);
      return rank >= TIER_ORDER.indexOf('T5');
    }).length;
    if (highTierCount < 3) {
      blockers.push({
        kind: 'missing-tier',
        detail: `T7 (9.0) requires 3+ outcomes at T5+. Currently: ${highTierCount}`,
        remedy: `Add ${3 - highTierCount} more T5+ outcomes to unlock 9.0 (multi-receipt consensus)`,
      });
    }
  }

  // 6. Harden gate check — surface any failing structural checks
  try {
    const hardenVerdict = await runHardenGate({
      dimensionId: dim.id, dim: dim as never, cwd, _noWrite: true,
    });
    for (const check of hardenVerdict.checks) {
      if (!check.passed && !check.skipped) {
        for (const finding of check.findings) {
          blockers.push({
            kind: 'harden-check',
            detail: `harden/${check.check} failing (cap ${check.scoreCap}): ${finding.reason.slice(0, 120)}`,
            remedy: `Fix the ${check.check} finding to lift the ${check.scoreCap} cap`,
          });
        }
      }
    }
  } catch { /* best-effort — harden gate crash should not block gap analysis */ }

  // Compute next action (most impactful single thing). At/above the build ceiling the "next action" is a
  // band-aware reframe (council 2026-06-22): a BUILD-COMPLETE dim has SUCCEEDED — its next step is an EXTERNAL
  // anchor (benchmark receipt / court win), not more code, and an 8.0 must never read as "almost failing".
  const band = scoreBand(score);
  let nextAction: string;
  if (blockers.length > 0) {
    nextAction = blockers[0]!.remedy;
  } else if (band.isBuildTerminal) {
    nextAction = `BUILD-COMPLETE — the build has SUCCEEDED (terminal "done"). To cross into the FRONTIER (9+): ${band.nextAnchor}`;
  } else if (band.nextAnchor) {
    nextAction = `Next (${band.label}): ${band.nextAnchor}`;
  } else {
    nextAction = 'All clear — dimension is at maximum achievable score';
  }

  return {
    dimensionId: dim.id,
    label: dim.label,
    currentScore: score,
    currentTier,
    nextTier,
    nextTierScore,
    blockers,
    nextAction,
  };
}

// ── Formatter ────────────────────────────────────────────────────────────────

function printGapReport(analyses: GapAnalysis[]): void {
  logger.info('');
  logger.info(chalk.bold('DanteForge Gap Analysis — Depth Doctrine'));
  logger.info(chalk.dim('─'.repeat(60)));

  for (const a of analyses) {
    const tierLabel = a.nextTier
      ? `next: ${a.nextTier} → ${a.nextTierScore?.toFixed(1)}`
      : 'at ceiling';

    // Two-axis colouring: BUILD-COMPLETE (8.0) and the frontier band are SUCCESS states (green), never the
    // yellow "warning" that made an 8.0 read as a near-miss. Wired (7.0) is healthy build progress (cyan).
    const band = scoreBand(a.currentScore);
    const scoreColor = a.currentScore >= 8.0
      ? chalk.green
      : a.currentScore >= 7.0
        ? chalk.cyan
        : a.currentScore >= 5.0
          ? chalk.yellow
          : chalk.red;
    const axisTag = band.axis === 'build' ? 'BUILD' : 'FRONTIER';

    logger.info('');
    logger.info(
      `  ${chalk.bold(a.dimensionId)} ` +
      `(score: ${scoreColor(a.currentScore.toFixed(1))} · ${chalk.bold(band.label)} [${axisTag}], ` +
      `tier: ${a.currentTier}, ${tierLabel})`,
    );

    if (a.blockers.length === 0) {
      logger.info(chalk.green('    ✓ No blockers'));
    } else {
      for (const b of a.blockers) {
        logger.info(chalk.red(`    BLOCKER [${b.kind}]: ${b.detail}`));
        logger.info(chalk.dim(`      → ${b.remedy}`));
      }
    }

    logger.info(chalk.cyan(`    NEXT ACTION: ${a.nextAction}`));
  }

  // Loops vs Queues (Matt Pocock / council 2026-06-22): split the fleet into the loopable BUILD lane and the
  // human-triaged FRONTIER queue, so frontier work reads as a reviewable queue, not a loop banging on 8.0.
  if (analyses.length > 1) {
    const split = splitFleetLanes(analyses.map(a => ({ id: a.dimensionId, score: a.currentScore })));
    logger.info('');
    logger.info(chalk.dim('─'.repeat(60)));
    logger.info(chalk.bold('  Loops vs Queues'));
    logger.info(chalk.cyan(`  BUILD lane (loopable / AFK, <8.0): ${split.buildLane.length} dim(s)`) + chalk.dim(' — autoforge/the climb can close these alone.'));
    logger.info(chalk.green(`  FRONTIER queue (BUILD-COMPLETE ≥8.0, needs an EXTERNAL anchor): ${split.frontierQueue.length} dim(s)`) + chalk.dim(' — strategic, human-triaged (benchmark run / court win), not a loop.'));
    for (const f of split.frontierQueue.slice(0, 8)) {
      logger.info(chalk.dim(`    • ${f.dimId} (${f.score.toFixed(1)}) → ${f.anchorKind}`));
    }
  }

  logger.info('');
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info(chalk.dim('  Run `danteforge validate <dim>` to generate receipts and lift ceilings.'));
  logger.info('');
}
