// quality — CLI-native quality scorecard: dimension bars, P0 gaps, ceilings, next action.
// Faster than `score --full`: no LLM calls. Pure filesystem read + harsh scorer.
// Usage: danteforge quality

import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { KNOWN_CEILINGS } from '../../core/compete-matrix.js';
import type { HarshScoreResult, ScoringDimension } from '../../core/harsh-scorer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QualityOptions {
  cwd?: string;
  // Injection seams
  _computeScore?: (cwd: string) => Promise<HarshScoreResult>;
  _stdout?: (line: string) => void;
  _isTTY?: boolean;
}

// ── Dimension labels ──────────────────────────────────────────────────────────

const DIM_LABELS: Record<string, string> = {
  functionality:          'Functionality',
  testing:                'Testing / TDD',
  errorHandling:          'Error Handling',
  security:               'Security',
  developerExperience:    'Developer Experience',
  autonomy:               'Autonomy',
  maintainability:        'Maintainability',
  performance:            'Performance',
  documentation:          'Documentation',
  uxPolish:               'UX / CLI Polish',
  planningQuality:        'Planning Quality',
  selfImprovement:        'Self-Improvement',
  specDrivenPipeline:     'Spec-Driven Pipeline',
  convergenceSelfHealing: 'Convergence / Self-Healing',
  tokenEconomy:           'Token Economy',
  enterpriseReadiness:    'Enterprise Readiness',
  mcpIntegration:         'MCP Integration',
  communityAdoption:      'Community Adoption',
};

// ── Rendering helpers ─────────────────────────────────────────────────────────

function scoreBar(score: number, width = 10, isTTY = true): string {
  const filled = Math.round((score / 10) * width);
  const empty = width - filled;
  if (!isTTY) {
    return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
  }
  const color = score >= 9 ? chalk.green : score >= 7 ? chalk.yellow : chalk.red;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

function verdictLabel(score: number, isTTY = true): string {
  const labels: [number, string, (s: string) => string][] = [
    [9.0, 'excellent',  chalk.green],
    [8.0, 'good',       chalk.green],
    [7.0, 'needs-work', chalk.yellow],
    [5.0, 'developing', chalk.yellow],
    [0,   'critical',   chalk.red],
  ];
  for (const [threshold, label, colorFn] of labels) {
    if (score >= threshold) return isTTY ? colorFn(label) : label;
  }
  return 'critical';
}

function ceilingLabel(dimId: string): string | null {
  return KNOWN_CEILINGS[dimId]?.reason ?? null;
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderScorecard(result: HarshScoreResult, emit: (l: string) => void, isTTY: boolean): void {
  const score = result.displayScore;
  const dims = result.displayDimensions ?? {} as Record<ScoringDimension, number>;

  const sep = isTTY ? chalk.gray('  ─────────────────────────────────────────────') : '  ─────────────────────────────────────────────';

  emit('');
  emit(isTTY ? chalk.bold('  DanteForge  —  Quality Scorecard') : '  DanteForge  —  Quality Scorecard');
  emit(sep);
  emit('');
  emit(`  Overall  ${isTTY ? chalk.bold(score.toFixed(1) + '/10') : score.toFixed(1) + '/10'}  ${verdictLabel(score, isTTY)}`);
  emit('');

  // All dimensions sorted by score ascending (worst first)
  const dimEntries = Object.entries(dims)
    .filter(([id]) => id !== 'communityAdoption')  // excluded per product positioning
    .sort(([, a], [, b]) => a - b);

  if (dimEntries.length > 0) {
    emit('  Dimensions:');
    const nameWidth = 26;

    for (const [dimId, dimScore] of dimEntries) {
      const label = (DIM_LABELS[dimId] ?? dimId).padEnd(nameWidth);
      const bar   = scoreBar(dimScore, 10, isTTY);
      const num   = dimScore.toFixed(1).padStart(4);

      const ceilingReason = ceilingLabel(dimId);
      let suffix = '';
      if (ceilingReason) {
        suffix = isTTY ? chalk.gray('  ⚠ ceiling') : '  ⚠ ceiling';
      } else if (dimScore < 7.0) {
        suffix = isTTY ? chalk.yellow('  ← P0') : '  <- P0';
      } else if (dimScore >= 9.0) {
        suffix = isTTY ? chalk.green('  ✓') : '  OK';
      }

      emit(`    ${label}  ${bar}  ${isTTY ? chalk.bold(num) : num}${suffix}`);
    }
    emit('');
  }

  // Ceiling dimensions (communityAdoption excluded per product positioning)
  const ceilingEntries = Object.entries(KNOWN_CEILINGS)
    .filter(([id]) => id !== 'communityAdoption');
  if (ceilingEntries.length > 0) {
    const hdr = isTTY ? chalk.gray('  ⚠  Automation ceilings') : '  Automation ceilings';
    emit(hdr);
    for (const [dimId, { ceiling, reason }] of ceilingEntries) {
      const label = DIM_LABELS[dimId] ?? dimId;
      const self = (dims[dimId as ScoringDimension] ?? ceiling).toFixed(1);
      emit(`     ${label.padEnd(26)}  ${self}/10  →  ${reason}`);
    }
    emit('');
  }

  // P0 gaps — exclude ceiling dims (can't fix via forge) and communityAdoption
  const ceilingIds = new Set(ceilingEntries.map(([id]) => id));
  const p0 = dimEntries.filter(([id, v]) => v < 7.0 && !ceilingIds.has(id)).slice(0, 3);
  if (p0.length > 0) {
    const hdr = isTTY ? chalk.yellow('  P0 gaps — recommended next actions:') : '  P0 gaps — recommended next actions:';
    emit(hdr);
    for (const [dimId, dimScore] of p0) {
      const label = DIM_LABELS[dimId] ?? dimId;
      const cmd   = `danteforge forge "Improve ${label}"`;
      emit(`     ${label.padEnd(26)}  ${dimScore.toFixed(1)}/10  →  ${isTTY ? chalk.cyan(cmd) : cmd}`);
    }
    emit('');
  } else {
    emit('  All tracked dimensions at 7.0+.');
    emit(`  Next:  ${isTTY ? chalk.cyan('danteforge ascend') : 'danteforge ascend'}  to push further toward 9.0.`);
    emit('');
  }

  emit(sep);
  emit('');
}

// ── Default score loader ──────────────────────────────────────────────────────

async function defaultComputeScore(cwd: string): Promise<HarshScoreResult> {
  const { computeHarshScore } = await import('../../core/harsh-scorer.js');
  return computeHarshScore({ cwd });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function quality(options: QualityOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const isTTY = options._isTTY ?? (process.stdout.isTTY === true);
  const computeScoreFn = options._computeScore ?? defaultComputeScore;

  try {
    const result = await computeScoreFn(cwd);
    renderScorecard(result, emit, isTTY);
  } catch (err) {
    logger.error(`quality: ${err instanceof Error ? err.message : String(err)}`);
    logger.info('Run `danteforge init` to set up your project first.');
    process.exitCode = 1;
  }
}
