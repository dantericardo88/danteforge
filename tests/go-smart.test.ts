// Tests for the smart go.ts entry point (Sprint 50)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { go } from '../src/cli/commands/go.js';
import type { GoOptions } from '../src/cli/commands/go.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const makeScoreResult = (overall = 7.5): HarshScoreResult => ({
  displayScore: overall,
  displayDimensions: {
    functionality: 8.5,
    testing: 9.0,
    errorHandling: 8.5,
    security: 8.5,
    developerExperience: 5.5,   // P0 gap
    autonomy: 9.0,
    maintainability: 8.0,
    performance: 7.5,
    documentation: 7.0,
    uxPolish: 6.0,               // P0 gap
    planningQuality: 9.5,
    selfImprovement: 9.0,
    specDrivenPipeline: 9.5,
    convergenceSelfHealing: 9.0,
    tokenEconomy: 8.5,
    enterpriseReadiness: 6.0,
    mcpIntegration: 9.0,
    communityAdoption: 2.0,
  } as never,
  rawScores: {},
  summary: '',
  recommendations: [],
});

const stubSelfImprove = async () => ({
  initialScore: 7.5,
  finalScore: 8.1,
  cyclesRun: 2,
  achieved: false,
  stopReason: 'max-cycles' as const,
  dimensionsImproved: [],
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('go — first-run (no STATE.yaml)', () => {
  it('shows welcome banner when no state exists', async () => {
    const lines: string[] = [];
    const opts: GoOptions = {
      _stateExists: async () => false,
      _computeScore: async () => makeScoreResult(),
      _stdout: (l) => lines.push(l),
    };
    await go(opts);
    const text = lines.join('\n');
    assert.ok(text.includes('Welcome to DanteForge'), 'should show welcome message');
    assert.ok(text.includes('danteforge init'), 'should suggest init command');
  });

  it('does not call computeScore when no state exists', async () => {
    let scoreCalled = false;
    await go({
      _stateExists: async () => false,
      _computeScore: async () => { scoreCalled = true; return makeScoreResult(); },
      _stdout: () => {},
    });
    assert.ok(!scoreCalled, 'score should not be computed on first run');
  });
});

describe('go — existing project', () => {
  it('shows state panel with score when STATE.yaml exists', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(7.9),
      _confirm: async () => false,  // skip self-improve
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.ok(text.includes('7.9'), 'should show overall score');
    assert.ok(text.includes('P0'), 'should show P0 gaps');
  });

  it('shows ceiling dimensions in state panel', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _confirm: async () => false,
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    // KNOWN_CEILINGS has Enterprise Readiness and Community Adoption
    assert.ok(text.includes('Ceiling') || text.includes('ceiling'), 'should show ceiling info');
  });

  it('runs self-improve when user confirms', async () => {
    let selfImproveCalled = false;
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _confirm: async () => true,
      _runSelfImprove: async (opts) => { selfImproveCalled = true; return stubSelfImprove(); },
      _stdout: () => {},
    });
    assert.ok(selfImproveCalled, 'self-improve should run when confirmed');
  });

  it('skips self-improve when user declines', async () => {
    let selfImproveCalled = false;
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _confirm: async () => false,
      _runSelfImprove: async () => { selfImproveCalled = true; return stubSelfImprove(); },
      _stdout: () => {},
    });
    assert.ok(!selfImproveCalled, 'self-improve should not run when declined');
  });

  it('--yes flag bypasses confirm and runs self-improve directly', async () => {
    let selfImproveCalled = false;
    await go({
      yes: true,
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _confirm: async () => { throw new Error('confirm should not be called with --yes'); },
      _runSelfImprove: async () => { selfImproveCalled = true; return stubSelfImprove(); },
      _stdout: () => {},
    });
    assert.ok(selfImproveCalled, 'self-improve should run with --yes flag');
  });

  it('shows improvement summary after self-improve completes', async () => {
    const lines: string[] = [];
    await go({
      yes: true,
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _runSelfImprove: async () => ({
        initialScore: 7.5,
        finalScore: 8.2,
        cyclesRun: 3,
        achieved: false,
        stopReason: 'max-cycles' as const,
        dimensionsImproved: [],
      }),
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.ok(text.includes('7.5'), 'should show before score');
    assert.ok(text.includes('8.2'), 'should show after score');
  });

  it('shows LLM warning when no LLM is configured', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _confirm: async () => false,
      _isLLMAvailable: async () => false,
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.ok(text.includes('No LLM detected') || text.includes('danteforge doctor'), 'should warn about missing LLM');
  });

  it('does not show LLM warning when LLM is available', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _confirm: async () => false,
      _isLLMAvailable: async () => true,
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.ok(!text.includes('No LLM detected'), 'should not warn when LLM is available');
  });
});

describe('go — first-run wizard path (Sprint 51)', () => {
  const stubWizardAnswers = {
    description: 'A test project',
    projectType: 'CLI' as const,
    competitors: [],
    provider: 'ollama' as const,
    qualityTarget: 9.0 as const,
  };

  it('calls wizard on first-run when state does not exist', async () => {
    let wizardCalled = false;
    const lines: string[] = [];
    await go({
      _stateExists: async () => false,
      _runWizard: async () => { wizardCalled = true; return stubWizardAnswers; },
      _initFn: async () => {},
      _qualityFn: async () => {},
      _stdout: (l) => lines.push(l),
    });
    assert.ok(wizardCalled, 'wizard should be called on first run');
  });

  it('wizard returning null skips bootstrap and returns after banner', async () => {
    let initCalled = false;
    let qualityCalled = false;
    const lines: string[] = [];
    await go({
      _stateExists: async () => false,
      _runWizard: async () => null,
      _initFn: async () => { initCalled = true; },
      _qualityFn: async () => { qualityCalled = true; },
      _stdout: (l) => lines.push(l),
    });
    assert.ok(!initCalled, 'init should not be called when wizard returns null');
    assert.ok(!qualityCalled, 'quality should not be called when wizard returns null');
    const text = lines.join('\n');
    assert.ok(text.includes('Welcome to DanteForge'), 'banner should still show');
  });

  it('wizard answers trigger setup complete message', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => false,
      _runWizard: async () => stubWizardAnswers,
      _initFn: async () => {},
      _qualityFn: async (opts) => { opts._stdout('  7.5/10  — good'); },
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.ok(text.includes('Setup complete'), 'should emit setup complete message');
    assert.ok(text.includes('danteforge ascend') || text.includes('ascend'), 'should mention ascend command');
  });
});
