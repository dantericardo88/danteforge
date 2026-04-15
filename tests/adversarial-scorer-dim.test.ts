import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAdversarialScore,
  generateAdversarialScoreSummary,
  type AdversarialScorerDimOptions,
  type AdversarialScoreResult,
} from '../src/core/adversarial-scorer-dim.js';
import type { HarshScoreResult, ScoringDimension } from '../src/core/harsh-scorer.js';
import type { AdversaryResolution } from '../src/core/config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SELF_CHALLENGE_RESOLUTION: AdversaryResolution = {
  provider: 'ollama',
  mode: 'self-challenge',
};

const CONFIGURED_RESOLUTION: AdversaryResolution = {
  provider: 'grok',
  model: 'grok-3-mini',
  mode: 'configured',
};

function makeSelfResult(overallScore: number, dimOverrides?: Partial<Record<ScoringDimension, number>>): HarshScoreResult {
  const base: Partial<Record<ScoringDimension, number>> = {
    functionality: overallScore,
    testing: overallScore,
    errorHandling: overallScore,
    security: overallScore,
    uxPolish: overallScore,
    documentation: overallScore,
    performance: overallScore,
    maintainability: overallScore,
    developerExperience: overallScore,
    autonomy: overallScore,
    planningQuality: overallScore,
    selfImprovement: overallScore,
    specDrivenPipeline: overallScore,
    convergenceSelfHealing: overallScore,
    tokenEconomy: overallScore,
    ecosystemMcp: overallScore,
    enterpriseReadiness: overallScore,
    communityAdoption: overallScore,
  };
  const dims = { ...base, ...dimOverrides } as Record<ScoringDimension, number>;
  return {
    displayScore: overallScore,
    displayDimensions: dims,
    score: overallScore,
    dimensions: dims,
    p0: [],
    p1: [],
    p2: [],
    p3: [],
    maturityLevel: 'production-grade',
  } as unknown as HarshScoreResult;
}

function makeOpts(scoreFn: (prompt: string) => string | Promise<string>, extraOpts?: Partial<AdversarialScorerDimOptions>): AdversarialScorerDimOptions {
  return {
    adversaryResolution: SELF_CHALLENGE_RESOLUTION,
    _callLLM: async (prompt) => scoreFn(prompt),
    ...extraOpts,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateAdversarialScore', () => {
  it('returns AdversarialScoreResult with required shape', async () => {
    const opts = makeOpts(() => JSON.stringify({ score: 6.0, rationale: 'test' }));
    const result = await generateAdversarialScore(makeSelfResult(7.5), opts);

    assert.ok(typeof result.selfScore === 'number');
    assert.ok(typeof result.adversarialScore === 'number');
    assert.ok(typeof result.divergence === 'number');
    assert.ok(['trusted', 'watch', 'inflated', 'underestimated'].includes(result.verdict));
    assert.ok(Array.isArray(result.dimensions));
    assert.ok(result.dimensions.length > 0);
    assert.ok(typeof result.generatedAt === 'string');
    assert.ok(result.adversaryResolution !== undefined);
  });

  it('selfScore matches input displayScore', async () => {
    const opts = makeOpts(() => JSON.stringify({ score: 5.0, rationale: 'ok' }));
    const result = await generateAdversarialScore(makeSelfResult(8.0), opts);
    assert.equal(result.selfScore, 8.0);
  });

  it('adversarialScore is within 0-10 bounds', async () => {
    const opts = makeOpts(() => JSON.stringify({ score: 4.5, rationale: 'ok' }));
    const result = await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.ok(result.adversarialScore >= 0);
    assert.ok(result.adversarialScore <= 10);
  });

  it('divergence = adversarialScore - selfScore', async () => {
    const opts = makeOpts(() => JSON.stringify({ score: 5.0, rationale: 'ok' }));
    const result = await generateAdversarialScore(makeSelfResult(7.0), opts);
    const expected = Math.round((result.adversarialScore - result.selfScore) * 10) / 10;
    assert.equal(result.divergence, expected);
  });

  it('verdict: trusted when |divergence| <= 0.5', async () => {
    // self=7.0, adv=7.2 → div=+0.2 → trusted
    const opts = makeOpts(() => JSON.stringify({ score: 7.2, rationale: 'ok' }));
    const result = await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.equal(result.verdict, 'trusted');
  });

  it('verdict: watch when divergence in (-1.5, -0.5)', async () => {
    // self=7.0, dim avg≈5.5 → div≈-1.5 to -0.5 → watch
    const opts = makeOpts(() => JSON.stringify({ score: 6.0, rationale: 'ok' }));
    const result = await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.equal(result.verdict, 'watch');
  });

  it('verdict: inflated when divergence <= -1.5', async () => {
    // self=8.0, adv=5.0 → div=-3.0 → inflated
    const opts = makeOpts(() => JSON.stringify({ score: 5.0, rationale: 'ok' }));
    const result = await generateAdversarialScore(makeSelfResult(8.0), opts);
    assert.equal(result.verdict, 'inflated');
  });

  it('verdict: underestimated when divergence >= +1.0', async () => {
    // self=5.0, adv=7.0 → div=+2.0 → underestimated
    const opts = makeOpts(() => JSON.stringify({ score: 7.0, rationale: 'ok' }));
    const result = await generateAdversarialScore(makeSelfResult(5.0), opts);
    assert.equal(result.verdict, 'underestimated');
  });

  it('graceful fallback on invalid JSON: applies 0.85 discount', async () => {
    const opts = makeOpts(() => 'not valid json at all');
    const result = await generateAdversarialScore(makeSelfResult(6.0), opts);
    // Each dim falls back to selfDimScore * 0.85 = 6.0 * 0.85 = 5.1
    assert.ok(result.adversarialScore <= 6.0); // must be lower than or equal to self
    assert.ok(result.adversarialScore > 0);
  });

  it('graceful fallback on LLM rejection (empty string): applies 0.85 discount', async () => {
    const opts = makeOpts(() => '');
    const result = await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.ok(result.adversarialScore < 7.0);
    assert.ok(result.adversarialScore > 0);
  });

  it('_callLLM seam is used — no real LLM calls', async () => {
    let called = false;
    const opts = makeOpts((prompt) => {
      assert.ok(prompt.includes('hostile technical reviewer'));
      called = true;
      return JSON.stringify({ score: 5.0, rationale: 'test' });
    });
    await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.ok(called);
  });

  it('self-challenge mode includes adversarial framing in prompt', async () => {
    let promptSeen = '';
    const opts = makeOpts((prompt) => {
      promptSeen = prompt;
      return JSON.stringify({ score: 5.0, rationale: 'test' });
    }, { adversaryResolution: { provider: 'ollama', mode: 'self-challenge' } });
    await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.ok(
      promptSeen.includes('do NOT anchor to any prior score') ||
      promptSeen.includes('skeptical external evaluator'),
      'self-challenge prompt should include adversarial framing',
    );
  });

  it('configured/ollama-auto mode does NOT include self-challenge prefix', async () => {
    let promptSeen = '';
    const opts = makeOpts((prompt) => {
      promptSeen = prompt;
      return JSON.stringify({ score: 5.0, rationale: 'test' });
    }, { adversaryResolution: CONFIGURED_RESOLUTION });
    await generateAdversarialScore(makeSelfResult(7.0), opts);
    // The self-challenge preamble ("skeptical external evaluator") must NOT be injected for configured mode
    assert.ok(
      !promptSeen.includes('skeptical external evaluator'),
      'configured mode should not have self-challenge preamble',
    );
  });

  it('rationale is preserved in dimension results', async () => {
    const opts = makeOpts(() => JSON.stringify({ score: 5.5, rationale: 'Missing test coverage' }));
    const result = await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.ok(result.dimensions.some(d => d.rationale === 'Missing test coverage'));
  });

  it('mode is propagated to dimension results', async () => {
    const opts = makeOpts(
      () => JSON.stringify({ score: 5.0, rationale: 'ok' }),
      { adversaryResolution: { provider: 'grok', mode: 'ollama-auto' } },
    );
    const result = await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.ok(result.dimensions.every(d => d.mode === 'ollama-auto'));
  });

  it('generatedAt is a valid ISO timestamp', async () => {
    const opts = makeOpts(() => JSON.stringify({ score: 5.0, rationale: 'ok' }));
    const result = await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.doesNotThrow(() => new Date(result.generatedAt).toISOString());
    assert.ok(result.generatedAt.includes('T'));
  });

  it('summaryOnly makes exactly 1 LLM call', async () => {
    let callCount = 0;
    const opts: AdversarialScorerDimOptions = {
      adversaryResolution: SELF_CHALLENGE_RESOLUTION,
      summaryOnly: true,
      _callLLM: async () => {
        callCount++;
        return JSON.stringify({ score: 5.0, rationale: 'summary' });
      },
    };
    await generateAdversarialScore(makeSelfResult(7.0), opts);
    assert.equal(callCount, 1);
  });
});

describe('generateAdversarialScoreSummary', () => {
  it('returns correct shape', async () => {
    const opts: AdversarialScorerDimOptions = {
      adversaryResolution: CONFIGURED_RESOLUTION,
      _callLLM: async () => JSON.stringify({ score: 6.0, rationale: 'summary test' }),
    };
    const result = await generateAdversarialScoreSummary(7.5, 'Test project context', opts);
    assert.ok(typeof result.selfScore === 'number');
    assert.ok(typeof result.adversarialScore === 'number');
    assert.ok(typeof result.divergence === 'number');
    assert.ok(result.dimensions.length === 1);
  });

  it('adversaryResolution is passed through to result', async () => {
    const opts: AdversarialScorerDimOptions = {
      adversaryResolution: CONFIGURED_RESOLUTION,
      _callLLM: async () => JSON.stringify({ score: 6.0, rationale: 'ok' }),
    };
    const result = await generateAdversarialScoreSummary(7.0, 'context', opts);
    assert.equal(result.adversaryResolution.provider, 'grok');
    assert.equal(result.adversaryResolution.mode, 'configured');
  });
});
