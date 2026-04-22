import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateAdversarialCritique } from '../src/core/adversarial-critique.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';

// ── Stub dimension ────────────────────────────────────────────────────────────

function makeDim(id: string, label: string, score = 6.0): MatrixDimension {
  return {
    id,
    label,
    scores: { self: score },
    status: 'active',
    priority: 1,
    harvest_source: undefined,
    ceiling: undefined,
    ceilingReason: undefined,
    sprint_history: [],
  };
}

const DIM = makeDim('error_handling', 'Error Handling', 6.0);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateAdversarialCritique', () => {
  it('returns satisfied:true when LLM responds satisfied', async () => {
    const critique = await generateAdversarialCritique(DIM, 8.5, 9.0, 'Added circuit breaker.', {
      _callLLM: async () => JSON.stringify({
        satisfied: true,
        gapAnalysis: 'Looks good',
        concreteActions: ['Keep it up'],
      }),
    });
    assert.equal(critique.satisfied, true);
    assert.equal(critique.currentScore, 8.5);
    assert.equal(critique.targetScore, 9.0);
  });

  it('returns satisfied:false with gap analysis when LLM is not satisfied', async () => {
    const critique = await generateAdversarialCritique(DIM, 6.0, 9.0, 'Added try-catch.', {
      _callLLM: async () => JSON.stringify({
        satisfied: false,
        gapAnalysis: 'Missing error hierarchy, circuit breaker not wired',
        concreteActions: ['Add custom error classes', 'Wire circuit breaker into callLLM'],
      }),
    });
    assert.equal(critique.satisfied, false);
    assert.ok(critique.gapAnalysis.length > 0);
    assert.equal(critique.concreteActions.length, 2);
  });

  it('critiquePrompt contains the dimension label', async () => {
    const critique = await generateAdversarialCritique(DIM, 6.0, 9.0, 'Some work.', {
      _callLLM: async () => JSON.stringify({
        satisfied: false,
        gapAnalysis: 'Still missing',
        concreteActions: ['Fix it'],
      }),
    });
    assert.ok(critique.critiquePrompt.includes('Error Handling'), 'should contain dimension label');
  });

  it('critiquePrompt includes all concreteActions', async () => {
    const critique = await generateAdversarialCritique(DIM, 6.0, 9.0, 'Some work.', {
      _callLLM: async () => JSON.stringify({
        satisfied: false,
        gapAnalysis: 'gaps',
        concreteActions: ['Action Alpha', 'Action Beta', 'Action Gamma'],
      }),
    });
    assert.ok(critique.critiquePrompt.includes('Action Alpha'));
    assert.ok(critique.critiquePrompt.includes('Action Beta'));
    assert.ok(critique.critiquePrompt.includes('Action Gamma'));
  });

  it('falls back gracefully on invalid JSON (no throw)', async () => {
    const critique = await generateAdversarialCritique(DIM, 5.0, 9.0, 'Work done.', {
      _callLLM: async () => 'not json at all',
    });
    // Should return without throwing
    assert.equal(typeof critique.satisfied, 'boolean');
    assert.equal(critique.satisfied, false); // conservative fallback
    assert.equal(critique.currentScore, 5.0);
  });

  it('falls back gracefully when LLM call rejects', async () => {
    const critique = await generateAdversarialCritique(DIM, 5.0, 9.0, 'Work done.', {
      _callLLM: async () => { throw new Error('LLM unavailable'); },
    });
    assert.equal(critique.satisfied, false);
    assert.ok(typeof critique.gapAnalysis === 'string');
    assert.ok(Array.isArray(critique.concreteActions));
  });

  it('passes scorerProvider as second arg to _callLLM', async () => {
    let capturedProvider: unknown;
    await generateAdversarialCritique(DIM, 6.0, 9.0, 'Work.', {
      scorerProvider: 'grok',
      _callLLM: async (_prompt, provider) => {
        capturedProvider = provider;
        return JSON.stringify({ satisfied: false, gapAnalysis: 'gap', concreteActions: [] });
      },
    });
    assert.equal(capturedProvider, 'grok');
  });

  it('does not pass scorerProvider when not set', async () => {
    let capturedProvider: unknown = 'SENTINEL';
    await generateAdversarialCritique(DIM, 6.0, 9.0, 'Work.', {
      _callLLM: async (_prompt, provider) => {
        capturedProvider = provider;
        return JSON.stringify({ satisfied: false, gapAnalysis: 'gap', concreteActions: [] });
      },
    });
    assert.equal(capturedProvider, undefined);
  });

  it('"competitive position" framing appears in LLM prompt', async () => {
    let capturedPrompt = '';
    await generateAdversarialCritique(DIM, 6.0, 9.0, 'Work.', {
      _callLLM: async (prompt) => {
        capturedPrompt = prompt;
        return JSON.stringify({ satisfied: false, gapAnalysis: 'gap', concreteActions: [] });
      },
    });
    assert.ok(
      capturedPrompt.toLowerCase().includes('competitive position'),
      'prompt should include "competitive position" framing to prevent score inflation',
    );
  });

  it('concreteActions is always an array even when LLM omits it', async () => {
    const critique = await generateAdversarialCritique(DIM, 6.0, 9.0, 'Work.', {
      _callLLM: async () => JSON.stringify({ satisfied: false, gapAnalysis: 'gap' }),
    });
    assert.ok(Array.isArray(critique.concreteActions));
  });

  it('currentScore and targetScore preserved in output', async () => {
    const critique = await generateAdversarialCritique(DIM, 3.5, 8.0, 'Work.', {
      _callLLM: async () => JSON.stringify({ satisfied: false, gapAnalysis: 'gap', concreteActions: [] }),
    });
    assert.equal(critique.currentScore, 3.5);
    assert.equal(critique.targetScore, 8.0);
  });

  it('generatedAt is a valid ISO timestamp', async () => {
    const critique = await generateAdversarialCritique(DIM, 6.0, 9.0, 'Work.', {
      _callLLM: async () => JSON.stringify({ satisfied: false, gapAnalysis: 'gap', concreteActions: [] }),
    });
    assert.ok(typeof critique.generatedAt === 'string');
    assert.ok(!isNaN(Date.parse(critique.generatedAt)), 'generatedAt should be a valid date');
  });

  it('_callLLM is called exactly once per invocation', async () => {
    let callCount = 0;
    await generateAdversarialCritique(DIM, 6.0, 9.0, 'Work.', {
      _callLLM: async () => {
        callCount++;
        return JSON.stringify({ satisfied: false, gapAnalysis: 'gap', concreteActions: [] });
      },
    });
    assert.equal(callCount, 1);
  });

  it('handles LLM returning concreteActions with non-string elements gracefully', async () => {
    const critique = await generateAdversarialCritique(DIM, 6.0, 9.0, 'Work.', {
      _callLLM: async () => JSON.stringify({
        satisfied: false,
        gapAnalysis: 'gap',
        concreteActions: ['valid', 42, null, 'also valid'],
      }),
    });
    // Non-string elements should be filtered out
    assert.ok(critique.concreteActions.every(a => typeof a === 'string'));
    assert.ok(critique.concreteActions.includes('valid'));
    assert.ok(critique.concreteActions.includes('also valid'));
  });
});
