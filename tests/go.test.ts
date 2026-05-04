import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { go, type GoOptions } from '../src/cli/commands/go.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';
import type { Workflow } from '../src/cli/commands/flow.js';

// ── Factory helpers ───────────────────────────────────────────────────────────

function makeScoreResult(overrides: Partial<HarshScoreResult> = {}): HarshScoreResult {
  return {
    rawScore: 75,
    harshScore: 75,
    displayScore: 7.5,
    dimensions: {} as HarshScoreResult['dimensions'],
    displayDimensions: {
      functionality: 7.5, testing: 8.0, errorHandling: 6.5, security: 7.0,
      uxPolish: 6.0, documentation: 5.5, performance: 7.2, maintainability: 6.8,
    } as HarshScoreResult['displayDimensions'],
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: 'acceptable',
    maturityAssessment: {
      currentLevel: 3, targetLevel: 4, overallScore: 7.5,
      dimensions: {} as never,
      gaps: [],
      founderExplanation: 'Test',
      recommendation: { nextLevel: 4, key: 'test', actions: [] } as never,
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function baseOpts(overrides: Partial<GoOptions> = {}): GoOptions {
  const lines: string[] = [];
  return {
    _stateExists: async () => true,
    _computeScore: async () => makeScoreResult(),
    _isLLMAvailable: async () => false,
    _stdout: (line: string) => lines.push(line),
    // Prevent interactive prompt from blocking
    _choiceFn: async () => '',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('go — --status flag', () => {
  it('shows state panel and returns without asking for improvement', async () => {
    let improvementChoiceAsked = false;
    const lines: string[] = [];
    await go({
      ...baseOpts({ _stdout: (l) => lines.push(l) }),
      status: true,
      _choiceFn: async () => { improvementChoiceAsked = true; return ''; },
    });
    assert.ok(!improvementChoiceAsked, '--status should not ask for improvement choice');
    const combined = lines.join('\n');
    assert.ok(combined.includes('Project State') || combined.includes('Recommended'), 'state panel should be shown');
  });
});

describe('go — --fresh flag', () => {
  it('runs wizard even when state exists', async () => {
    let wizardCalled = false;
    await go({
      ...baseOpts(),
      fresh: true,
      _stateExists: async () => true,
      _runWizard: async () => { wizardCalled = true; return null; },
    });
    assert.ok(wizardCalled, '--fresh should invoke the wizard even with existing state');
  });
});

describe('go — --journey flag', () => {
  it('shows workflow journey list and returns', async () => {
    const journeys: Workflow[] = [
      {
        id: 'test-journey',
        label: 'Test Journey',
        trigger: 'Testing',
        useWhen: 'Use when: testing.',
        steps: ['/test'],
      },
    ];
    const lines: string[] = [];
    await go({
      ...baseOpts({ _stdout: (l) => lines.push(l) }),
      journey: true,
      _journeysFn: () => journeys,
    });
    const combined = lines.join('\n');
    assert.ok(combined.includes('Test Journey'), 'journey label should appear in output');
    assert.ok(combined.includes('/test'), 'journey step should appear in output');
  });
});

describe('go — --advanced flag', () => {
  it('passes advanced: true to initFn during wizard', async () => {
    let advancedPassed = false;
    await go({
      ...baseOpts(),
      fresh: true,
      advanced: true,
      _runWizard: async () => ({
        provider: 'ollama' as const,
        description: 'test',
        preferredLevel: 'standard',
        startMode: 'prompt-only' as const,
      }),
      _initFn: async (opts) => { advancedPassed = opts.advanced === true; },
      _scoreFn: async () => undefined,
    });
    assert.ok(advancedPassed, '--advanced should be forwarded to initFn');
  });
});
