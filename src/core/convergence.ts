// Convergence — tracks self-improvement progress across harvest-forge cycles
// Stored at .danteforge/convergence.json — persists across process restarts.

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DimensionScore {
  /** Dimension name, e.g. "circuit-breaker-reliability" */
  dimension: string;
  /** Current evidence-based score (0-10) */
  score: number;
  /** Files or signals that justify the score */
  evidence: string[];
  /** Historical score values, oldest first */
  scoreHistory: number[];
  /** true when score >= target AND last 2 scores are within 0.1 of each other */
  converged: boolean;
}

export interface CycleRecord {
  cycle: number;
  timestamp: string;
  adoptionsAttempted: number;
  adoptionsSucceeded: number;
  scoresBefore: Record<string, number>;
  scoresAfter: Record<string, number>;
  costUsd: number;
}

export interface ConvergenceState {
  version: '1.0.0';
  /** Target score for all dimensions (default 9.0) */
  targetScore: number;
  dimensions: DimensionScore[];
  cycleHistory: CycleRecord[];
  /** Index of the last completed cycle */
  lastCycle: number;
  /** Running total cost across all cycles */
  totalCostUsd: number;
  startedAt: string;
  lastUpdatedAt: string;
  /**
   * Pattern names successfully adopted in prior cycles.
   * Fed into oss-intel LLM prompts so it never re-suggests already-adopted work.
   */
  adoptedPatternsSummary: string[];
  /**
   * Most recent objective quality metrics snapshot.
   * Machine-verifiable signals that cannot be gamed by the LLM scoring oracle.
   */
  latestObjectiveMetrics?: import('./objective-metrics.js').ObjectiveMetrics;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

const CONVERGENCE_FILENAME = 'convergence.json';

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

// ── Load / Save ───────────────────────────────────────────────────────────────

/** Load convergence state. Returns a fresh state if the file does not exist. */
export async function loadConvergence(cwd?: string): Promise<ConvergenceState> {
  const filePath = path.join(getDanteforgeDir(cwd), CONVERGENCE_FILENAME);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ConvergenceState;
    // Back-compat: files written before adoptedPatternsSummary was added
    return { ...parsed, adoptedPatternsSummary: parsed.adoptedPatternsSummary ?? [] };
  } catch {
    return initConvergence(9.0);
  }
}

/** Persist convergence state. Updates `lastUpdatedAt`. */
export async function saveConvergence(state: ConvergenceState, cwd?: string): Promise<void> {
  const danteforgeDir = getDanteforgeDir(cwd);
  const filePath = path.join(danteforgeDir, CONVERGENCE_FILENAME);
  const toSave: ConvergenceState = { ...state, lastUpdatedAt: new Date().toISOString() };
  try {
    await fs.mkdir(danteforgeDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(toSave, null, 2), 'utf8');
  } catch {
    // best-effort — failure is non-fatal
  }
}

// ── Initialisation ────────────────────────────────────────────────────────────

/** Create a fresh convergence state with no history. */
export function initConvergence(targetScore: number): ConvergenceState {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    targetScore,
    dimensions: [],
    cycleHistory: [],
    lastCycle: 0,
    totalCostUsd: 0,
    startedAt: now,
    lastUpdatedAt: now,
    adoptedPatternsSummary: [],
  };
}

/**
 * Record that a pattern was successfully adopted this cycle.
 * Idempotent — calling twice with the same name is a no-op.
 */
export function recordAdoption(state: ConvergenceState, patternName: string): ConvergenceState {
  if (state.adoptedPatternsSummary.includes(patternName)) return state;
  return { ...state, adoptedPatternsSummary: [...state.adoptedPatternsSummary, patternName] };
}

// ── Mutation helpers (pure) ───────────────────────────────────────────────────

/**
 * Record or update a dimension score.
 * Appends to `scoreHistory` and recomputes `converged`.
 */
export function updateDimension(
  state: ConvergenceState,
  dimension: string,
  score: number,
  evidence: string[] = [],
): ConvergenceState {
  const existing = state.dimensions.find(d => d.dimension === dimension);
  const scoreHistory = existing
    ? [...existing.scoreHistory, score]
    : [score];
  const converged = isConvergedDimension(scoreHistory, score, state.targetScore);

  const updated: DimensionScore = {
    dimension,
    score,
    evidence,
    scoreHistory,
    converged,
  };

  return {
    ...state,
    dimensions: existing
      ? state.dimensions.map(d => (d.dimension === dimension ? updated : d))
      : [...state.dimensions, updated],
  };
}

/**
 * Returns true when ALL tracked dimensions are converged.
 * A dimension converges when: score >= target AND the last 2 scores are within 0.1.
 * Dimensions with fewer than 2 history entries are NOT considered converged.
 */
export function isFullyConverged(state: ConvergenceState): boolean {
  if (state.dimensions.length === 0) return false;
  return state.dimensions.every(d => d.converged);
}

/**
 * Returns true when the last `windowSize` (default 3) cycles produced
 * a total score improvement of less than 0.5.
 * Returns false when there are fewer cycles than the window size.
 */
export function detectPlateau(
  state: ConvergenceState,
  windowSize = 3,
  opts: {
    /**
     * Attribution mode: plateau is measured in adoption-events, not cycles.
     * When true, windowSize refers to the last (windowSize × adoptionsPerCycle) entries
     * in dimension scoreHistory rather than cycle-level history.
     * This prevents false plateaus when 3 small adoptions each move score by 0.1.
     */
    attributionMode?: boolean;
    adoptionsPerCycle?: number;
  } = {},
): boolean {
  if (opts.attributionMode) {
    // In attribution mode, look at per-dimension score histories instead of cycle records.
    // A plateau is when ALL dimensions improved less than 0.5 across the last N adoptions.
    const adoptionsPerCycle = opts.adoptionsPerCycle ?? 3;
    const lookback = windowSize * adoptionsPerCycle;
    let totalImprovement = 0;
    let hasHistory = false;

    for (const dim of state.dimensions) {
      const history = dim.scoreHistory ?? [];
      if (history.length < 2) continue;
      hasHistory = true;
      const slice = history.slice(-Math.min(lookback, history.length));
      const first = slice[0] ?? 0;
      const last = slice[slice.length - 1] ?? 0;
      totalImprovement += last - first;
    }

    if (!hasHistory) return false;
    return totalImprovement < 0.5;
  }

  const history = state.cycleHistory;
  if (history.length < windowSize) return false;

  const window = history.slice(-windowSize);
  let totalImprovement = 0;

  for (const cycle of window) {
    const before = Object.values(cycle.scoresBefore);
    const after = Object.values(cycle.scoresAfter);
    if (before.length === 0) continue;

    const avgBefore = before.reduce((a, b) => a + b, 0) / before.length;
    const avgAfter = after.reduce((a, b) => a + b, 0) / after.length;
    totalImprovement += avgAfter - avgBefore;
  }

  return totalImprovement < 0.5;
}

/**
 * Render an ASCII progress chart for all tracked dimensions, with sparklines.
 * Example line: [circuit-breaker     ] ██████████░░░░░░ 7.5 → 9.0  ▁▃▅▇▇ (trend)
 */
export function renderConvergenceChart(state: ConvergenceState): string {
  if (state.dimensions.length === 0) return '  (no dimensions tracked yet)';

  const maxLabel = Math.max(...state.dimensions.map(d => d.dimension.length), 10);
  const barWidth = 16;

  return state.dimensions
    .map(d => {
      const label = d.dimension.padEnd(maxLabel);
      const filled = Math.round((d.score / 10) * barWidth);
      const empty = barWidth - filled;
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
      const status = d.converged ? ' ✓ CONVERGED' : ` → ${state.targetScore.toFixed(1)}`;
      const sparkline = renderSparkline(d.scoreHistory);
      const sparkSuffix = sparkline ? `  ${sparkline}` : '';
      return `  [${label}] ${bar} ${d.score.toFixed(1)}${status}${sparkSuffix}`;
    })
    .join('\n');
}

/**
 * Render a compact sparkline for a series of score values (0-10).
 * Uses 8-level block chars: ▁▂▃▄▅▆▇█
 * Returns empty string if fewer than 2 data points.
 */
export function renderSparkline(history: number[]): string {
  if (history.length < 2) return '';
  const BLOCKS = '▁▂▃▄▅▆▇█';
  // Show last 8 values so sparkline stays compact
  const recent = history.slice(-8);
  return recent
    .map(v => {
      const level = Math.min(7, Math.max(0, Math.round((v / 10) * 7)));
      return BLOCKS[level];
    })
    .join('');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isConvergedDimension(
  scoreHistory: number[],
  latestScore: number,
  targetScore: number,
): boolean {
  if (scoreHistory.length < 2) return false;
  if (latestScore < targetScore) return false;
  const prev = scoreHistory[scoreHistory.length - 2]!;
  return Math.abs(latestScore - prev) <= 0.1;
}
