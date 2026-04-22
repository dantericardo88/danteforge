// Chart — Convergence history sparklines.
// Shows ASCII sparklines of quality score trends per dimension using Unicode block chars.

import { loadConvergence, type ConvergenceState, type CycleRecord } from '../../core/convergence.js';
import { logger } from '../../core/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChartOptions {
  cwd?: string;
  dimension?: string;
  cycles?: number;
  _loadConvergence?: (cwd?: string) => Promise<ConvergenceState | null>;
}

export interface TrendResult {
  delta: number;
  arrow: '▲' | '▼' | '─';
}

// ── Sparkline rendering ───────────────────────────────────────────────────────

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Convert a score (0-10) to a sparkline character.
 * Score 0 → '▁', score 10 → '█'.
 */
function scoreToChar(score: number): string {
  const clamped = Math.max(0, Math.min(10, score));
  const index = Math.min(
    SPARK_CHARS.length - 1,
    Math.floor((clamped / 10) * SPARK_CHARS.length),
  );
  return SPARK_CHARS[index];
}

/**
 * Render a sequence of 0-10 scores as a Unicode sparkline string.
 * Pure function — exported for testing.
 */
export function renderSparkline(scores: number[]): string {
  if (scores.length === 0) return '─';
  return scores.map(scoreToChar).join('');
}

/**
 * Compute trend between first and last score in the array.
 * Pure function — exported for testing.
 */
export function computeTrend(scores: number[]): TrendResult {
  if (scores.length < 2) {
    return { delta: 0, arrow: '─' };
  }
  const delta = Math.round((scores[scores.length - 1] - scores[0]) * 100) / 100;
  const arrow: '▲' | '▼' | '─' = delta > 0 ? '▲' : delta < 0 ? '▼' : '─';
  return { delta, arrow };
}

// ── Score extraction ──────────────────────────────────────────────────────────

/**
 * Extract per-dimension score histories from cycle records.
 * Each CycleRecord has scoresAfter: Record<string, number>.
 * Returns a map of dimension → ordered score array (oldest first).
 */
function extractDimensionHistories(
  cycles: CycleRecord[],
  maxCycles: number,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const window = cycles.slice(-maxCycles);

  for (const cycle of window) {
    for (const [dim, score] of Object.entries(cycle.scoresAfter)) {
      const arr = map.get(dim) ?? [];
      arr.push(score);
      map.set(dim, arr);
    }
  }

  return map;
}

/**
 * Supplement cycle history with current dimension scores when history is sparse.
 * For dimensions that appear in state.dimensions but not in cycleHistory,
 * use scoreHistory from the DimensionScore record.
 */
function mergeWithDimensionScoreHistory(
  state: ConvergenceState,
  historyMap: Map<string, number[]>,
  maxCycles: number,
): Map<string, number[]> {
  for (const dim of state.dimensions) {
    if (!historyMap.has(dim.dimension)) {
      const hist = dim.scoreHistory.slice(-maxCycles);
      if (hist.length > 0) {
        historyMap.set(dim.dimension, hist);
      } else if (dim.score > 0) {
        // At minimum, show the current score as a single-point sparkline
        historyMap.set(dim.dimension, [dim.score]);
      }
    }
  }
  return historyMap;
}

// ── Chart rendering ───────────────────────────────────────────────────────────

/**
 * Build the full chart string for a set of dimension histories.
 */
function renderChart(
  historyMap: Map<string, number[]>,
  cycleCount: number,
): string {
  if (historyMap.size === 0) {
    return '── Convergence Chart ─────────────────────────────────────────\n(no data)';
  }

  const header = `── Convergence Chart (last ${cycleCount} cycles) ──────────────────────────`;

  // Compute column widths
  const dimNames = [...historyMap.keys()];
  const maxDimLen = Math.max(...dimNames.map((d) => d.length), 12);

  const rows = dimNames
    .map((dim) => {
      const scores = historyMap.get(dim) ?? [];
      const sparkline = renderSparkline(scores);
      const lastScore = scores.length > 0 ? scores[scores.length - 1] : 0;
      const trend = computeTrend(scores);
      const trendStr =
        trend.arrow === '─'
          ? '─  0.0'
          : `${trend.arrow}${trend.delta > 0 ? '+' : ''}${trend.delta.toFixed(1)}`;

      return `${dim.padEnd(maxDimLen)}  ${sparkline}  ${lastScore.toFixed(1)} ${trendStr}`;
    })
    .sort(); // alphabetical for stable output

  return [header, ...rows].join('\n');
}

// ── Intelligence Compound Rate ────────────────────────────────────────────────

/**
 * Compute the Intelligence Compound Rate (ICR): how much smarter the system is
 * getting per cycle, measured in score-points per cycle per adopted pattern.
 *
 * ICR = (total score improvement) / (total cycles) × (patterns adopted / total cycles)
 *
 * A higher ICR means the system is learning more efficiently over time.
 * ICR > 0.5 indicates compounding — each cycle is more effective than the last.
 * Pure function — exported for testing.
 */
export function computeCompoundRate(state: ConvergenceState): number {
  const cycles = state.lastCycle;
  if (cycles === 0) return 0;

  const adoptedCount = state.adoptedPatternsSummary?.length ?? 0;
  if (adoptedCount === 0) return 0;

  // Total score improvement across all dimensions
  const totalImprovement = state.dimensions.reduce((sum, dim) => {
    const history = dim.scoreHistory;
    if (history.length < 2) return sum;
    return sum + (dim.score - history[0]!);
  }, 0);

  const avgImprovementPerCycle = totalImprovement / cycles;
  const patternsPerCycle = adoptedCount / cycles;

  // ICR: normalized improvement rate weighted by adoption efficiency
  return Math.max(0, avgImprovementPerCycle * patternsPerCycle);
}

/**
 * Render the compound rate as a human-readable label.
 * Pure function — exported for testing.
 */
export function renderCompoundRate(rate: number): string {
  if (rate === 0) return 'ICR: N/A (no cycles yet)';
  if (rate >= 1.0) return `ICR: ${rate.toFixed(2)} ★ compounding fast`;
  if (rate >= 0.5) return `ICR: ${rate.toFixed(2)} ↑ compounding`;
  if (rate >= 0.1) return `ICR: ${rate.toFixed(2)} → improving`;
  return `ICR: ${rate.toFixed(2)} ↓ slow (more patterns needed)`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runChart(options: ChartOptions = {}): Promise<string> {
  const { cwd, dimension, cycles = 20 } = options;
  const loadConv = options._loadConvergence ?? loadConvergence;

  let state: ConvergenceState | null = null;
  try {
    state = await loadConv(cwd);
  } catch {
    state = null;
  }

  if (!state || (state.dimensions.length === 0 && state.cycleHistory.length === 0)) {
    const msg =
      '── Convergence Chart ─────────────────────────────────────────\n' +
      '(no convergence data found — run `forge` or `assess` first)';
    logger.info(msg);
    return msg;
  }

  // Build history from cycle records, supplemented by dimension.scoreHistory
  let historyMap = extractDimensionHistories(state.cycleHistory, cycles);
  historyMap = mergeWithDimensionScoreHistory(state, historyMap, cycles);

  // Filter to requested dimension if specified
  if (dimension !== undefined && dimension !== '') {
    const filtered = new Map<string, number[]>();
    for (const [dim, scores] of historyMap) {
      if (dim === dimension || dim.toLowerCase().includes(dimension.toLowerCase())) {
        filtered.set(dim, scores);
      }
    }
    if (filtered.size === 0) {
      const msg = `(no data for dimension "${dimension}")`;
      logger.info(msg);
      return msg;
    }
    historyMap = filtered;
  }

  const chart = renderChart(historyMap, cycles);
  const icr = computeCompoundRate(state);
  const icrLabel = renderCompoundRate(icr);
  const output = `${chart}\n${icrLabel}`;
  logger.info(output);
  return output;
}
