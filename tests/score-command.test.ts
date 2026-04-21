import { describe, it } from 'node:test';
import assert from 'node:assert';
import { score } from '../src/cli/commands/score.js';
import type { ScoreOptions } from '../src/cli/commands/score.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';
import type { DanteState } from '../src/core/state.js';
import type { AdversarialScoreResult } from '../src/core/adversarial-scorer-dim.js';
import type { AdversaryResolution } from '../src/core/config.js';

function makeHarshResult(overrides: Partial<HarshScoreResult> = {}): HarshScoreResult {
  const displayDimensions = {
    functionality: 9.0, testing: 7.8, errorHandling: 9.5,
    security: 3.0, uxPolish: 10.0, documentation: 9.9,
    performance: 2.5, maintainability: 8.4, developerExperience: 9.7,
    autonomy: 4.0, planningQuality: 9.4, selfImprovement: 6.5,
    specDrivenPipeline: 9.5, convergenceSelfHealing: 8.0, tokenEconomy: 7.0,
    ecosystemMcp: 6.0, enterpriseReadiness: 7.5, communityAdoption: 1.5,
  };
  return {
    rawScore: 72, harshScore: 72, displayScore: 7.2,
    dimensions: Object.fromEntries(Object.entries(displayDimensions).map(([k, v]) => [k, v * 10])) as any,
    displayDimensions: displayDimensions as any,
    penalties: [], stubsDetected: [], fakeCompletionRisk: 'low',
    verdict: 'needs-work', maturityAssessment: {} as any, timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project', lastHandoff: new Date().toISOString(),
    workflowStage: 'initialized', currentPhase: 0, tasks: {}, auditLog: [], profile: 'default',
    ...overrides,
  };
}

function makeOpts(overrides: Partial<ScoreOptions> = {}): ScoreOptions {
  const lines: string[] = [];
  let capturedState: DanteState | null = null;
  return {
    cwd: '/tmp/test',
    _harshScore: async () => makeHarshResult(),
    _loadState: async () => makeState(),
    _saveState: async (s) => { capturedState = s; },
    _getGitSha: async () => 'abc1234',
    _stdout: (line) => lines.push(line),
    ...overrides,
  };
}

describe('score command', () => {
  it('_harshScore injection skips real LLM', async () => {
    let called = false;
    const opts = makeOpts({
      _harshScore: async () => { called = true; return makeHarshResult(); },
    });
    await score(opts);
    assert.ok(called, '_harshScore should have been called');
  });

  it('returns top 3 lowest-scoring dimensions as P0 items', async () => {
    const result = await score(makeOpts());
    assert.strictEqual(result.p0Items.length, 3);
    // builder dims take priority over meta dims; lowest builder dims are performance (2.5), security (3.0), testing (7.8)
    const dims = result.p0Items.map(i => i.dimension);
    assert.ok(dims.includes('performance'), `expected performance in ${dims}`);
    assert.ok(dims.includes('security'), `expected security in ${dims}`);
    assert.ok(dims.includes('testing'), `expected testing in ${dims}`);
  });

  it('P0 items have non-empty action strings', async () => {
    const result = await score(makeOpts());
    for (const item of result.p0Items) {
      assert.ok(item.action.length > 0, `action for ${item.dimension} must not be empty`);
    }
  });

  it('renders session delta when sessionBaselineScore exists in state', async () => {
    const lines: string[] = [];
    await score(makeOpts({
      _loadState: async () => makeState({
        sessionBaselineScore: 6.8,
        sessionBaselineTimestamp: new Date().toISOString(), // recent — within 4h TTL
      }),
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('▲') || combined.includes('▼') || combined.includes('─'),
      'delta arrow should be rendered');
  });

  it('_runPrime is called after scoring', async () => {
    let primeCalled = false;
    await score(makeOpts({
      _runPrime: async () => { primeCalled = true; },
    }));
    assert.ok(primeCalled, '_runPrime should be called after scoring');
  });

  it('appendScoreHistory is called with correct displayScore', async () => {
    let savedState: DanteState | null = null;
    await score(makeOpts({
      _harshScore: async () => makeHarshResult({ displayScore: 8.1 }),
      _saveState: async (s) => { savedState = s; },
      _runPrime: async () => {},
    }));
    assert.ok(savedState !== null, 'state should have been saved');
    assert.ok(savedState!.scoreHistory && savedState!.scoreHistory.length > 0,
      'scoreHistory should have an entry');
    assert.strictEqual(savedState!.scoreHistory![0].displayScore, 8.1);
  });

  it('--full flag is recorded in options without crashing', async () => {
    // full flag delegates to assess — just verifies no crash in score path
    const result = await score(makeOpts({ full: true, _runPrime: async () => {} }));
    assert.ok(result.displayScore >= 0);
  });

  it('_stdout captures all output lines', async () => {
    const lines: string[] = [];
    await score(makeOpts({ _stdout: (l) => lines.push(l), _runPrime: async () => {} }));

    assert.ok(lines.length > 0, 'should have emitted lines');
    const combined = lines.join('\n');
    assert.ok(combined.includes('/10'), 'score line should appear');
    assert.ok(combined.includes('P0 gaps'), 'P0 gaps label should appear');
  });
});

// ── Adversarial scoring tests ─────────────────────────────────────────────────

function makeAdversarialResult(overrides: Partial<AdversarialScoreResult> = {}): AdversarialScoreResult {
  const resolution: AdversaryResolution = { provider: 'ollama', mode: 'ollama-auto' };
  return {
    selfScore: 7.2,
    adversarialScore: 5.8,
    divergence: -1.4,
    verdict: 'inflated',
    dimensions: [
      {
        dimension: 'testing' as import('../src/core/harsh-scorer.js').ScoringDimension,
        adversarialScore: 5.1,
        rationale: 'tests exist but coverage gaps',
        provider: 'ollama',
        mode: 'ollama-auto',
        generatedAt: new Date().toISOString(),
      },
    ],
    adversaryResolution: resolution,
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('score command — adversarial scoring', () => {
  it('_generateAdversarialScore is called when adversary: true', async () => {
    let called = false;
    const lines: string[] = [];
    await score(makeOpts({
      adversary: true,
      _generateAdversarialScore: async () => { called = true; return makeAdversarialResult(); },
      _stdout: (l) => lines.push(l),
    }));
    assert.ok(called, '_generateAdversarialScore should have been called');
  });

  it('result has adversarialResult when adversary: true', async () => {
    const advResult = makeAdversarialResult();
    const result = await score(makeOpts({
      adversary: true,
      _generateAdversarialScore: async () => advResult,
    }));
    assert.ok(result.adversarialResult !== undefined, 'adversarialResult should be set');
    assert.equal(result.adversarialResult!.adversarialScore, advResult.adversarialScore);
  });

  it('dual panel renders to _stdout', async () => {
    const lines: string[] = [];
    await score(makeOpts({
      adversary: true,
      _generateAdversarialScore: async () => makeAdversarialResult({
        selfScore: 7.2,
        adversarialScore: 5.8,
        divergence: -1.4,
        verdict: 'inflated',
      }),
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('5.8') || combined.includes('Adversary') || combined.includes('adversar'),
      'adversarial score should appear in output');
  });

  it('verdict appears in output', async () => {
    const lines: string[] = [];
    await score(makeOpts({
      adversary: true,
      _generateAdversarialScore: async () => makeAdversarialResult({ verdict: 'inflated' }),
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(
      combined.toUpperCase().includes('INFLATED') || combined.toLowerCase().includes('inflated'),
      'verdict should appear in output',
    );
  });

  it('_generateAdversarialScore is NOT called without --adversary flag', async () => {
    let called = false;
    await score(makeOpts({
      adversary: false,
      _generateAdversarialScore: async () => { called = true; return makeAdversarialResult(); },
    }));
    assert.ok(!called, '_generateAdversarialScore should not be called without --adversary');
  });

  it('adversarialResult is undefined without --adversary flag', async () => {
    const result = await score(makeOpts({ adversary: false }));
    assert.equal(result.adversarialResult, undefined);
  });

  it('graceful non-fatal failure when adversary scorer throws', async () => {
    const lines: string[] = [];
    let threw = false;
    try {
      const result = await score(makeOpts({
        adversary: true,
        _generateAdversarialScore: async () => { throw new Error('LLM unavailable'); },
        _stdout: (l) => lines.push(l),
      }));
      // Should still return a valid score result
      assert.ok(result.displayScore >= 0);
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'adversarial score failure should be non-fatal');
    const combined = lines.join('\n');
    assert.ok(combined.includes('unavailable') || combined.includes('skipping') || combined.includes('adversary'),
      'should emit warning about adversarial scoring being unavailable');
  });

  it('adversarialResult is undefined when adversary scorer throws', async () => {
    const result = await score(makeOpts({
      adversary: true,
      _generateAdversarialScore: async () => { throw new Error('LLM unavailable'); },
    }));
    assert.equal(result.adversarialResult, undefined);
  });
});
