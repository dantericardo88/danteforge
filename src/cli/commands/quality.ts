// quality — CLI-native quality scorecard: dimension bars, P0 gaps, ceilings, next action.
// Faster than `score --full`: no LLM calls. Pure filesystem read + harsh scorer.
// Usage: danteforge quality [--baseline] [--save-baseline]

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { KNOWN_CEILINGS } from '../../core/compete-matrix.js';
import type { HarshScoreResult, ScoringDimension } from '../../core/harsh-scorer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QualityBaseline {
  savedAt: string;
  overallScore: number;
  dimensions: Record<string, number>;
}

export interface BaselineDiff {
  dimension: string;
  label: string;
  baseline: number;
  current: number;
  delta: number;
}

export interface QualityOptions {
  cwd?: string;
  json?: boolean;
  /**
   * Compare current scores against a saved baseline in
   * `.danteforge/quality-baseline.json`.  Emits a diff table.
   */
  baseline?: boolean;
  /**
   * Save the current scores as the new baseline to
   * `.danteforge/quality-baseline.json`.
   */
  saveBaseline?: boolean;
  // Injection seams
  _computeScore?: (cwd: string) => Promise<HarshScoreResult>;
  _stdout?: (line: string) => void;
  _isTTY?: boolean;
  /** Injected fs.readFile for testing (mirrors node:fs/promises signature). */
  _readFile?: (p: string, enc: 'utf8') => Promise<string>;
  /** Injected fs.writeFile for testing. */
  _writeFile?: (p: string, data: string) => Promise<void>;
  /** Injected fs.mkdir for testing. */
  _mkdir?: (p: string, opts: { recursive: true }) => Promise<string | undefined>;
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

// ── Baseline I/O ──────────────────────────────────────────────────────────────

function baselinePath(cwd: string): string {
  return path.join(cwd, '.danteforge', 'quality-baseline.json');
}

async function loadBaseline(
  cwd: string,
  readFile: (p: string, enc: 'utf8') => Promise<string>,
): Promise<QualityBaseline | null> {
  try {
    const raw = await readFile(baselinePath(cwd), 'utf8');
    return JSON.parse(raw) as QualityBaseline;
  } catch {
    return null;
  }
}

async function saveBaseline(
  cwd: string,
  result: HarshScoreResult,
  writeFile: (p: string, data: string) => Promise<void>,
  mkdir: (p: string, opts: { recursive: true }) => Promise<string | undefined>,
): Promise<void> {
  const bl: QualityBaseline = {
    savedAt: new Date().toISOString(),
    overallScore: result.displayScore,
    dimensions: { ...(result.displayDimensions ?? {}) } as Record<string, number>,
  };
  const p = baselinePath(cwd);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(bl, null, 2));
}

function buildBaselineDiff(
  current: Record<string, number>,
  baseline: QualityBaseline,
): BaselineDiff[] {
  const allIds = new Set([...Object.keys(current), ...Object.keys(baseline.dimensions)]);
  const diffs: BaselineDiff[] = [];
  for (const id of allIds) {
    if (id === 'communityAdoption') continue;
    const cur = current[id] ?? 0;
    const base = baseline.dimensions[id] ?? 0;
    diffs.push({ dimension: id, label: DIM_LABELS[id] ?? id, baseline: base, current: cur, delta: cur - base });
  }
  diffs.sort((a, b) => a.delta - b.delta); // worst regressions first
  return diffs;
}

function renderBaselineDiff(
  diffs: BaselineDiff[],
  currentScore: number,
  bl: QualityBaseline,
  emit: (l: string) => void,
  isTTY: boolean,
): void {
  const sep = isTTY
    ? chalk.gray('  ─────────────────────────────────────────────')
    : '  ─────────────────────────────────────────────';

  emit('');
  emit(isTTY ? chalk.bold('  Quality Baseline Comparison') : '  Quality Baseline Comparison');
  emit(sep);

  const overallDelta = currentScore - bl.overallScore;
  const deltaStr = (overallDelta >= 0 ? '+' : '') + overallDelta.toFixed(1);
  const deltaColored = isTTY
    ? (overallDelta >= 0 ? chalk.green(deltaStr) : chalk.red(deltaStr))
    : deltaStr;
  emit(`  Baseline saved: ${new Date(bl.savedAt).toLocaleString()}`);
  emit(`  Overall:  ${bl.overallScore.toFixed(1)} → ${currentScore.toFixed(1)}  (${deltaColored})`);
  emit('');

  if (diffs.length > 0) {
    emit('  Dimension changes:');
    const nameW = 26;
    for (const d of diffs) {
      const label = d.label.padEnd(nameW);
      const delta = (d.delta >= 0 ? '+' : '') + d.delta.toFixed(1);
      const deltaC = isTTY
        ? (d.delta > 0 ? chalk.green(delta) : d.delta < 0 ? chalk.red(delta) : chalk.gray(delta))
        : delta;
      emit(`    ${label}  ${d.baseline.toFixed(1)} → ${d.current.toFixed(1)}  ${deltaC}`);
    }
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

export function buildQualityJson(result: HarshScoreResult): string {
  const dims = result.displayDimensions ?? {};
  const p0 = Object.entries(dims)
    .filter(([, v]) => v < 7.0)
    .map(([id, v]) => ({ id, score: v, label: DIM_LABELS[id] ?? id }));

  return JSON.stringify({
    overallScore: result.displayScore,
    verdict: result.verdict ?? 'unknown',
    dimensions: dims,
    p0Gaps: p0,
    penalties: result.penalties?.length ?? 0,
    badgeMarkdown: `![DanteForge Quality](https://img.shields.io/badge/quality-${result.displayScore.toFixed(1)}%2F10-${result.displayScore >= 9 ? 'brightgreen' : result.displayScore >= 7 ? 'yellow' : 'red'})`,
    timestamp: result.timestamp ?? new Date().toISOString(),
  }, null, 2);
}

export async function quality(options: QualityOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const isTTY = options._isTTY ?? (process.stdout.isTTY === true);
  const computeScoreFn = options._computeScore ?? defaultComputeScore;

  // Injected FS helpers (default to real node:fs/promises)
  const readFileFn = options._readFile ?? ((p: string, enc: 'utf8') => fs.readFile(p, enc));
  const writeFileFn = options._writeFile ?? ((p: string, data: string) => fs.writeFile(p, data));
  const mkdirFn = options._mkdir ?? ((p: string, opts: { recursive: true }) => fs.mkdir(p, opts));

  try {
    const result = await computeScoreFn(cwd);
    const dims = (result.displayDimensions ?? {}) as Record<string, number>;

    // --save-baseline: persist current scores then return
    if (options.saveBaseline) {
      await saveBaseline(cwd, result, writeFileFn, mkdirFn);
      emit(`Baseline saved to .danteforge/quality-baseline.json  (overall: ${result.displayScore.toFixed(1)}/10)`);
      return;
    }

    if (options.json) {
      emit(buildQualityJson(result));
    } else {
      renderScorecard(result, emit, isTTY);

      // --baseline: load saved baseline and show diff after the scorecard
      if (options.baseline) {
        const bl = await loadBaseline(cwd, readFileFn);
        if (!bl) {
          emit(isTTY
            ? chalk.yellow('  No quality baseline found. Run: danteforge quality --save-baseline')
            : '  No quality baseline found. Run: danteforge quality --save-baseline');
          emit('');
        } else {
          const diffs = buildBaselineDiff(dims, bl);
          renderBaselineDiff(diffs, result.displayScore, bl, emit, isTTY);
        }
      }
    }
  } catch (err) {
    logger.error(`quality: ${err instanceof Error ? err.message : String(err)}`);
    logger.info('Run `danteforge init` to set up your project first.');
    process.exitCode = 1;
  }
}
