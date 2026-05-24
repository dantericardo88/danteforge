import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkHaltStuckDim,
  checkRefuseOnDispensation,
  checkRefuseNewDims,
  checkHaltInfiniteRefinement,
  checkReportEndState,
  applyAutonomyRules,
  recordDimProgress,
  recordDimNoProgress,
  recordOutcomeRefinement,
  clearOutcomeRefinement,
  MAX_STUCK_WAVES,
  MAX_OUTCOME_REFINEMENTS,
} from '../src/matrix/engines/crusade-autonomy.js';
import type { DanteState } from '../src/core/state.js';
import type { ProjectFrontierState, DimensionFrontierResult } from '../src/core/frontier-state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test',
    constitution: undefined,
    currentPhase: 0,
    workflowStage: 'forge',
    lastHandoff: undefined,
    auditLog: [],
    tasks: {},
    ...overrides,
  } as DanteState;
}

function makeDimResult(overrides: Partial<DimensionFrontierResult>): DimensionFrontierResult {
  return {
    dimensionId: 'test',
    status: 'progressing',
    derivedScore: 5,
    highestPassedTier: 'T1',
    declaredCeiling: 'T2',
    conditions: { allCeilingOutcomesPass: false, noActiveDispensation: true, productionUsageFreshOrLowTier: true },
    wavesSinceProgress: 0,
    reason: 'progressing',
    ...overrides,
  };
}

function makeFrontier(perDim: DimensionFrontierResult[], terminal: ProjectFrontierState['terminal']): ProjectFrontierState {
  return {
    terminal,
    perDimension: perDim,
    stuckDims: perDim.filter(d => d.status === 'stuck').map(d => d.dimensionId),
    blockingDispensations: perDim.filter(d => d.status === 'blocked-by-dispensation').map(d => d.dimensionId),
    summary: `${perDim.length} dim(s)`,
  };
}

// ── Rule R1: halt-stuck-dim ──────────────────────────────────────────────────

describe('checkHaltStuckDim', () => {
  it('proceeds when no dim has reached the stuck threshold', () => {
    const v = checkHaltStuckDim({
      state: makeState({ wavesSinceProgress: { a: 1, b: 2 } }),
      frontier: makeFrontier([], 'progressing'),
      cwd: '/p',
    });
    assert.equal(v.kind, 'proceed');
  });

  it('halts when at least one dim reaches MAX_STUCK_WAVES', () => {
    const v = checkHaltStuckDim({
      state: makeState({ wavesSinceProgress: { a: 1, b: MAX_STUCK_WAVES } }),
      frontier: makeFrontier([], 'progressing'),
      cwd: '/p',
    });
    assert.equal(v.kind, 'halt');
    if (v.kind === 'halt') {
      assert.equal(v.rule, 'R1.halt-stuck-dim');
      assert.deepEqual(v.affectedDims, ['b']);
    }
  });

  it('lists all stuck dims', () => {
    const v = checkHaltStuckDim({
      state: makeState({ wavesSinceProgress: { a: 5, b: 4, c: 1 } }),
      frontier: makeFrontier([], 'progressing'),
      cwd: '/p',
    });
    if (v.kind !== 'halt') throw new Error('expected halt');
    assert.deepEqual(v.affectedDims?.sort(), ['a', 'b']);
  });
});

// ── Rule R2: refuse-on-dispensation ──────────────────────────────────────────

describe('checkRefuseOnDispensation', () => {
  it('proceeds when frontier terminal is not blocked', () => {
    const v = checkRefuseOnDispensation({
      state: makeState(),
      frontier: makeFrontier([], 'progressing'),
      cwd: '/p',
    });
    assert.equal(v.kind, 'proceed');
  });

  it('halts when frontier terminal is blocked-by-dispensations', () => {
    const dim = makeDimResult({ status: 'blocked-by-dispensation', dimensionId: 'security' });
    const v = checkRefuseOnDispensation({
      state: makeState(),
      frontier: { ...makeFrontier([dim], 'blocked-by-dispensations'), blockingDispensations: ['receipt-1'] },
      cwd: '/p',
    });
    assert.equal(v.kind, 'halt');
    if (v.kind === 'halt') {
      assert.equal(v.rule, 'R2.refuse-on-dispensation');
      assert.match(v.reason, /1 active dispensation/);
    }
  });
});

// ── Rule R3: refuse-new-dims ─────────────────────────────────────────────────

describe('checkRefuseNewDims', () => {
  it('proceeds when no new dim is being requested', () => {
    const v = checkRefuseNewDims({
      state: makeState(),
      frontier: makeFrontier([], 'progressing'),
      cwd: '/p',
    });
    assert.equal(v.kind, 'proceed');
  });

  it('proceeds when every declared dim is at frontier', () => {
    const dim = makeDimResult({ status: 'at-frontier' });
    const v = checkRefuseNewDims({
      state: makeState(),
      frontier: makeFrontier([dim], 'frontier-reached'),
      newDimId: 'fancy_new_dim',
      cwd: '/p',
    });
    assert.equal(v.kind, 'proceed');
  });

  it('halts when at least one declared dim is not at frontier', () => {
    const a = makeDimResult({ dimensionId: 'a', status: 'at-frontier' });
    const b = makeDimResult({ dimensionId: 'b', status: 'progressing' });
    const v = checkRefuseNewDims({
      state: makeState(),
      frontier: makeFrontier([a, b], 'progressing'),
      newDimId: 'fancy_new_dim',
      cwd: '/p',
    });
    assert.equal(v.kind, 'halt');
    if (v.kind === 'halt') {
      assert.equal(v.rule, 'R3.refuse-new-dims');
      assert.deepEqual(v.affectedDims, ['b']);
    }
  });

  it('ignores no-outcomes-declared dims when deciding whether to allow new dims', () => {
    const a = makeDimResult({ dimensionId: 'a', status: 'at-frontier' });
    const b = makeDimResult({ dimensionId: 'b', status: 'no-outcomes-declared' });
    const v = checkRefuseNewDims({
      state: makeState(),
      frontier: makeFrontier([a, b], 'progressing'),
      newDimId: 'fancy_new_dim',
      cwd: '/p',
    });
    assert.equal(v.kind, 'proceed', 'undeclared dims do not block new additions');
  });
});

// ── Rule R4: halt-infinite-refinement ────────────────────────────────────────

describe('checkHaltInfiniteRefinement', () => {
  it('proceeds when no outcome has been refined too many times', () => {
    const v = checkHaltInfiniteRefinement({
      state: makeState({ outcomeRefinementCounts: { 'a/x': 1, 'b/y': 2 } }),
      frontier: makeFrontier([], 'progressing'),
      cwd: '/p',
    });
    assert.equal(v.kind, 'proceed');
  });

  it('halts when an outcome has been refined MAX_REFINEMENTS times', () => {
    const v = checkHaltInfiniteRefinement({
      state: makeState({ outcomeRefinementCounts: { 'security/test-strict': MAX_OUTCOME_REFINEMENTS } }),
      frontier: makeFrontier([], 'progressing'),
      cwd: '/p',
    });
    assert.equal(v.kind, 'halt');
    if (v.kind === 'halt') {
      assert.equal(v.rule, 'R4.halt-infinite-refinement');
      assert.deepEqual(v.affectedDims, ['security']);
    }
  });
});

// ── Rule R5: report-end-state ────────────────────────────────────────────────

describe('checkReportEndState', () => {
  it('proceeds when not at frontier', () => {
    const v = checkReportEndState({
      state: makeState(),
      frontier: makeFrontier([], 'progressing'),
      cwd: '/p',
    });
    assert.equal(v.kind, 'proceed');
  });

  it('returns frontier-reached when terminal is frontier-reached', () => {
    const v = checkReportEndState({
      state: makeState(),
      frontier: makeFrontier([makeDimResult({ status: 'at-frontier' })], 'frontier-reached'),
      cwd: '/p',
    });
    assert.equal(v.kind, 'frontier-reached');
  });
});

// ── applyAutonomyRules (the aggregator) ──────────────────────────────────────

describe('applyAutonomyRules — rule ordering', () => {
  it('R2 dispensation takes precedence over R1 stuck', () => {
    const a = makeDimResult({ dimensionId: 'security', status: 'blocked-by-dispensation' });
    const result = applyAutonomyRules({
      state: makeState({ wavesSinceProgress: { other: MAX_STUCK_WAVES } }),
      frontier: { ...makeFrontier([a], 'blocked-by-dispensations'), blockingDispensations: ['r1'] },
      cwd: '/p',
    });
    if (result.verdict.kind !== 'halt') throw new Error('expected halt');
    assert.equal(result.verdict.rule, 'R2.refuse-on-dispensation');
  });

  it('frontier-reached wins when no halting rule fires', () => {
    const a = makeDimResult({ status: 'at-frontier' });
    const result = applyAutonomyRules({
      state: makeState(),
      frontier: makeFrontier([a], 'frontier-reached'),
      cwd: '/p',
    });
    assert.equal(result.verdict.kind, 'frontier-reached');
  });

  it('proceed is returned when no rule fires', () => {
    const result = applyAutonomyRules({
      state: makeState(),
      frontier: makeFrontier([makeDimResult({ status: 'progressing' })], 'progressing'),
      cwd: '/p',
    });
    assert.equal(result.verdict.kind, 'proceed');
  });
});

// ── State mutation helpers ──────────────────────────────────────────────────

describe('state mutation helpers', () => {
  it('recordDimProgress resets the dim counter to 0', () => {
    const before = makeState({ wavesSinceProgress: { security: 4 } });
    const after = recordDimProgress(before, 'security');
    assert.equal(after.wavesSinceProgress?.security, 0);
  });

  it('recordDimNoProgress increments the counter', () => {
    const before = makeState({ wavesSinceProgress: { security: 2 } });
    const after = recordDimNoProgress(before, 'security');
    assert.equal(after.wavesSinceProgress?.security, 3);
  });

  it('recordDimNoProgress initializes to 1 for a new dim', () => {
    const after = recordDimNoProgress(makeState(), 'new_dim');
    assert.equal(after.wavesSinceProgress?.new_dim, 1);
  });

  it('recordOutcomeRefinement keys by dim/outcome', () => {
    const after = recordOutcomeRefinement(makeState(), 'security', 'test-strict');
    assert.equal(after.outcomeRefinementCounts?.['security/test-strict'], 1);
  });

  it('clearOutcomeRefinement removes the key on success', () => {
    const before = makeState({ outcomeRefinementCounts: { 'security/test-strict': 2 } });
    const after = clearOutcomeRefinement(before, 'security', 'test-strict');
    assert.equal(after.outcomeRefinementCounts?.['security/test-strict'], undefined);
  });
});
