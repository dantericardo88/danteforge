// frontier-gap.ts — Frontier Gap Engine CLI entry point
// Claim -> Skeptic Objection -> Gap Type -> Required Proof -> Re-score

import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import type { CompeteMatrix } from '../../core/compete-matrix.js';
import {
  buildFrontierReport,
  buildRaiseReadinessReport,
  findDimension,
} from '../../core/frontier-gap-engine.js';
import type { FrontierDimension, GapType, RaiseReadinessReport } from '../../core/frontier-types.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export interface FrontierGapOptions {
  dimension?: string;        // e.g. "D12" or "ghost_text_fim"
  raiseReady?: boolean;
  matrix?: string;           // path override (currently unused — reserved)
  project?: boolean;
  cwd?: string;
  _emit?: (line: string) => void;
  _loadMatrix?: typeof loadMatrix;
}

const GAP_TYPE_EMOJI: Record<GapType, string> = {
  capability: '[capability]',
  proof:      '[proof]     ',
  reliability:'[reliability]',
  productization: '[productization]',
};

const STATUS_TAG: Record<string, string> = {
  'catch-up':           'CATCH-UP',
  'near-frontier':      'NEAR-FRONTIER',
  'frontier-complete':  'FRONTIER-COMPLETE',
  'creativity-frontier':'CREATIVITY-FRONTIER',
};

function sep(char = '─', len = 60): string {
  return char.repeat(len);
}

function emitDimensionDeepDive(d: FrontierDimension, emit: (l: string) => void): void {
  emit('');
  emit(sep());
  emit(`Dimension:    ${d.label}  (${d.id})`);
  emit(`Current claim: ${d.currentClaim}`);
  emit(`Current score: ${d.currentScore.toFixed(1)} / 10`);
  emit(`Competitor best: ${d.competitorBestScore.toFixed(1)} / 10  (${d.competitorBestName})`);
  emit('');
  emit(`Strongest skeptic objection:`);
  emit(`  ${d.objection.text}`);
  emit('');
  emit(`Gap type:  ${d.objection.gapType}`);
  emit(`Severity:  ${d.objection.severity.toFixed(1)} / 10`);
  emit('');
  emit(`Smallest proof to close it:`);
  emit(`  ${d.objection.requiredProof}`);
  emit('');
  emit(`Score justified after that proof: ${d.objection.nextJustifiedScore.toFixed(1)}`);
  if (d.objection.whatRemainsAfter) {
    emit(`What still remains after:  ${d.objection.whatRemainsAfter}`);
  }
  emit('');
  emit(`Status:  ${STATUS_TAG[d.status] ?? d.status}`);
  emit(sep());
}

function emitTopObjections(dims: FrontierDimension[], emit: (l: string) => void): void {
  emit('');
  emit('  Top Skeptic Objections  (ranked by leverage)');
  emit('');
  dims.forEach((d, i) => {
    emit(`  ${i + 1}. ${d.label}  [score: ${d.currentScore.toFixed(1)}]`);
    emit(`     Objection: ${d.objection.text}`);
    emit(`     Type:      ${GAP_TYPE_EMOJI[d.objection.gapType]}    Status: ${STATUS_TAG[d.status] ?? d.status}`);
    emit(`     Next proof: ${d.objection.requiredProof}`);
    emit(`     Score if closed: ${d.objection.nextJustifiedScore.toFixed(1)}`);
    emit('');
  });
}

function emitDoNotWorkOn(dims: FrontierDimension[], emit: (l: string) => void): void {
  if (dims.length === 0) return;
  emit('  Do Not Work On  (lowest leverage right now)');
  emit('');
  for (const d of dims) {
    emit(`    ${d.label}  [leverage: ${d.leverage.toFixed(1)}]  Status: ${STATUS_TAG[d.status] ?? d.status}`);
  }
  emit('');
}

function emitGroupedByType(dims: FrontierDimension[], emit: (l: string) => void): void {
  const byType: Record<GapType, FrontierDimension[]> = {
    capability: [],
    proof: [],
    reliability: [],
    productization: [],
  };
  for (const d of dims) byType[d.objection.gapType].push(d);

  const order: GapType[] = ['capability', 'proof', 'reliability', 'productization'];
  for (const t of order) {
    const group = byType[t];
    if (group.length === 0) continue;
    emit(`  Grouped by gap type — ${t.toUpperCase()}`);
    emit('');
    for (const d of group) {
      emit(`    ${d.label}  [score: ${d.currentScore.toFixed(1)}]  ${STATUS_TAG[d.status] ?? d.status}`);
      emit(`    Proof: ${d.objection.requiredProof}`);
      emit('');
    }
  }
}

function emitRaiseReadiness(r: RaiseReadinessReport, emit: (l: string) => void): void {
  emit('');
  emit(sep('═'));
  emit('  Raise-Readiness Assessment');
  emit(sep('═'));
  emit('');
  emit(`  Overall score:   ${r.overallSelfScore.toFixed(1)} / 10`);
  emit(`  Verdict:         ${r.verdict.toUpperCase()}`);
  emit(`  Raise-ready:     ${r.isRaiseReady ? 'YES' : 'NO'}`);
  emit('');
  emit('  Gap type breakdown:');
  for (const [t, n] of Object.entries(r.gapTypeBreakdown)) {
    if (n > 0) emit(`    ${t.padEnd(16)} ${n} open dimension(s)`);
  }
  emit('');

  if (r.killerObjections.length > 0) {
    emit('  Investor-killing objections:');
    for (const ko of r.killerObjections) {
      emit(`    ${ko.label}  [${ko.gapType}]`);
      emit(`      ${ko.objection}`);
    }
    emit('');
  }

  if (r.fixIn3to7Days.length > 0) {
    emit('  Fixable in 3-7 days:');
    for (const fix of r.fixIn3to7Days) {
      emit(`    ${fix.label}`);
      emit(`      Proof: ${fix.proof}`);
    }
    emit('');
  }

  emit(sep('═'));
}

export async function frontierGap(options: FrontierGapOptions = {}): Promise<void> {
  return withErrorBoundary('frontier-gap', async () => {
    const cwd = options.cwd ?? process.cwd();
    const emit = options._emit ?? logger.info.bind(logger);
    const loadMatrixFn = options._loadMatrix ?? loadMatrix;

    const matrix: CompeteMatrix | null = await loadMatrixFn(cwd);

    if (!matrix) {
      emit('No competitive matrix found.');
      emit('Run `danteforge compete --init` to build one, then re-run `danteforge frontier-gap`.');
      return;
    }

    // Mode: single dimension deep-dive
    if (options.dimension) {
      const d = findDimension(matrix, options.dimension);
      if (!d) {
        emit(`Dimension not found: "${options.dimension}"`);
        emit(`Available IDs: ${matrix.dimensions.map((x) => x.id).join(', ')}`);
        return;
      }
      emitDimensionDeepDive(d, emit);
      return;
    }

    // Mode: raise-readiness
    if (options.raiseReady) {
      const report = buildRaiseReadinessReport(matrix);
      emitRaiseReadiness(report, emit);
      return;
    }

    // Mode: default — top 5 objections + grouped + do-not-work-on
    const report = buildFrontierReport(matrix);

    emit('');
    emit(sep('═'));
    emit(`  DanteForge Frontier Gap Engine — ${matrix.project}`);
    emit(`  Score: ${report.overallSelfScore.toFixed(1)} / 10    Dimensions: ${report.dimensions.length}`);
    emit(sep('═'));

    emitTopObjections(report.topObjections, emit);
    emitGroupedByType(report.dimensions, emit);
    emitDoNotWorkOn(report.doNotWorkOn, emit);

    emit('  Projected score deltas (if top 5 proofs closed):');
    let projectedGain = 0;
    for (const d of report.topObjections) {
      const gain = d.objection.nextJustifiedScore - d.currentScore;
      if (gain > 0) projectedGain += gain;
    }
    emit(`    +${projectedGain.toFixed(1)} total across top 5 dimensions`);
    emit('');
    emit('  Run `danteforge frontier-gap <id>` for a deep-dive on any single dimension.');
    emit('  Run `danteforge frontier-gap --raise-ready` for investor-readiness synthesis.');
    emit('');
  });
}
