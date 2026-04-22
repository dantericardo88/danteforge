import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTermination, scopeNextWave, type TerminationContext } from '../src/core/termination-governor.js';
import type { CompletionVerdict } from '../src/core/completion-oracle.js';
import type { ResidualGapReport } from '../src/core/residual-gap-miner.js';

function makeGapReport(overrides: Partial<ResidualGapReport['analysis']> = {}): ResidualGapReport {
  return {
    bundleId: 'test',
    generatedAt: new Date().toISOString(),
    analysis: {
      score: 0,
      confirmedGaps: [],
      potentialGaps: [],
      staleTruthSurfaces: [],
      ...overrides,
    },
    recommendations: [],
  } as ResidualGapReport;
}

function makeCtx(overrides: Partial<TerminationContext> = {}): TerminationContext {
  return {
    cycleCount: 1,
    maxCycles: 10,
    verdict: 'inconclusive' as CompletionVerdict,
    gapReport: makeGapReport(),
    previousVerdicts: [],
    startTime: new Date().toISOString(),
    lastProgressTime: new Date().toISOString(),
    ...overrides,
  };
}

describe('evaluateTermination: Rule 1 — max cycles', () => {
  it('terminates when cycleCount >= maxCycles', async () => {
    const result = await evaluateTermination(makeCtx({ cycleCount: 10, maxCycles: 10 }));
    assert.equal(result.terminate, true);
    assert.ok(result.reason.includes('max_cycles_reached'));
    assert.equal(result.confidence, 1.0);
  });

  it('does not terminate when cycleCount < maxCycles', async () => {
    const result = await evaluateTermination(makeCtx({ cycleCount: 5, maxCycles: 10 }));
    assert.equal(result.terminate, false);
  });
});

describe('evaluateTermination: Rule 2 — complete verdict', () => {
  it('terminates when verdict is complete', async () => {
    const result = await evaluateTermination(makeCtx({ verdict: 'complete' as CompletionVerdict }));
    assert.equal(result.terminate, true);
    assert.ok(result.reason.includes('completion_achieved'));
    assert.ok(result.confidence >= 0.9);
  });
});

describe('evaluateTermination: Rule 3 — regression', () => {
  it('terminates on regression after cycle 2', async () => {
    const result = await evaluateTermination(makeCtx({
      verdict: 'regressed' as CompletionVerdict,
      cycleCount: 3,
    }));
    assert.equal(result.terminate, true);
    assert.ok(result.reason.includes('regression_detected'));
  });

  it('does not terminate on regression at cycle 1', async () => {
    const result = await evaluateTermination(makeCtx({
      verdict: 'regressed' as CompletionVerdict,
      cycleCount: 1,
    }));
    assert.equal(result.terminate, false);
  });
});

describe('evaluateTermination: Rule 4 — diminishing returns', () => {
  it('terminates when same verdict repeated 5+ times', async () => {
    const result = await evaluateTermination(makeCtx({
      verdict: 'inconclusive' as CompletionVerdict,
      previousVerdicts: ['inconclusive', 'inconclusive', 'inconclusive', 'inconclusive', 'inconclusive'] as CompletionVerdict[],
      cycleCount: 6,
    }));
    assert.equal(result.terminate, true);
    assert.ok(result.reason.includes('diminishing_returns'));
  });

  it('does not terminate on fewer than 5 repeated verdicts', async () => {
    const result = await evaluateTermination(makeCtx({
      previousVerdicts: ['inconclusive', 'inconclusive', 'inconclusive'] as CompletionVerdict[],
      cycleCount: 4,
    }));
    assert.equal(result.terminate, false);
  });
});

describe('evaluateTermination: Rule 5 — blocker detection', () => {
  it('terminates when external dependency gap found', async () => {
    const result = await evaluateTermination(makeCtx({
      gapReport: makeGapReport({ staleTruthSurfaces: ['external service unavailable'] }),
      cycleCount: 7,
    }));
    assert.equal(result.terminate, true);
    assert.ok(result.reason.includes('blocker_detected'));
  });

  it('terminates on 5+ inconclusive verdicts (test flakiness)', async () => {
    const result = await evaluateTermination(makeCtx({
      previousVerdicts: Array(5).fill('inconclusive') as CompletionVerdict[],
      cycleCount: 6,
    }));
    assert.equal(result.terminate, true);
  });
});

describe('evaluateTermination: continue case', () => {
  it('returns terminate=false for normal in-progress run', async () => {
    const result = await evaluateTermination(makeCtx({ cycleCount: 2, maxCycles: 20 }));
    assert.equal(result.terminate, false);
    assert.ok(result.reason.includes('continue'));
  });
});

describe('scopeNextWave', () => {
  it('returns P0 scope for high-priority autoforge gaps', () => {
    const result = scopeNextWave(makeGapReport({
      confirmedGaps: ['autoforge loop incomplete', 'closure missing', 'integration broken'],
    }));
    assert.equal(result.priority, 'P0');
    assert.ok(result.scope.length > 0);
    assert.ok(result.estimatedEffort > 0);
  });

  it('returns P1 scope for performance/test gaps when no P0', () => {
    const result = scopeNextWave(makeGapReport({
      confirmedGaps: ['performance slow', 'test coverage low'],
    }));
    assert.equal(result.priority, 'P1');
  });

  it('returns P2 scope for low-priority gaps', () => {
    const result = scopeNextWave(makeGapReport({
      confirmedGaps: ['minor polish needed'],
    }));
    assert.equal(result.priority, 'P2');
  });

  it('returns empty scope with P2 when no gaps', () => {
    const result = scopeNextWave(makeGapReport({ confirmedGaps: [] }));
    assert.equal(result.priority, 'P2');
    assert.deepEqual(result.scope, []);
    assert.equal(result.estimatedEffort, 0);
  });
});
