// gap-report.ts — Gap-first (relative) scoring report.
//
// The debiasing thesis (council-endorsed, 2026-05-29): an absolute self-score is
// self-referential and gameable — inflating your own rubric inflates the number.
// A GAP against competitors scored on the IDENTICAL rubric is self-policing,
// because the same rubric inflation also inflates every competitor you measure
// with it. So the honest headline is not "8.9 / 10" but the per-dimension gap
// vs the best competitor, plus a net position.
//
// Critical: the "self" side of every gap uses effectiveDimScore (min(self, derived)),
// NOT raw scores.self — so evidence caps flow straight into the reported gap. A dim
// the agent claims at 9 but whose evidence only supports 5 shows the 5-based gap.
//
// This module is pure (no fs, no Date) so it is fully testable. The CLI command
// owns disk I/O and timestamping for the reference-set snapshot.

import type { CompeteMatrix, MatrixDimension } from './compete-matrix.js';
import { effectiveDimScore } from './compete-matrix-score.js';

// ── Types ───────────────────────────────────────────────────────────────────

/** Best competitor within a named set, plus the signed gap vs effective self. */
export interface CompetitorGap {
  /** Competitor with the highest score in this set ('' if none scored). */
  leader: string;
  /** That competitor's score (0 if none). */
  leaderScore: number;
  /** Signed gap = effectiveSelf − leaderScore. Positive = DanteForge ahead. */
  gap: number;
}

/** Per-dimension relative standing. */
export interface DimGap {
  id: string;
  label: string;
  weight: number;
  /** Honest self score: min(self, derived). */
  effectiveSelf: number;
  /** Gap vs the best of ALL actual competitors (closed + oss). */
  overall: CompetitorGap;
  /** Gap vs the best OSS competitor. */
  oss: CompetitorGap;
  /** Gap vs the best closed-source competitor. */
  closed: CompetitorGap;
}

/** The full gap-first report. */
export interface GapReport {
  /** Per-dimension gaps, sorted most-behind first. */
  dims: DimGap[];
  /** Weighted mean of signed overall gaps. Positive = net ahead of the field. */
  netPositionOverall: number;
  /** Weighted mean of signed gaps vs OSS leaders. */
  netPositionOss: number;
  /** Weighted mean of signed gaps vs closed-source leaders. */
  netPositionClosed: number;
  /** The legacy absolute weighted self score, retained for context only. */
  absoluteSelfScore: number;
  /** Count of dims where DanteForge is at or ahead of the best competitor. */
  ahead: number;
  /** Count of dims where DanteForge trails the best competitor. */
  behind: number;
  /** Number of dimensions included (excluded + zero-weight dims dropped). */
  dimCount: number;
}

/** A frozen snapshot of the competitor reference set + rubric shape, for drift detection. */
export interface ReferenceSnapshot {
  /** ISO timestamp — stamped by the caller (this module never reads the clock). */
  capturedAt: string;
  /** Git SHA at capture time, if known. */
  gitSha: string | null;
  /** The actual competitor rosters this snapshot anchors against. */
  competitors_oss: string[];
  competitors_closed_source: string[];
  /** Per-dimension frozen rubric shape + the competitor scores that anchor it. */
  dims: Array<{
    id: string;
    weight: number;
    ceiling?: number;
    /** Competitor name → score, at capture time. The anchor that makes drift visible. */
    competitorScores: Record<string, number>;
  }>;
}

// ── Computation ─────────────────────────────────────────────────────────────

const NON_COMPETITOR_KEYS = new Set(['self', 'derived']);

function bestIn(scores: Record<string, number>, names: string[], effectiveSelf: number): CompetitorGap {
  let leader = '';
  let leaderScore = 0;
  for (const name of names) {
    if (NON_COMPETITOR_KEYS.has(name)) continue;
    const s = scores[name];
    if (typeof s === 'number' && s > leaderScore) {
      leaderScore = s;
      leader = name;
    }
  }
  return { leader, leaderScore, gap: round1(effectiveSelf - leaderScore) };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isIncluded(dim: MatrixDimension, excluded: Set<string>): boolean {
  return !excluded.has(dim.id) && (dim.weight ?? 0) > 0;
}

/**
 * Compute the gap-first report from a matrix. Pure — no I/O.
 * Excluded and zero-weight dimensions are dropped (they don't count toward position).
 */
export function computeGapReport(matrix: CompeteMatrix): GapReport {
  const excluded = new Set(matrix.excludedDimensions ?? []);
  const oss = matrix.competitors_oss ?? [];
  const closed = matrix.competitors_closed_source ?? [];
  const allActual = matrix.competitors ?? [...closed, ...oss];

  const included = matrix.dimensions.filter(d => isIncluded(d, excluded));

  const dims: DimGap[] = included.map(dim => {
    const effectiveSelf = round1(effectiveDimScore(dim));
    return {
      id: dim.id,
      label: dim.label ?? dim.id,
      weight: dim.weight,
      effectiveSelf,
      overall: bestIn(dim.scores, allActual, effectiveSelf),
      oss: bestIn(dim.scores, oss, effectiveSelf),
      closed: bestIn(dim.scores, closed, effectiveSelf),
    };
  });

  // Sort most-behind first so the report leads with where we're losing.
  dims.sort((a, b) => a.overall.gap - b.overall.gap);

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0) || 1;
  const weightedMean = (pick: (d: DimGap) => number): number =>
    round1(dims.reduce((s, d) => s + d.weight * pick(d), 0) / totalWeight);

  const ahead = dims.filter(d => d.overall.gap >= 0).length;

  return {
    dims,
    netPositionOverall: weightedMean(d => d.overall.gap),
    netPositionOss: weightedMean(d => d.oss.gap),
    netPositionClosed: weightedMean(d => d.closed.gap),
    absoluteSelfScore: round1(matrix.overallSelfScore ?? 0),
    ahead,
    behind: dims.length - ahead,
    dimCount: dims.length,
  };
}

/**
 * Freeze the competitor reference set + rubric shape. The caller stamps `capturedAt`
 * and `gitSha` (this module never reads the clock or git, to stay pure/testable).
 */
export function buildReferenceSnapshot(
  matrix: CompeteMatrix,
  capturedAt: string,
  gitSha: string | null,
): ReferenceSnapshot {
  const excluded = new Set(matrix.excludedDimensions ?? []);
  return {
    capturedAt,
    gitSha,
    competitors_oss: matrix.competitors_oss ?? [],
    competitors_closed_source: matrix.competitors_closed_source ?? [],
    dims: matrix.dimensions
      .filter(d => isIncluded(d, excluded))
      .map(d => {
        const competitorScores: Record<string, number> = {};
        for (const [name, score] of Object.entries(d.scores)) {
          if (!NON_COMPETITOR_KEYS.has(name)) competitorScores[name] = score;
        }
        return { id: d.id, weight: d.weight, ceiling: d.ceiling, competitorScores };
      }),
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function sign(n: number): string {
  return n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

function arrow(gap: number): string {
  if (gap > 0.05) return '▲';
  if (gap < -0.05) return '▼';
  return '=';
}

/**
 * Render the gap-first report as a plain string (no chalk — callers colorize).
 * The headline is the NET POSITION, not the absolute score.
 */
export function formatGapReport(report: GapReport): string {
  const lines: string[] = [];
  lines.push('=== DanteForge — Gap-First Position (vs competitors on the identical rubric) ===');
  lines.push('');
  lines.push(`Net position vs field:        ${sign(report.netPositionOverall)}  (weighted, ${report.dimCount} dims)`);
  lines.push(`Net position vs OSS leaders:  ${sign(report.netPositionOss)}`);
  lines.push(`Net position vs closed-src:   ${sign(report.netPositionClosed)}`);
  lines.push(`Ahead on ${report.ahead} dims · behind on ${report.behind} dims`);
  lines.push(`(context only — absolute self score: ${report.absoluteSelfScore.toFixed(1)}/10)`);
  lines.push('');
  lines.push('Per-dimension gap vs best competitor (most-behind first):');
  lines.push('');

  const idW = Math.max(12, ...report.dims.map(d => d.id.length));
  const head = `  ${'dimension'.padEnd(idW)}  self   best-competitor                gap`;
  lines.push(head);
  lines.push(`  ${'-'.repeat(idW)}  ----   -----------------------------  -----`);
  for (const d of report.dims) {
    const comp = d.overall.leader
      ? `${d.overall.leader} (${d.overall.leaderScore.toFixed(1)})`
      : '(none scored)';
    lines.push(
      `  ${d.id.padEnd(idW)}  ${d.effectiveSelf.toFixed(1).padStart(4)}   ${comp.padEnd(29)}  ${sign(d.overall.gap)} ${arrow(d.overall.gap)}`,
    );
  }
  lines.push('');
  lines.push('A gap is self-policing: inflating the rubric inflates the competitors too.');
  return lines.join('\n');
}
