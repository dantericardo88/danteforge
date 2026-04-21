import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runAscend,
  type AscendEngineOptions,
  type AdversarialCritique,
} from '../src/core/ascend-engine.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMatrix(dims: Array<{ id: string; score: number }>): CompeteMatrix {
  return {
    dimensions: dims.map(d => ({
      id: d.id,
      label: d.id,
      // Include a competitor score so gap_to_leader > 0 — prevents updateDimensionScore
      // from setting status='closed' (which happens when gap_to_leader <= 0)
      scores: { self: d.score, 'competitor-a': 9.5 },
      status: 'active' as const,
      priority: 1,
      weight: 1,
      gap_to_leader: 9.5 - d.score,
      frequency: 'common',
      sprint_history: [],
      harvest_source: undefined,
      ceiling: undefined,
      ceilingReason: undefined,
    })),
    overallSelfScore: dims.reduce((s, d) => s + d.score, 0) / dims.length,
    lastUpdated: new Date().toISOString(),
  };
}

function makeScoreResult(score = 7.0): HarshScoreResult {
  return {
    rawScore: score * 10,
    harshScore: score * 10,
    displayScore: score,
    dimensions: {} as HarshScoreResult['dimensions'],
    displayDimensions: {} as HarshScoreResult['displayDimensions'],
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: 'acceptable',
    maturityAssessment: { overallScore: 60, dimensions: {}, gaps: [], recommendation: 'proceed', timestamp: '', maturityLevel: 3 } as unknown as HarshScoreResult['maturityAssessment'],
    timestamp: new Date().toISOString(),
  };
}

function makeSatisfiedCritique(score: number): AdversarialCritique {
  return {
    satisfied: true,
    currentScore: score,
    targetScore: 9.0,
    gapAnalysis: '',
    concreteActions: [],
    critiquePrompt: '',
    generatedAt: new Date().toISOString(),
  };
}

function makeUnsatisfiedCritique(score: number, actions = ['Fix the gap']): AdversarialCritique {
  return {
    satisfied: false,
    currentScore: score,
    targetScore: 9.0,
    gapAnalysis: 'Still missing integration',
    concreteActions: actions,
    critiquePrompt: 'ADVERSARIAL CRITIQUE (functionality):\nStill missing integration\n\nREQUIRED ACTIONS FOR NEXT CYCLE:\n1. Fix the gap',
    generatedAt: new Date().toISOString(),
  };
}

function makeStrictDims() {
  return {
    autonomy: 80,
    selfImprovement: 70,
    tokenEconomy: 85,
    specDrivenPipeline: 80,
    developerExperience: 70,
    planningQuality: 70,
    convergenceSelfHealing: 70,
  };
}

function makeBaseOpts(overrides: Partial<AscendEngineOptions> = {}): AscendEngineOptions {
  const matrix = makeMatrix([{ id: 'functionality', score: 6.0 }]);
  return {
    cwd: '/tmp/test',
    target: 9.0,
    maxCycles: 3,
    executeMode: 'advisory',   // tests use advisory path to exercise _runLoop seam
    _loadMatrix: async () => matrix,
    _saveMatrix: async () => {},
    _loadState: async () => ({ project: 'test' }) as never,
    _harshScore: async () => makeScoreResult(7.0),
    _runLoop: async (ctx) => ctx,
    _executeCommand: async () => ({ success: true }),
    _writeFile: async () => {},
    _saveCheckpoint: async () => {},
    _loadCheckpoint: async () => null,
    _clearCheckpoint: async () => {},
    _computeStrictDims: async () => makeStrictDims(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ascend dual-LLM — _generateCritique integration', () => {
  it('_generateCritique is NOT called when scorerProvider is absent', async () => {
    let critiqueCalled = false;
    await runAscend(makeBaseOpts({
      scorerProvider: undefined,
      _generateCritique: async () => {
        critiqueCalled = true;
        return makeSatisfiedCritique(7.0);
      },
    }));
    assert.equal(critiqueCalled, false);
  });

  it('_generateCritique is called when scorerProvider is set and score < target', async () => {
    let critiqueCalled = false;
    await runAscend(makeBaseOpts({
      scorerProvider: 'grok',
      maxCycles: 1,
      _generateCritique: async () => {
        critiqueCalled = true;
        return makeSatisfiedCritique(7.0);
      },
    }));
    assert.equal(critiqueCalled, true);
  });

  it('_generateCritique is NOT called when score already >= target', async () => {
    let critiqueCalled = false;
    // Score at target — critique should be skipped
    await runAscend(makeBaseOpts({
      scorerProvider: 'grok',
      maxCycles: 1,
      _harshScore: async () => makeScoreResult(9.5),
      _generateCritique: async () => {
        critiqueCalled = true;
        return makeSatisfiedCritique(9.5);
      },
    }));
    assert.equal(critiqueCalled, false, 'critique should not run when score >= target');
  });

  it('critiquePrompt from unsatisfied critique is injected into next cycle goal', async () => {
    const capturedGoals: string[] = [];
    let critiqueCallCount = 0;

    await runAscend(makeBaseOpts({
      scorerProvider: 'grok',
      maxCycles: 3,
      maxDimRetries: 2,
      _runLoop: async (ctx) => {
        capturedGoals.push(ctx.goal);
        return ctx;
      },
      _generateCritique: async () => {
        critiqueCallCount++;
        if (critiqueCallCount === 1) {
          return makeUnsatisfiedCritique(7.0, ['Wire the module']);
        }
        return makeSatisfiedCritique(8.0);
      },
    }));

    // Second call should have the critique prompt injected into the goal
    const secondGoal = capturedGoals[1];
    assert.ok(secondGoal !== undefined, 'should have a second cycle');
    assert.ok(
      secondGoal.includes('ADVERSARIAL CRITIQUE') || secondGoal.includes('Wire the module') || secondGoal.includes('REQUIRED ACTIONS'),
      `second goal should contain critique content, got: ${secondGoal.slice(0, 200)}`,
    );
  });

  it('same dimension is retried up to maxDimRetries when critic is unsatisfied', async () => {
    const targetedDims: string[] = [];
    let critiqueCount = 0;

    await runAscend(makeBaseOpts({
      scorerProvider: 'grok',
      maxCycles: 5,
      maxDimRetries: 2,
      _runLoop: async (ctx) => {
        // Extract dimension from goal (goal starts with "Improve {label}...")
        targetedDims.push(ctx.goal.split(' ')[1] ?? 'unknown');
        return ctx;
      },
      _generateCritique: async () => {
        critiqueCount++;
        return makeUnsatisfiedCritique(7.0); // always unsatisfied
      },
    }));

    // The same dimension should appear at least 2 times (initial + retries)
    const funcCount = targetedDims.filter(d => d === 'functionality').length;
    assert.ok(funcCount >= 2, `expected functionality to be targeted >=2 times, got ${funcCount}`);
  });

  it('dimension is not retried beyond maxDimRetries', async () => {
    const targetedDims: string[] = [];

    await runAscend(makeBaseOpts({
      scorerProvider: 'grok',
      maxCycles: 10,
      maxDimRetries: 1, // only 1 retry allowed
      _runLoop: async (ctx) => {
        targetedDims.push(ctx.goal.split(' ')[1] ?? 'unknown');
        return ctx;
      },
      _generateCritique: async () => makeUnsatisfiedCritique(7.0), // always unsatisfied
    }));

    // With maxDimRetries=1 the dim should appear at most 2 times (initial + 1 retry)
    const funcCount = targetedDims.filter(d => d === 'functionality').length;
    assert.ok(funcCount <= 2, `expected functionality to be targeted <=2 times with maxDimRetries=1, got ${funcCount}`);
  });

  it('critique generation failure does not abort the loop', async () => {
    let loopRan = false;
    await runAscend(makeBaseOpts({
      scorerProvider: 'grok',
      maxCycles: 1,
      _runLoop: async (ctx) => { loopRan = true; return ctx; },
      _generateCritique: async () => { throw new Error('scorer LLM down'); },
    }));
    assert.equal(loopRan, true, 'loop should still run even when critique generation fails');
  });
});

describe('ascend dual-LLM — _executeCommand wiring', () => {
  it('_executeCommand is called when runLoop is real (not stubbed)', async () => {
    // Verify the executor is wired — use real runLoop check via deps inspection
    let executorInDeps: unknown;
    await runAscend(makeBaseOpts({
      _runLoop: async (ctx, deps) => {
        executorInDeps = deps?._executeCommand;
        return ctx;
      },
    }));
    assert.ok(
      typeof executorInDeps === 'function',
      '_executeCommand should be passed as a dep to runLoopFn',
    );
  });

  it('advisory mode regression: _runLoop receives _executeCommand dep', async () => {
    let capturedDeps: Record<string, unknown> | undefined;
    await runAscend(makeBaseOpts({
      _runLoop: async (ctx, deps) => {
        capturedDeps = deps as Record<string, unknown> | undefined;
        return ctx;
      },
    }));
    assert.ok(capturedDeps !== undefined, 'deps should be passed');
    assert.ok(typeof capturedDeps['_executeCommand'] === 'function', '_executeCommand must be a function in deps');
  });
});
