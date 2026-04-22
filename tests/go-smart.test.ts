import { describe, it } from 'node:test';
import assert from 'node:assert';
import { go, verdict } from '../src/cli/commands/go.js';
import type { GoOptions } from '../src/cli/commands/go.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

const makeScoreResult = (overall = 7.5): HarshScoreResult => ({
  displayScore: overall,
  displayDimensions: {
    functionality: 8.5,
    testing: 9.0,
    errorHandling: 6.2,
    security: 6.8,
    developerExperience: 5.5,
    autonomy: 9.0,
    maintainability: 8.0,
    performance: 7.5,
    documentation: 7.0,
    uxPolish: 6.0,
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

describe('go - first-run (no STATE.yaml)', () => {
  const stubWizardAnswers = {
    description: 'A test project',
    projectType: 'CLI' as const,
    competitors: [],
    provider: 'ollama' as const,
    qualityTarget: 9.0 as const,
    startMode: 'offline' as const,
    preferredLevel: 'magic' as const,
  };

  it('shows welcome banner when no state exists', async () => {
    const lines: string[] = [];
    const opts: GoOptions = {
      _stateExists: async () => false,
      _stdout: (l) => lines.push(l),
      _runWizard: async () => null,
    };
    await go(opts);
    const text = lines.join('\n');
    assert.match(text, /Welcome to DanteForge/i);
    assert.match(text, /3 quick questions/i);
  });

  it('first-run path uses wizard answers to seed init', async () => {
    let initArgs: Record<string, unknown> | undefined;
    await go({
      _stateExists: async () => false,
      _runWizard: async () => stubWizardAnswers,
      _initFn: async (opts) => {
        initArgs = opts;
      },
      _scoreFn: async () => {},
      _stdout: () => {},
    });
    assert.deepStrictEqual(initArgs, {
      cwd: process.cwd(),
      guided: false,
      nonInteractive: true,
      provider: 'ollama',
      projectDescription: 'A test project',
      preferredLevel: 'magic',
      preferLive: false,
    });
  });

  it('wizard returning null skips bootstrap and score', async () => {
    let initCalled = false;
    let scoreCalled = false;
    const lines: string[] = [];
    await go({
      _stateExists: async () => false,
      _runWizard: async () => null,
      _initFn: async () => {
        initCalled = true;
      },
      _scoreFn: async () => {
        scoreCalled = true;
      },
      _stdout: (l) => lines.push(l),
    });
    assert.equal(initCalled, false);
    assert.equal(scoreCalled, false);
    assert.match(lines.join('\n'), /Welcome to DanteForge/i);
  });

  it('shows setup complete message after first score', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => false,
      _runWizard: async () => stubWizardAnswers,
      _initFn: async () => {},
      _scoreFn: async (opts) => {
        opts._stdout?.('score output');
      },
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.match(text, /Setup complete/i);
    assert.match(text, /danteforge auto-improve/i);
  });
});

describe('go - existing project', () => {
  it('shows state panel with score when STATE.yaml exists', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(7.9),
      _choiceFn: async () => '',
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.match(text, /7\.9/);
    assert.match(text, /P0 gaps/i);
  });

  it('shows ceiling dimensions in state panel', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '',
      _stdout: (l) => lines.push(l),
    });
    assert.match(lines.join('\n'), /Ceilings/i);
  });

  it('uses improve alias in the recommended next step', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '',
      _stdout: (l) => lines.push(l),
    });
    assert.match(lines.join('\n'), /danteforge improve/i);
  });

  it('shows outcome-first recommendation language', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '',
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.match(text, /Your project is weakest at/i);
    assert.match(text, /Best next move/i);
    assert.match(text, /Expected outcome/i);
  });

  it('shows 3-choice menu when no --yes flag', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '',
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.match(text, /Review only/i);
    assert.match(text, /Apply one improvement/i);
    assert.match(text, /auto-improve/i);
  });

  it('choice 1 exits without running improvement', async () => {
    let selfImproveCalled = false;
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '1',
      _runSelfImprove: async () => { selfImproveCalled = true; return stubSelfImprove(); },
      _stdout: () => {},
    });
    assert.equal(selfImproveCalled, false);
  });

  it('choice 3 runs autonomous loop with maxCycles 3', async () => {
    let capturedMax: number | undefined;
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '3',
      _runSelfImprove: async (opts) => { capturedMax = opts.maxCycles; return stubSelfImprove(); },
      _stdout: () => {},
    });
    assert.equal(capturedMax, 3);
  });

  it('shows explain footer in state panel', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '',
      _stdout: (l) => lines.push(l),
    });
    assert.match(lines.join('\n'), /danteforge explain/i);
  });

  it('runs self-improve when user confirms', async () => {
    let selfImproveCalled = false;
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '2',
      _runSelfImprove: async () => {
        selfImproveCalled = true;
        return stubSelfImprove();
      },
      _stdout: () => {},
    });
    assert.equal(selfImproveCalled, true);
  });

  it('skips self-improve when user declines', async () => {
    let selfImproveCalled = false;
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '',
      _runSelfImprove: async () => {
        selfImproveCalled = true;
        return stubSelfImprove();
      },
      _stdout: () => {},
    });
    assert.equal(selfImproveCalled, false);
  });

  it('--yes flag bypasses confirm and runs self-improve directly', async () => {
    let selfImproveCalled = false;
    await go({
      yes: true,
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => {
        throw new Error('choiceFn should not be called with --yes');
      },
      _runSelfImprove: async () => {
        selfImproveCalled = true;
        return stubSelfImprove();
      },
      _stdout: () => {},
    });
    assert.equal(selfImproveCalled, true);
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
    assert.match(text, /Before:\s+7\.5/);
    assert.match(text, /After:\s+8\.2/);
  });

  it('shows LLM warning when no LLM is configured', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '',
      _isLLMAvailable: async () => false,
      _stdout: (l) => lines.push(l),
    });
    assert.match(lines.join('\n'), /No LLM detected|danteforge doctor/i);
  });

  it('does not show LLM warning when LLM is available', async () => {
    const lines: string[] = [];
    await go({
      _stateExists: async () => true,
      _computeScore: async () => makeScoreResult(),
      _choiceFn: async () => '',
      _isLLMAvailable: async () => true,
      _stdout: (l) => lines.push(l),
    });
    assert.doesNotMatch(lines.join('\n'), /No LLM detected/i);
  });
});

describe('verdict labels', () => {
  it('returns excellent at 9.0+', () => { assert.match(verdict(9.0), /excellent/i); });
  it('returns good at 8.0-8.9', () => { assert.match(verdict(8.5), /good/i); });
  it('returns solid at 7.0-7.9', () => { assert.match(verdict(7.5), /solid/i); });
  it('returns developing at 5.0-6.9', () => { assert.match(verdict(6.0), /developing/i); });
  it('returns needs attention below 5.0', () => { assert.match(verdict(4.9), /needs attention/i); });
  it('does not return needs-work at any score', () => {
    for (const s of [9, 8.5, 7.5, 6, 4]) {
      assert.doesNotMatch(verdict(s), /needs-work/);
    }
  });
  it('does not return critical at any score', () => {
    for (const s of [9, 8.5, 7.5, 6, 4]) {
      assert.doesNotMatch(verdict(s), /^critical$/);
    }
  });
});

describe('go --simple mode', () => {
  const makeMetaHeavyScore = (): HarshScoreResult => ({
    displayScore: 7.5,
    displayDimensions: {
      functionality: 8.5, testing: 8.0, errorHandling: 8.0, security: 8.0,
      uxPolish: 7.5, documentation: 7.5, performance: 7.5, maintainability: 7.5,
      developerExperience: 7.0, autonomy: 7.0, planningQuality: 7.0,
      selfImprovement: 5.0, specDrivenPipeline: 5.0, convergenceSelfHealing: 7.0,
      tokenEconomy: 7.0, ecosystemMcp: 7.0, enterpriseReadiness: 7.0,
      communityAdoption: 2.0,
    } as never,
    rawScores: {}, summary: '', recommendations: [],
  });

  it('--simple hides ceiling section', async () => {
    const lines: string[] = [];
    await go({
      simple: true,
      _stateExists: async () => true,
      _computeScore: async () => makeMetaHeavyScore(),
      _choiceFn: async () => '',
      _stdout: (l) => lines.push(l),
    });
    assert.doesNotMatch(lines.join('\n'), /Ceilings/i);
  });

  it('--simple does not show communityAdoption in P0 gaps when builder dims are healthy', async () => {
    const lines: string[] = [];
    await go({
      simple: true,
      _stateExists: async () => true,
      _computeScore: async () => makeMetaHeavyScore(),
      _choiceFn: async () => '',
      _stdout: (l) => lines.push(l),
    });
    // All builder dims are above 7.0 in this fixture, so community adoption
    // (2.0/10) should NOT appear in the recommendation — simple mode skips meta dims
    assert.doesNotMatch(lines.join('\n'), /Community Adoption/i);
  });
});
