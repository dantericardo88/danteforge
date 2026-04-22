import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDebateScore,
  buildAdvocatePrompt,
  buildAdversaryPrompt,
  parseScoreFromResponse,
  blendDebateScore,
  type AdversarialScorerOptions,
} from '../src/core/adversarial-scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SAMPLE_OLD = `function add(a, b) { return a + b; }`;
const SAMPLE_NEW = `function add(a: number, b: number): number { return a + b; }`;

function makeLLM(advocateScore: number, adversaryScore: number): AdversarialScorerOptions {
  let callCount = 0;
  return {
    _isLLMAvailable: async () => true,
    _llmCaller: async (_prompt: string) => {
      callCount++;
      const score = callCount === 1 ? advocateScore : adversaryScore;
      return JSON.stringify({ score, summary: `Call ${callCount} summary` });
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseScoreFromResponse', () => {
  it('T1: parses valid JSON with score field', () => {
    assert.equal(parseScoreFromResponse('{"score": 7.5, "summary": "good"}'), 7.5);
  });

  it('T2: parses score from malformed JSON via regex fallback', () => {
    const result = parseScoreFromResponse('"score": 8, "summary": "ok"');
    assert.equal(result, 8);
  });

  it('T3: clamps score to [0, 10]', () => {
    assert.equal(parseScoreFromResponse('{"score": 15}'), 10);
    assert.equal(parseScoreFromResponse('{"score": -3}'), 0);
  });

  it('T4: returns 5.0 neutral on unparseable response', () => {
    assert.equal(parseScoreFromResponse('no numbers here at all'), 5.0);
  });
});

describe('buildAdvocatePrompt / buildAdversaryPrompt', () => {
  it('T5: advocate prompt contains ADVOCATE role instruction', () => {
    const prompt = buildAdvocatePrompt(SAMPLE_NEW, SAMPLE_OLD);
    assert.ok(prompt.includes('ADVOCATE'), 'should contain ADVOCATE role');
    assert.ok(prompt.includes('improvements'), 'should ask for improvements');
  });

  it('T6: adversary prompt contains ADVERSARY role and regression focus', () => {
    const prompt = buildAdversaryPrompt(SAMPLE_NEW, SAMPLE_OLD);
    assert.ok(prompt.includes('ADVERSARY'), 'should contain ADVERSARY role');
    assert.ok(prompt.includes('WORSE') || prompt.includes('regressions'), 'should focus on regressions');
  });

  it('T7: both prompts include current and previous code', () => {
    const advocate = buildAdvocatePrompt(SAMPLE_NEW, SAMPLE_OLD);
    const adversary = buildAdversaryPrompt(SAMPLE_NEW, SAMPLE_OLD);
    assert.ok(advocate.includes('PREVIOUS CODE') && advocate.includes('CURRENT CODE'));
    assert.ok(adversary.includes('PREVIOUS CODE') && adversary.includes('CURRENT CODE'));
  });
});

describe('runDebateScore', () => {
  it('T8: returns neutral result when LLM unavailable', async () => {
    const result = await runDebateScore(SAMPLE_NEW, SAMPLE_OLD, {
      _isLLMAvailable: async () => false,
    });

    assert.equal(result.advocateScore, 5.0);
    assert.equal(result.adversaryScore, 5.0);
    assert.equal(result.debateScore, 5.0);
    assert.equal(result.contested, false);
  });

  it('T9: blends advocate and adversary scores correctly', async () => {
    const result = await runDebateScore(SAMPLE_NEW, SAMPLE_OLD, makeLLM(8.0, 6.0));

    assert.equal(result.advocateScore, 8.0);
    assert.equal(result.adversaryScore, 6.0);
    assert.equal(result.debateScore, 7.0, 'debate = (8+6)/2 = 7.0');
  });

  it('T10: marks result as contested when gap > threshold', async () => {
    const result = await runDebateScore(SAMPLE_NEW, SAMPLE_OLD, {
      ...makeLLM(9.0, 3.0),
      contestThreshold: 2.0,
    });

    assert.equal(result.contested, true, 'gap of 6.0 should be contested');
    assert.ok(result.confidence < 0.5, 'large gap = low confidence');
  });

  it('T10b: not contested when gap is within threshold', async () => {
    const result = await runDebateScore(SAMPLE_NEW, SAMPLE_OLD, {
      ...makeLLM(7.0, 6.0),
      contestThreshold: 2.0,
    });

    assert.equal(result.contested, false, 'gap of 1.0 is within threshold');
  });
});

describe('blendDebateScore', () => {
  it('T11: blends 50/50 when debate is available', () => {
    const debate = {
      advocateScore: 8, adversaryScore: 6, debateScore: 7.0,
      advocateSummary: 'good', adversarySummary: 'ok',
      contested: false, confidence: 0.8,
    };
    // hybrid=8.0, debate=7.0 → 0.5*8 + 0.5*7 = 7.5
    assert.equal(blendDebateScore(8.0, debate), 7.5);
  });

  it('T12: returns hybrid unchanged when LLM was unavailable (neutral result)', () => {
    const neutral = {
      advocateScore: 5, adversaryScore: 5, debateScore: 5.0,
      advocateSummary: 'LLM unavailable', adversarySummary: 'LLM unavailable',
      contested: false, confidence: 1.0,
    };
    assert.equal(blendDebateScore(8.0, neutral), 8.0);
  });
});

// ── Mutation-killing boundary tests ──────────────────────────────────────────

describe('runDebateScore + blendDebateScore — mutation boundaries', () => {
  it('Tmut1: gap=2.0 is NOT contested; gap=2.001 IS contested — kills > vs >= mutation', async () => {
    // With contestThreshold=2.0:
    //   advocate=8.0, adversary=6.0 → gap=2.0 → NOT contested (> not >=)
    const resultAt2 = await runDebateScore(SAMPLE_NEW, SAMPLE_OLD, {
      ...makeLLM(8.0, 6.0),
      contestThreshold: 2.0,
    });
    assert.equal(resultAt2.contested, false, 'gap=2.0 should NOT be contested (strict >)');

    //   advocate=9.0, adversary=6.999 → gap=2.001 → IS contested
    let callIdx2 = 0;
    const resultAbove2 = await runDebateScore(SAMPLE_NEW, SAMPLE_OLD, {
      _isLLMAvailable: async () => true,
      _llmCaller: async () => {
        callIdx2++;
        const score = callIdx2 === 1 ? 9.001 : 6.999;
        return JSON.stringify({ score, summary: 'test' });
      },
      contestThreshold: 2.0,
    });
    assert.equal(resultAbove2.contested, true, 'gap>2.0 should be contested');
  });

  it('Tmut2: confidence formula = 1 - (gap / 10) — kills division/subtraction mutations', async () => {
    // advocate=9, adversary=3 → gap=6 → confidence = 1 - 6/10 = 0.4
    // If formula were `gap / 10` alone: 0.6; if `1 - gap`: -5
    const result = await runDebateScore(SAMPLE_NEW, SAMPLE_OLD, {
      ...makeLLM(9.0, 3.0),
      contestThreshold: 2.0,
    });
    assert.equal(result.confidence, 0.4, `expected confidence=0.4 (1 - 6/10), got ${result.confidence}`);
  });

  it('Tmut3: blendDebateScore bypasses ONLY for exact "LLM unavailable" string', () => {
    // Kills string comparison mutations
    const exactNeutral = {
      advocateScore: 5, adversaryScore: 5, debateScore: 5.0,
      advocateSummary: 'LLM unavailable', adversarySummary: 'LLM unavailable',
      contested: false, confidence: 1.0,
    };
    // Exact match → bypass (return hybrid unchanged)
    assert.equal(blendDebateScore(8.0, exactNeutral), 8.0,
      'exact "LLM unavailable" should return hybrid unchanged');

    // Different summary → blend (not bypass)
    const notNeutral = { ...exactNeutral, advocateSummary: 'available' };
    assert.equal(blendDebateScore(8.0, notNeutral), 6.5,
      'non-neutral summary should blend: 0.5×8 + 0.5×5 = 6.5');
  });
});
