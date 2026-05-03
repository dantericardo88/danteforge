// measure — Unified quality measurement: all scores in one consistent view.
// Single command replacing: assess, score, quality, maturity, benchmark, retro, self-assess.
//
// --level light    → filesystem metrics only, no LLM, <5s
// --level standard → score + maturity + quality bars + causal narrative (default)
// --level deep     → everything + retro delta + nextStep recommendation
//
// JSON output always uses the same measure.v1 schema regardless of --level.

import { logger } from '../../core/logger.js';
import { KNOWN_CEILINGS } from '../../core/compete-matrix.js';
import { getMaturityLevelName } from '../../core/maturity-levels.js';
import type { HarshScoreResult, ScoringDimension } from '../../core/harsh-scorer.js';
import chalk from 'chalk';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MEASURE_SCHEMA_VERSION = 'measure.v1';

// The 8 core builder dimensions — always shown, always on the same 0-10 scale.
const BUILDER_DIMS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
];

const DIM_LABELS: Record<string, string> = {
  functionality:  'Functionality',
  testing:        'Testing',
  errorHandling:  'Error Handling',
  security:       'Security',
  uxPolish:       'UX / CLI Polish',
  documentation:  'Documentation',
  performance:    'Performance',
  maintainability:'Maintainability',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MeasureDimension {
  name: string;
  score: number;
  ceiling?: number;
  gap?: number;
}

export interface MeasureResult {
  schemaVersion: typeof MEASURE_SCHEMA_VERSION;
  level: 'light' | 'standard' | 'deep';
  timestamp: string;
  overallScore: number;
  maturity: string;
  dimensions: MeasureDimension[];
  gaps: string[];
  nextStep?: string;
  certHash?: string;
}

export interface MeasureOptions {
  level?: 'light' | 'standard' | 'deep';
  json?: boolean;
  certify?: boolean;
  compare?: string;
  cwd?: string;
  /** Injection seam — override scorer for testing */
  _computeScore?: (cwd: string) => Promise<HarshScoreResult>;
  /** Injection seam — override causal narrative for testing */
  _calibrationNarrative?: () => string[];
  /** Injection seam — override retro delta for testing */
  _retroDelta?: () => Promise<string | undefined>;
  _stdout?: (line: string) => void;
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function scoreBar(score: number, width = 10, isTTY = true): string {
  const filled = Math.round((score / 10) * width);
  const empty = width - filled;
  if (!isTTY) return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
  const color = score >= 9 ? chalk.green : score >= 7 ? chalk.yellow : chalk.red;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

function verdictBadge(score: number): string {
  if (score >= 9.0) return chalk.green('excellent');
  if (score >= 8.0) return chalk.green('good');
  if (score >= 7.0) return chalk.yellow('solid');
  if (score >= 5.0) return chalk.yellow('developing');
  return chalk.red('needs attention');
}

// ── Build MeasureResult from HarshScoreResult ─────────────────────────────────

function buildResult(
  scoreResult: HarshScoreResult,
  level: 'light' | 'standard' | 'deep',
  nextStep: string | undefined,
  certHash: string | undefined,
): MeasureResult {
  const dims = scoreResult.displayDimensions;
  const maturityLevel = scoreResult.maturityAssessment?.currentLevel;
  const maturityName = maturityLevel !== undefined
    ? getMaturityLevelName(maturityLevel)
    : 'Unknown';

  const dimensions: MeasureDimension[] = BUILDER_DIMS.map((name) => {
    const score = dims[name] ?? 0;
    const ceilingEntry = KNOWN_CEILINGS[name as keyof typeof KNOWN_CEILINGS];
    const ceiling = ceilingEntry?.ceiling;
    const gap = ceiling !== undefined && score < ceiling
      ? parseFloat((ceiling - score).toFixed(1))
      : score < 10
        ? parseFloat((10 - score).toFixed(1))
        : undefined;
    return { name, score, ...(ceiling !== undefined ? { ceiling } : {}), ...(gap !== undefined ? { gap } : {}) };
  });

  const gaps = dimensions
    .filter((d) => d.score < 7.0)
    .sort((a, b) => a.score - b.score)
    .map((d) => `${DIM_LABELS[d.name] ?? d.name}: ${d.score.toFixed(1)}/10`);

  return {
    schemaVersion: MEASURE_SCHEMA_VERSION,
    level,
    timestamp: new Date().toISOString(),
    overallScore: scoreResult.displayScore,
    maturity: maturityName,
    dimensions,
    gaps,
    ...(nextStep !== undefined ? { nextStep } : {}),
    ...(certHash !== undefined ? { certHash } : {}),
  };
}

// ── Causal narrative ──────────────────────────────────────────────────────────

async function defaultCalibrationNarrative(): Promise<string[]> {
  try {
    const { computeCalibrationNarrative } = await import('./causal-status.js');
    const { loadCausalWeightMatrix } = await import('../../core/causal-weight-matrix.js');
    const matrix = await loadCausalWeightMatrix();
    return computeCalibrationNarrative(matrix);
  } catch {
    return [];
  }
}

// ── Retro delta ───────────────────────────────────────────────────────────────

async function defaultRetroDelta(cwd: string): Promise<string | undefined> {
  try {
    const { retro } = await import('./retro.js');
    const lines: string[] = [];
    const capture = (l: string) => lines.push(l);
    await retro({ cwd, _stdout: capture } as Parameters<typeof retro>[0]);
    const deltaLine = lines.find((l) => l.includes('delta') || l.includes('Delta') || l.includes('change') || l.includes('Change'));
    return deltaLine?.trim();
  } catch {
    return undefined;
  }
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function measure(options: MeasureOptions = {}): Promise<MeasureResult> {
  const emit = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const cwd = options.cwd ?? process.cwd();
  const level = options.level ?? 'standard';
  const isTTY = process.stdout.isTTY ?? false;

  const computeScoreFn = options._computeScore ?? (async (dir: string) => {
    const { computeHarshScore } = await import('../../core/harsh-scorer.js');
    return computeHarshScore({ cwd: dir });
  });

  // ── Score ──────────────────────────────────────────────────────────────────
  let scoreResult: HarshScoreResult;
  try {
    scoreResult = await computeScoreFn(cwd);
  } catch (err) {
    logger.error(`measure: scoring failed — ${String(err)}`);
    throw err;
  }

  // ── Causal narrative (standard+deep only) ─────────────────────────────────
  let narrative: string[] = [];
  if (level !== 'light') {
    const narrativeFn = options._calibrationNarrative
      ? (): Promise<string[]> => Promise.resolve(options._calibrationNarrative!())
      : defaultCalibrationNarrative;
    narrative = await narrativeFn();
  }

  // ── Retro delta (deep only) ───────────────────────────────────────────────
  let retroLine: string | undefined;
  if (level === 'deep') {
    const retroFn = options._retroDelta
      ? () => Promise.resolve(options._retroDelta!())
      : () => defaultRetroDelta(cwd);
    retroLine = await retroFn();
  }

  // ── Next step recommendation ───────────────────────────────────────────────
  const dims = scoreResult.displayDimensions;
  const worstDim = BUILDER_DIMS
    .map((n) => ({ name: n, score: dims[n] ?? 0 }))
    .sort((a, b) => a.score - b.score)[0];

  const nextStep = level === 'deep' && worstDim
    ? `danteforge autoforge "${DIM_LABELS[worstDim.name] ?? worstDim.name}" — currently ${worstDim.score.toFixed(1)}/10`
    : undefined;

  // ── Certify ───────────────────────────────────────────────────────────────
  let certHash: string | undefined;
  if (options.certify) {
    const fingerprint = [
      scoreResult.displayScore.toFixed(2),
      new Date().toISOString().slice(0, 10),
      ...BUILDER_DIMS.map((n) => `${n}:${(dims[n] ?? 0).toFixed(2)}`),
    ].join('|');
    certHash = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
  }

  const result = buildResult(scoreResult, level, nextStep, certHash);

  // ── Output ────────────────────────────────────────────────────────────────
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }

  // Text output
  emit('');
  emit(chalk.bold('  ══════════════════════════════════════════════════'));
  emit(chalk.bold('    DanteForge — Quality Measurement'));
  emit(chalk.bold('  ══════════════════════════════════════════════════'));
  emit('');
  emit(`  Level:   ${level}`);
  emit(`  Score:   ${chalk.bold(result.overallScore.toFixed(1) + '/10')}  ${verdictBadge(result.overallScore)}`);
  emit(`  Maturity: ${result.maturity}`);
  emit('');

  // Dimension bars
  emit('  Builder dimensions:');
  emit('');
  for (const dim of result.dimensions) {
    const label = (DIM_LABELS[dim.name] ?? dim.name).padEnd(18);
    const bar = scoreBar(dim.score, 10, isTTY);
    const scoreStr = `${dim.score.toFixed(1)}/10`;
    const ceilStr = dim.ceiling !== undefined ? chalk.gray(` [ceil ${dim.ceiling.toFixed(0)}]`) : '';
    emit(`    ${label} ${bar} ${scoreStr}${ceilStr}`);
  }
  emit('');

  if (result.gaps.length > 0) {
    emit(`  P0 gaps (below 7.0):`);
    for (const g of result.gaps) emit(`    • ${g}`);
    emit('');
  }

  // Causal narrative (standard+deep)
  if (narrative.length > 0) {
    emit('  Predictor calibration:');
    for (const line of narrative) emit(line);
    emit('');
  }

  // Retro delta (deep)
  if (retroLine) {
    emit(`  Retro: ${retroLine}`);
    emit('');
  }

  // Next step (deep)
  if (result.nextStep) {
    emit(`  Recommended next step:`);
    emit(`    ${chalk.cyan(result.nextStep)}`);
    emit('');
  }

  if (result.certHash) {
    emit(`  Certificate: ${chalk.gray(result.certHash)}`);
    emit('');
  }

  // Write cert to file when --certify
  if (options.certify && result.certHash) {
    try {
      const certPath = path.join(cwd, '.danteforge', 'measure-cert.json');
      await fs.mkdir(path.dirname(certPath), { recursive: true });
      await fs.writeFile(certPath, JSON.stringify({ ...result }, null, 2) + '\n', 'utf8');
      emit(chalk.dim(`  Certificate written to .danteforge/measure-cert.json`));
    } catch {
      // best-effort
    }
  }

  emit('  ══════════════════════════════════════════════════');
  emit('');

  return result;
}
