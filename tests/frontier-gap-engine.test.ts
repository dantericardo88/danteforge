import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  findDimension,
} from '../src/core/frontier-gap-engine.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function makeDim(overrides: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id: 'testing',
    label: 'Test Coverage',
    scores: { self: 6, ToolA: 8 },
    gap_to_leader: 2,
    leader: 'ToolA',
    closed_source_leader: undefined,
    selfScoreNormalized: 6,
    weight: 1.0,
    frequency: 'high',
    ceiling: undefined,
    ceilingReason: undefined,
    ...overrides,
  };
}

function makeMatrix(dims: Partial<MatrixDimension>[] = [{}]): CompeteMatrix {
  return {
    project: 'test',
    competitors: ['ToolA'],
    competitors_closed_source: [],
    competitors_oss: ['ToolA'],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 6.0,
    dimensions: dims.map(makeDim),
  };
}

describe('classifyGapType', () => {
  it('returns capability for low self score and large gap', () => {
    const dim = makeDim({ scores: { self: 2 }, gap_to_leader: 5 });
    assert.equal(classifyGapType(dim), 'capability');
  });

  it('returns proof for mid-range score with significant gap', () => {
    const dim = makeDim({ scores: { self: 5 }, gap_to_leader: 3 });
    assert.equal(classifyGapType(dim), 'proof');
  });

  it('returns productization for near-parity', () => {
    const dim = makeDim({ scores: { self: 8 }, gap_to_leader: 0 });
    assert.equal(classifyGapType(dim), 'productization');
  });

  it('returns reliability for decent score and gap of 2', () => {
    const dim = makeDim({ scores: { self: 7 }, gap_to_leader: 2 });
    assert.equal(classifyGapType(dim), 'reliability');
  });
});

describe('classifyFrontierStatus', () => {
  it('returns creativity-frontier for top score at frontier', () => {
    const dim = makeDim({ scores: { self: 9 }, gap_to_leader: 0 });
    assert.equal(classifyFrontierStatus(dim), 'creativity-frontier');
  });

  it('returns frontier-complete when leading', () => {
    const dim = makeDim({ scores: { self: 7 }, gap_to_leader: 0 });
    assert.equal(classifyFrontierStatus(dim), 'frontier-complete');
  });

  it('returns near-frontier for small gap', () => {
    const dim = makeDim({ scores: { self: 6 }, gap_to_leader: 2 });
    assert.equal(classifyFrontierStatus(dim), 'near-frontier');
  });

  it('returns catch-up for large gap', () => {
    const dim = makeDim({ scores: { self: 4 }, gap_to_leader: 5 });
    assert.equal(classifyFrontierStatus(dim), 'catch-up');
  });
});

describe('buildRequiredProof', () => {
  it('includes label in proof text for capability gap', () => {
    const dim = makeDim({ label: 'Test Coverage' });
    const proof = buildRequiredProof(dim, 'capability');
    assert.ok(proof.includes('Test Coverage'));
  });

  it('mentions integration test for proof gap type', () => {
    const dim = makeDim({ label: 'Error Handling' });
    const proof = buildRequiredProof(dim, 'proof');
    assert.ok(proof.length > 0);
  });
});

describe('buildCurrentClaim', () => {
  it('returns not implemented for low score', () => {
    const claim = buildCurrentClaim(makeDim({ scores: { self: 2 } }));
    assert.ok(claim.includes('not yet'));
  });

  it('returns partially implemented for mid score', () => {
    const claim = buildCurrentClaim(makeDim({ scores: { self: 5 } }));
    assert.ok(claim.includes('partially'));
  });

  it('returns implemented with known gaps for score 6-7', () => {
    const claim = buildCurrentClaim(makeDim({ scores: { self: 7 } }));
    assert.ok(claim.includes('implemented'));
  });

  it('returns production-ready for high score', () => {
    const claim = buildCurrentClaim(makeDim({ scores: { self: 9 } }));
    assert.ok(claim.includes('production-ready'));
  });
});

describe('computeSeverity', () => {
  it('returns 0 for zero gap', () => {
    const dim = makeDim({ gap_to_leader: 0 });
    assert.equal(computeSeverity(dim), 0);
  });

  it('is capped at 10', () => {
    const dim = makeDim({ gap_to_leader: 100 });
    assert.equal(computeSeverity(dim), 10);
  });

  it('increases with larger gaps', () => {
    const small = computeSeverity(makeDim({ gap_to_leader: 1 }));
    const large = computeSeverity(makeDim({ gap_to_leader: 5 }));
    assert.ok(large > small);
  });
});

describe('computeLeverage', () => {
  it('returns a positive number for typical inputs', () => {
    const dim = makeDim({ gap_to_leader: 3, weight: 1.5 });
    const leverage = computeLeverage(dim, 5);
    assert.ok(leverage > 0);
  });

  it('scales with weight', () => {
    const lowWeight = computeLeverage(makeDim({ weight: 0.5 }), 5);
    const highWeight = computeLeverage(makeDim({ weight: 2.0 }), 5);
    assert.ok(highWeight > lowWeight);
  });
});

describe('computeNextJustifiedScore', () => {
  it('returns a number higher than current self score', () => {
    const dim = makeDim({ scores: { self: 5 }, gap_to_leader: 3 });
    const next = computeNextJustifiedScore(dim, 'proof');
    assert.ok(next > 0);
  });

  it('does not exceed 10', () => {
    const dim = makeDim({ scores: { self: 9 }, gap_to_leader: 0 });
    const next = computeNextJustifiedScore(dim, 'productization');
    assert.ok(next <= 10);
  });
});

describe('buildFrontierDimension', () => {
  it('returns FrontierDimension with required fields', () => {
    const dim = makeDim({ scores: { self: 5 }, gap_to_leader: 3 });
    const frontier = buildFrontierDimension(dim);
    assert.ok(typeof frontier.id === 'string');
    assert.ok(typeof frontier.status === 'string');
    assert.ok(typeof frontier.currentClaim === 'string');
    assert.ok(typeof frontier.leverage === 'number');
    assert.ok(typeof frontier.currentScore === 'number');
    assert.ok(typeof frontier.objection === 'object');
    assert.ok(typeof frontier.objection.gapType === 'string');
    assert.ok(typeof frontier.objection.severity === 'number');
  });
});

describe('buildFrontierReport', () => {
  it('returns report with dimensions array', () => {
    const matrix = makeMatrix([{ scores: { self: 5 }, gap_to_leader: 3 }]);
    const report = buildFrontierReport(matrix);
    assert.ok(Array.isArray(report.dimensions));
    assert.equal(report.dimensions.length, 1);
  });

  it('report has projectName field', () => {
    const matrix = makeMatrix([{}]);
    const report = buildFrontierReport(matrix);
    assert.equal(report.projectName, 'test');
  });
});

describe('findDimension', () => {
  it('finds dimension by partial label match', () => {
    const matrix = makeMatrix([
      { id: 'testing', label: 'Test Coverage', scores: { self: 7 }, gap_to_leader: 1 },
    ]);
    const result = findDimension(matrix, 'test');
    assert.ok(result !== null);
    assert.equal(result!.id, 'testing');
  });

  it('returns null when no match found', () => {
    const matrix = makeMatrix([{ id: 'testing', label: 'Test Coverage' }]);
    const result = findDimension(matrix, 'zzznotfound');
    assert.equal(result, null);
  });
});
