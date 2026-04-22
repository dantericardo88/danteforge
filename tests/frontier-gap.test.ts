import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MatrixDimension, CompeteMatrix } from '../src/core/compete-matrix.js';
import {
  classifyGapType,
  classifyFrontierStatus,
  buildRequiredProof,
  buildCurrentClaim,
  computeLeverage,
  computeSeverity,
  computeNextJustifiedScore,
  buildFrontierDimension,
  buildFrontierReport,
  buildRaiseReadinessReport,
  findDimension,
} from '../src/core/frontier-gap-engine.js';
import { frontierGap } from '../src/cli/commands/frontier-gap.js';

// ── Test Fixtures ──────────────────────────────────────────────────────────────

function makeDim(overrides: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id: 'test_dim',
    label: 'Test Dimension',
    weight: 1.0,
    category: 'features',
    frequency: 'medium',
    scores: { self: 5, cursor: 9 },
    gap_to_leader: 4,
    leader: 'Cursor',
    gap_to_closed_source_leader: 4,
    closed_source_leader: 'Cursor',
    gap_to_oss_leader: 2,
    oss_leader: 'Aider',
    status: 'in-progress',
    sprint_history: [],
    next_sprint_target: 7,
    ...overrides,
  };
}

function makeMatrix(overrides: Partial<CompeteMatrix> = {}): CompeteMatrix {
  return {
    project: 'TestProject',
    competitors: ['Cursor', 'Aider'],
    competitors_closed_source: ['Cursor'],
    competitors_oss: ['Aider'],
    lastUpdated: '2026-01-01T00:00:00Z',
    overallSelfScore: 6.5,
    dimensions: [
      makeDim({ id: 'dim1', label: 'Dim 1', scores: { self: 3, cursor: 9 }, gap_to_leader: 6 }),
      makeDim({ id: 'dim2', label: 'Dim 2', scores: { self: 6, cursor: 8 }, gap_to_leader: 2 }),
      makeDim({ id: 'dim3', label: 'Dim 3', scores: { self: 8, cursor: 9 }, gap_to_leader: 1 }),
      makeDim({ id: 'dim4', label: 'Dim 4', scores: { self: 9, cursor: 9 }, gap_to_leader: 0 }),
      makeDim({ id: 'dim5', label: 'Dim 5', scores: { self: 5, cursor: 7 }, gap_to_leader: 2, weight: 1.5 }),
    ],
    ...overrides,
  };
}

// ── classifyGapType ────────────────────────────────────────────────────────────

describe('classifyGapType', () => {
  it('returns capability for large gap with low self score', () => {
    const dim = makeDim({ scores: { self: 2, cursor: 9 }, gap_to_leader: 7 });
    assert.equal(classifyGapType(dim), 'capability');
  });

  it('returns proof for moderate self score with significant gap', () => {
    const dim = makeDim({ scores: { self: 5, cursor: 9 }, gap_to_leader: 4 });
    assert.equal(classifyGapType(dim), 'proof');
  });

  it('returns reliability for decent self score with small gap', () => {
    const dim = makeDim({ scores: { self: 7, cursor: 8 }, gap_to_leader: 1.5 });
    assert.equal(classifyGapType(dim), 'reliability');
  });

  it('returns productization when gap is at most 1', () => {
    const dim = makeDim({ scores: { self: 8, cursor: 9 }, gap_to_leader: 1 });
    assert.equal(classifyGapType(dim), 'productization');
  });

  it('returns productization when self leads or ties', () => {
    const dim = makeDim({ scores: { self: 9, cursor: 9 }, gap_to_leader: 0 });
    assert.equal(classifyGapType(dim), 'productization');
  });
});

// ── classifyFrontierStatus ─────────────────────────────────────────────────────

describe('classifyFrontierStatus', () => {
  it('catch-up for gap > 3', () => {
    const dim = makeDim({ scores: { self: 4, cursor: 9 }, gap_to_leader: 5 });
    assert.equal(classifyFrontierStatus(dim), 'catch-up');
  });

  it('near-frontier for gap 1-3', () => {
    const dim = makeDim({ scores: { self: 6, cursor: 8 }, gap_to_leader: 2 });
    assert.equal(classifyFrontierStatus(dim), 'near-frontier');
  });

  it('frontier-complete for gap <= 0', () => {
    const dim = makeDim({ scores: { self: 8, cursor: 8 }, gap_to_leader: 0 });
    assert.equal(classifyFrontierStatus(dim), 'frontier-complete');
  });

  it('creativity-frontier for score >= 9 and no gap', () => {
    const dim = makeDim({ scores: { self: 9, cursor: 9 }, gap_to_leader: 0 });
    assert.equal(classifyFrontierStatus(dim), 'creativity-frontier');
  });
});

// ── computeSeverity ────────────────────────────────────────────────────────────

describe('computeSeverity', () => {
  it('returns higher severity for larger gaps', () => {
    const big = makeDim({ gap_to_leader: 6 });
    const small = makeDim({ gap_to_leader: 1 });
    assert.ok(computeSeverity(big) > computeSeverity(small));
  });

  it('caps at 10', () => {
    const dim = makeDim({ gap_to_leader: 10 });
    assert.ok(computeSeverity(dim) <= 10);
  });

  it('returns 0 for gap of 0', () => {
    const dim = makeDim({ gap_to_leader: 0 });
    assert.equal(computeSeverity(dim), 0);
  });
});

// ── computeLeverage ────────────────────────────────────────────────────────────

describe('computeLeverage', () => {
  it('higher weight produces higher leverage', () => {
    const a = makeDim({ weight: 1.5, gap_to_leader: 3 });
    const b = makeDim({ weight: 0.5, gap_to_leader: 3 });
    assert.ok(computeLeverage(a, 6) > computeLeverage(b, 6));
  });

  it('returns a non-negative number', () => {
    const dim = makeDim({ gap_to_leader: 5 });
    assert.ok(computeLeverage(dim, 5) >= 0);
  });
});

// ── computeNextJustifiedScore ──────────────────────────────────────────────────

describe('computeNextJustifiedScore', () => {
  it('adds 1 for capability gap', () => {
    const dim = makeDim({ scores: { self: 4, cursor: 9 } });
    assert.equal(computeNextJustifiedScore(dim, 'capability'), 5);
  });

  it('adds 1 for proof gap', () => {
    const dim = makeDim({ scores: { self: 5, cursor: 9 } });
    assert.equal(computeNextJustifiedScore(dim, 'proof'), 6);
  });

  it('adds 0.5 for reliability gap', () => {
    const dim = makeDim({ scores: { self: 7, cursor: 8 } });
    assert.equal(computeNextJustifiedScore(dim, 'reliability'), 7.5);
  });

  it('never exceeds 10', () => {
    const dim = makeDim({ scores: { self: 10, cursor: 10 } });
    assert.ok(computeNextJustifiedScore(dim, 'capability') <= 10);
  });
});

// ── buildCurrentClaim ──────────────────────────────────────────────────────────

describe('buildCurrentClaim', () => {
  it('says production-ready for score >= 8', () => {
    const dim = makeDim({ scores: { self: 8, cursor: 9 } });
    assert.match(buildCurrentClaim(dim), /production-ready/i);
  });

  it('says partially implemented for score < 4', () => {
    const dim = makeDim({ scores: { self: 2, cursor: 9 } });
    assert.match(buildCurrentClaim(dim), /not yet/i);
  });
});

// ── buildRequiredProof ─────────────────────────────────────────────────────────

describe('buildRequiredProof', () => {
  it('returns a non-empty string for each gap type', () => {
    const dim = makeDim();
    const types: import('../src/core/frontier-types.js').GapType[] = ['capability', 'proof', 'reliability', 'productization'];
    for (const t of types) {
      const proof = buildRequiredProof(dim, t);
      assert.ok(proof.length > 10, `proof for ${t} should be non-trivial`);
    }
  });

  it('includes the dimension label in the proof text', () => {
    const dim = makeDim({ label: 'Screen Understanding' });
    const proof = buildRequiredProof(dim, 'proof');
    assert.match(proof, /Screen Understanding/);
  });
});

// ── buildFrontierDimension ─────────────────────────────────────────────────────

describe('buildFrontierDimension', () => {
  it('produces a FrontierDimension with required fields', () => {
    const dim = makeDim();
    const fd = buildFrontierDimension(dim);
    assert.ok(fd.id);
    assert.ok(fd.label);
    assert.ok(fd.objection.text.length > 0);
    assert.ok(['capability', 'proof', 'reliability', 'productization'].includes(fd.objection.gapType));
    assert.ok(['catch-up', 'near-frontier', 'frontier-complete', 'creativity-frontier'].includes(fd.status));
    assert.ok(typeof fd.leverage === 'number');
  });

  it('sets competitorBestScore from scores', () => {
    const dim = makeDim({ scores: { self: 5, cursor: 9, aider: 7 } });
    const fd = buildFrontierDimension(dim);
    assert.equal(fd.competitorBestScore, 9);
  });
});

// ── buildFrontierReport ────────────────────────────────────────────────────────

describe('buildFrontierReport', () => {
  it('returns topObjections with at most 5 items', () => {
    const matrix = makeMatrix();
    const report = buildFrontierReport(matrix);
    assert.ok(report.topObjections.length <= 5);
  });

  it('topObjections are sorted by leverage descending', () => {
    const matrix = makeMatrix();
    const report = buildFrontierReport(matrix);
    for (let i = 1; i < report.topObjections.length; i++) {
      assert.ok(report.topObjections[i - 1]!.leverage >= report.topObjections[i]!.leverage);
    }
  });

  it('includes all dimensions in report', () => {
    const matrix = makeMatrix();
    const report = buildFrontierReport(matrix);
    assert.equal(report.dimensions.length, matrix.dimensions.length);
  });

  it('sets projectName and timestamp', () => {
    const matrix = makeMatrix();
    const report = buildFrontierReport(matrix);
    assert.equal(report.projectName, 'TestProject');
    assert.ok(report.timestamp.length > 0);
  });
});

// ── findDimension ──────────────────────────────────────────────────────────────

describe('findDimension', () => {
  it('finds by exact id', () => {
    const matrix = makeMatrix();
    const fd = findDimension(matrix, 'dim1');
    assert.ok(fd);
    assert.equal(fd!.id, 'dim1');
  });

  it('finds by partial label match', () => {
    const matrix = makeMatrix();
    const fd = findDimension(matrix, 'Dim 2');
    assert.ok(fd);
    assert.equal(fd!.id, 'dim2');
  });

  it('returns null for unknown query', () => {
    const matrix = makeMatrix();
    const fd = findDimension(matrix, 'xyz_nonexistent');
    assert.equal(fd, null);
  });
});

// ── buildRaiseReadinessReport ──────────────────────────────────────────────────

describe('buildRaiseReadinessReport', () => {
  it('returns a verdict', () => {
    const matrix = makeMatrix();
    const report = buildRaiseReadinessReport(matrix);
    assert.ok(['build more', 'validate more', 'harden more', 'package story and raise'].includes(report.verdict));
  });

  it('isRaiseReady only when verdict is "package story and raise"', () => {
    const matrix = makeMatrix();
    const report = buildRaiseReadinessReport(matrix);
    assert.equal(report.isRaiseReady, report.verdict === 'package story and raise');
  });

  it('breakdown sums correctly', () => {
    const matrix = makeMatrix();
    const report = buildRaiseReadinessReport(matrix);
    const total = Object.values(report.gapTypeBreakdown).reduce((a, b) => a + b, 0);
    // Should be <= number of non-closed dimensions
    const nonClosed = matrix.dimensions.filter(
      (d) => d.gap_to_leader > 0,
    ).length;
    assert.ok(total <= nonClosed);
  });

  it('returns "build more" when there are many capability gaps', () => {
    const matrix = makeMatrix({
      overallSelfScore: 4,
      dimensions: [
        makeDim({ id: 'd1', label: 'D1', scores: { self: 2, cursor: 9 }, gap_to_leader: 7 }),
        makeDim({ id: 'd2', label: 'D2', scores: { self: 2, cursor: 9 }, gap_to_leader: 7 }),
        makeDim({ id: 'd3', label: 'D3', scores: { self: 2, cursor: 9 }, gap_to_leader: 7 }),
        makeDim({ id: 'd4', label: 'D4', scores: { self: 2, cursor: 9 }, gap_to_leader: 7 }),
      ],
    });
    const report = buildRaiseReadinessReport(matrix);
    assert.equal(report.verdict, 'build more');
  });
});

// ── frontierGap CLI (integration) ─────────────────────────────────────────────

describe('frontierGap CLI', () => {
  it('emits "no matrix found" when matrix is absent', async () => {
    const lines: string[] = [];
    await frontierGap({
      _emit: (l) => lines.push(l),
      _loadMatrix: async () => null,
    });
    assert.ok(lines.some((l) => /no competitive matrix/i.test(l)));
  });

  it('emits top objections in default mode', async () => {
    const lines: string[] = [];
    await frontierGap({
      _emit: (l) => lines.push(l),
      _loadMatrix: async () => makeMatrix(),
    });
    assert.ok(lines.some((l) => /top skeptic objections/i.test(l)));
  });

  it('emits dimension detail in single-dimension mode', async () => {
    const lines: string[] = [];
    await frontierGap({
      dimension: 'dim1',
      _emit: (l) => lines.push(l),
      _loadMatrix: async () => makeMatrix(),
    });
    assert.ok(lines.some((l) => /current claim/i.test(l)));
    assert.ok(lines.some((l) => /skeptic objection/i.test(l)));
    assert.ok(lines.some((l) => /gap type/i.test(l)));
  });

  it('emits "dimension not found" for unknown id', async () => {
    const lines: string[] = [];
    await frontierGap({
      dimension: 'xyz_unknown',
      _emit: (l) => lines.push(l),
      _loadMatrix: async () => makeMatrix(),
    });
    assert.ok(lines.some((l) => /not found/i.test(l)));
  });

  it('emits raise-readiness report when --raise-ready', async () => {
    const lines: string[] = [];
    await frontierGap({
      raiseReady: true,
      _emit: (l) => lines.push(l),
      _loadMatrix: async () => makeMatrix(),
    });
    assert.ok(lines.some((l) => /raise-readiness/i.test(l)));
    assert.ok(lines.some((l) => /verdict/i.test(l)));
  });

  it('emits projected score deltas in default mode', async () => {
    const lines: string[] = [];
    await frontierGap({
      _emit: (l) => lines.push(l),
      _loadMatrix: async () => makeMatrix(),
    });
    assert.ok(lines.some((l) => /projected score delta/i.test(l)));
  });

  it('emits grouped-by-type output in default mode', async () => {
    const lines: string[] = [];
    await frontierGap({
      _emit: (l) => lines.push(l),
      _loadMatrix: async () => makeMatrix(),
    });
    // Should have at least one gap type header
    const hasGroupHeader = lines.some((l) =>
      /capability|proof|reliability|productization/i.test(l),
    );
    assert.ok(hasGroupHeader);
  });
});
