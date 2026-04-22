import { describe, it } from 'node:test';
import assert from 'node:assert';
import { go } from '../src/cli/commands/go.js';
import type { GoOptions } from '../src/cli/commands/go.js';
import type { SelfImproveOptions, SelfImproveResult } from '../src/cli/commands/self-improve.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

function makeResult(overrides: Partial<SelfImproveResult> = {}): SelfImproveResult {
  return {
    cyclesRun: 3,
    initialScore: 7.0,
    finalScore: 8.5,
    achieved: false,
    plateauDetected: false,
    stopReason: 'max-cycles',
    ...overrides,
  };
}

const stubScore: HarshScoreResult = {
  displayScore: 7.5,
  displayDimensions: {
    functionality: 8.5, testing: 9.0, errorHandling: 8.5, security: 8.5,
    developerExperience: 5.5, autonomy: 9.0, maintainability: 8.0, performance: 7.5,
    documentation: 7.0, uxPolish: 6.0, planningQuality: 9.5, selfImprovement: 9.0,
    specDrivenPipeline: 9.5, convergenceSelfHealing: 9.0, tokenEconomy: 8.5,
    enterpriseReadiness: 6.0, mcpIntegration: 9.0, communityAdoption: 2.0,
  } as never,
  rawScores: {},
  summary: '',
  recommendations: [],
};

function makeOpts(overrides: Partial<GoOptions> = {}): GoOptions {
  return {
    cwd: '/tmp/go-test',
    // Sprint 50: go is state-aware. Tests must simulate existing project.
    _stateExists: async () => true,
    _computeScore: async () => stubScore,
    _choiceFn: async () => '2',  // choose "Apply one improvement" (1 cycle)
    _runSelfImprove: async () => makeResult(),
    _stdout: () => {},
    ...overrides,
  };
}

describe('go command', () => {
  it('_runSelfImprove called with maxCycles: 1 for single-improvement choice', async () => {
    let capturedOpts: SelfImproveOptions | null = null;
    await go(makeOpts({
      _choiceFn: async () => '2',
      _runSelfImprove: async (opts) => { capturedOpts = opts; return makeResult(); },
    }));
    assert.ok(capturedOpts !== null, '_runSelfImprove should be called');
    assert.strictEqual(capturedOpts!.maxCycles, 1);
  });

  it('_runSelfImprove called with minScore: 9.0 default', async () => {
    let capturedOpts: SelfImproveOptions | null = null;
    await go(makeOpts({
      _runSelfImprove: async (opts) => { capturedOpts = opts; return makeResult(); },
    }));
    assert.strictEqual(capturedOpts!.minScore, 9.0);
  });

  it('before and after scores are logged', async () => {
    const lines: string[] = [];
    await go(makeOpts({
      _runSelfImprove: async () => makeResult({ initialScore: 6.5, finalScore: 8.2, cyclesRun: 2 }),
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('6.5'), 'before score should appear');
    assert.ok(combined.includes('8.2'), 'after score should appear');
  });

  it('optional goal forwarded to selfImprove', async () => {
    let capturedOpts: SelfImproveOptions | null = null;
    await go(makeOpts({
      goal: 'improve security dimension',
      _runSelfImprove: async (opts) => { capturedOpts = opts; return makeResult(); },
    }));
    assert.strictEqual(capturedOpts!.goal, 'improve security dimension');
  });

  it('graceful message when achieved: false', async () => {
    const lines: string[] = [];
    await go(makeOpts({
      _runSelfImprove: async () => makeResult({ achieved: false, stopReason: 'max-cycles' }),
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('Stopped') || combined.includes('Run again') || combined.includes('cycle'), 'should have graceful non-achieved message');
  });
});
