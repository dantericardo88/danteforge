import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGapReport,
  buildReferenceSnapshot,
  formatGapReport,
} from '../src/core/gap-report.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDim(id: string, scores: Record<string, number>, opts: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id,
    label: opts.label ?? id,
    weight: opts.weight ?? 1.0,
    category: 'quality',
    frequency: 'medium',
    scores,
    gap_to_leader: 0,
    leader: '',
    gap_to_closed_source_leader: 0,
    closed_source_leader: '',
    gap_to_oss_leader: 0,
    oss_leader: '',
    status: 'in-progress',
    sprint_history: [],
    next_sprint_target: 9,
    ...opts,
  } as MatrixDimension;
}

function makeMatrix(dims: MatrixDimension[], opts: Partial<CompeteMatrix> = {}): CompeteMatrix {
  return {
    project: 'DanteForge',
    competitors: opts.competitors ?? ['Aider', 'Cursor'],
    competitors_oss: opts.competitors_oss ?? ['Aider'],
    competitors_closed_source: opts.competitors_closed_source ?? ['Cursor'],
    lastUpdated: '2026-05-29T00:00:00Z',
    overallSelfScore: opts.overallSelfScore ?? 0,
    dimensions: dims,
    ...opts,
  } as CompeteMatrix;
}

// ── Gap sign + position ─────────────────────────────────────────────────────

describe('computeGapReport — signed gaps', () => {
  it('reports a positive gap when DanteForge leads the best competitor', () => {
    const m = makeMatrix([makeDim('autonomy', { self: 9.0, Aider: 6.0, Cursor: 7.8 })]);
    const r = computeGapReport(m);
    assert.equal(r.dims.length, 1);
    assert.equal(r.dims[0]!.overall.leader, 'Cursor');
    assert.equal(r.dims[0]!.overall.leaderScore, 7.8);
    assert.equal(r.dims[0]!.overall.gap, 1.2, 'self 9.0 − best 7.8 = +1.2');
    assert.equal(r.ahead, 1);
    assert.equal(r.behind, 0);
  });

  it('reports a negative gap when DanteForge trails the best competitor', () => {
    const m = makeMatrix([makeDim('ecosystem_mcp', { self: 6.0, Aider: 6.8, Cursor: 5.0 })]);
    const r = computeGapReport(m);
    assert.equal(r.dims[0]!.overall.gap, -0.8, 'self 6.0 − best 6.8 = -0.8');
    assert.equal(r.behind, 1);
    assert.equal(r.ahead, 0);
  });

  it('splits OSS vs closed-source gaps', () => {
    const m = makeMatrix([makeDim('testing', { self: 7.0, Aider: 5.0, Cursor: 8.5 })]);
    const r = computeGapReport(m);
    assert.equal(r.dims[0]!.oss.leader, 'Aider');
    assert.equal(r.dims[0]!.oss.gap, 2.0, 'ahead of OSS by 2.0');
    assert.equal(r.dims[0]!.closed.leader, 'Cursor');
    assert.equal(r.dims[0]!.closed.gap, -1.5, 'behind closed-source by 1.5');
  });
});

// ── Effective score (the honesty hook) ──────────────────────────────────────

describe('computeGapReport — uses effective (min self,derived) not raw self', () => {
  it('a dim claimed at 9 but with derived 5 reports the 5-based gap', () => {
    const m = makeMatrix([makeDim('security', { self: 9.0, derived: 5.0, Aider: 6.0, Cursor: 6.0 })]);
    const r = computeGapReport(m);
    assert.equal(r.dims[0]!.effectiveSelf, 5.0, 'effective = min(9, 5) = 5');
    assert.equal(r.dims[0]!.overall.gap, -1.0, 'honest gap: 5 − 6 = -1.0, not 9 − 6 = +3');
  });
});

// ── Weighting + exclusion ────────────────────────────────────────────────────

describe('computeGapReport — net position weighting and exclusion', () => {
  it('net position is the weighted mean of signed gaps', () => {
    const m = makeMatrix([
      makeDim('a', { self: 8.0, Aider: 6.0 }, { weight: 3.0 }), // gap +2.0, weight 3
      makeDim('b', { self: 5.0, Aider: 7.0 }, { weight: 1.0 }), // gap -2.0, weight 1
    ]);
    const r = computeGapReport(m);
    // (3*2.0 + 1*-2.0) / 4 = 4/4 = +1.0
    assert.equal(r.netPositionOverall, 1.0);
  });

  it('drops excluded and zero-weight dimensions', () => {
    const m = makeMatrix(
      [
        makeDim('keep', { self: 8.0, Aider: 6.0 }),
        makeDim('excluded_dim', { self: 9.0, Aider: 1.0 }),
        makeDim('zero', { self: 9.0, Aider: 1.0 }, { weight: 0 }),
      ],
      { excludedDimensions: ['excluded_dim'] },
    );
    const r = computeGapReport(m);
    assert.equal(r.dimCount, 1);
    assert.equal(r.dims[0]!.id, 'keep');
  });

  it('sorts most-behind first', () => {
    const m = makeMatrix([
      makeDim('ahead', { self: 9.0, Aider: 6.0 }),
      makeDim('behind', { self: 4.0, Aider: 8.0 }),
    ]);
    const r = computeGapReport(m);
    assert.equal(r.dims[0]!.id, 'behind', 'most-behind dim leads the report');
  });

  it('handles a dim with no competitor scored (gap = effective self)', () => {
    const m = makeMatrix([makeDim('novel', { self: 7.0 })], { competitors: ['Aider'], competitors_oss: ['Aider'], competitors_closed_source: [] });
    const r = computeGapReport(m);
    assert.equal(r.dims[0]!.overall.leader, '');
    assert.equal(r.dims[0]!.overall.gap, 7.0, 'no competitor → gap is the full self score');
  });
});

// ── Reference snapshot ───────────────────────────────────────────────────────

describe('buildReferenceSnapshot', () => {
  it('freezes competitor scores + rubric shape, excludes self/derived', () => {
    const m = makeMatrix([
      makeDim('a', { self: 8.0, derived: 7.0, Aider: 6.0, Cursor: 7.5 }, { ceiling: 9.0, weight: 2.0 }),
    ]);
    const snap = buildReferenceSnapshot(m, '2026-05-29T12:00:00Z', 'abc123');
    assert.equal(snap.capturedAt, '2026-05-29T12:00:00Z');
    assert.equal(snap.gitSha, 'abc123');
    assert.equal(snap.dims.length, 1);
    assert.equal(snap.dims[0]!.ceiling, 9.0);
    assert.equal(snap.dims[0]!.weight, 2.0);
    // The anchor: competitor scores only, never self/derived.
    assert.deepEqual(snap.dims[0]!.competitorScores, { Aider: 6.0, Cursor: 7.5 });
    assert.equal(snap.dims[0]!.competitorScores['self'], undefined);
    assert.equal(snap.dims[0]!.competitorScores['derived'], undefined);
  });

  it('omits excluded dims from the frozen reference set', () => {
    const m = makeMatrix(
      [makeDim('keep', { self: 8.0, Aider: 6.0 }), makeDim('drop', { self: 9.0, Aider: 1.0 })],
      { excludedDimensions: ['drop'] },
    );
    const snap = buildReferenceSnapshot(m, '2026-05-29T12:00:00Z', null);
    assert.equal(snap.dims.length, 1);
    assert.equal(snap.dims[0]!.id, 'keep');
    assert.equal(snap.gitSha, null);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────────

describe('formatGapReport', () => {
  it('leads with net position, not the absolute score', () => {
    const m = makeMatrix([makeDim('a', { self: 8.0, Aider: 6.0 })], { overallSelfScore: 8.9 });
    const out = formatGapReport(computeGapReport(m));
    assert.match(out, /Net position vs field:\s+\+2\.0/);
    assert.match(out, /absolute self score: 8\.9/);
    // The self-policing reminder must be present.
    assert.match(out, /inflating the rubric inflates the competitors/);
  });
});
