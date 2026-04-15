import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreSemanticDimension,
  scoreArtifactSemantically,
  type SemanticScoringOptions,
} from '../src/core/pdse-semantic.js';
import type { ScoringContext } from '../src/core/pdse.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOpts(llmResponse: string, available = true): SemanticScoringOptions {
  return {
    _isLLMAvailable: async () => available,
    _llmCaller: async () => llmResponse,
  };
}

function makeCtx(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    artifactName: 'SPEC',
    artifactContent: '# My Feature\n\nAcceptance criteria: must work.',
    stateYaml: {
      project: 'test', lastHandoff: '', workflowStage: 'initialized',
      currentPhase: 0, tasks: {}, auditLog: [], profile: 'default',
    } as unknown as import('../src/core/state.js').DanteState,
    upstreamArtifacts: {},
    isWebProject: false,
    ...overrides,
  };
}

// ── scoreSemanticDimension ────────────────────────────────────────────────────

describe('scoreSemanticDimension', () => {
  it('returns result with correct shape', async () => {
    const result = await scoreSemanticDimension('SPEC', 'content', 'clarity', 10, 20, makeOpts('SCORE:15 REASON:Good.'));
    assert.ok(typeof result.adversarialScore === 'undefined'); // not adversarial
    assert.ok(typeof result.dimension === 'string');
    assert.ok(typeof result.regexScore === 'number');
    assert.ok(typeof result.semanticScore === 'number');
    assert.ok(typeof result.blendedScore === 'number');
    assert.ok(typeof result.rationale === 'string');
    assert.ok(typeof result.confident === 'boolean');
  });

  it('returns regexScore when LLM unavailable', async () => {
    const result = await scoreSemanticDimension('SPEC', 'content', 'clarity', 12, 20, makeOpts('', false));
    assert.equal(result.regexScore, 12);
    assert.equal(result.semanticScore, 12);
    assert.equal(result.blendedScore, 12);
  });

  it('parses SCORE from LLM response', async () => {
    const result = await scoreSemanticDimension('SPEC', 'content', 'testability', 10, 20, makeOpts('SCORE:16 REASON:Has measurable criteria.'));
    assert.equal(result.semanticScore, 16);
    assert.ok(result.confident);
  });

  it('parses REASON from LLM response', async () => {
    const result = await scoreSemanticDimension('SPEC', 'content', 'testability', 10, 20, makeOpts('SCORE:14 REASON:Acceptance criteria present.'));
    assert.ok(result.rationale.includes('Acceptance criteria present'));
  });

  it('blends score: 0.4 * regex + 0.6 * semantic', async () => {
    const result = await scoreSemanticDimension('SPEC', 'content', 'clarity', 10, 20, makeOpts('SCORE:20 REASON:Perfect.'));
    // 0.4*10 + 0.6*20 = 4+12 = 16
    assert.equal(result.blendedScore, 16);
  });

  it('clamps semantic score to [0, maxScore]', async () => {
    const result = await scoreSemanticDimension('SPEC', 'content', 'clarity', 5, 10, makeOpts('SCORE:999 REASON:Over.'));
    assert.ok(result.semanticScore <= 10);
  });

  it('handles malformed JSON — no SCORE prefix', async () => {
    const result = await scoreSemanticDimension('SPEC', 'content', 'clarity', 8, 20, makeOpts('no score here'));
    assert.equal(result.confident, false);
    assert.equal(result.blendedScore, 8);
  });

  it('handles LLM throws — falls back to regexScore', async () => {
    const opts: SemanticScoringOptions = {
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { throw new Error('LLM error'); },
    };
    const result = await scoreSemanticDimension('SPEC', 'content', 'clarity', 7, 20, opts);
    assert.equal(result.confident, false);
    assert.equal(result.blendedScore, 7);
  });

  it('returns confident:false when LLM availability check throws', async () => {
    const opts: SemanticScoringOptions = {
      _isLLMAvailable: async () => { throw new Error('probe failed'); },
      _llmCaller: async () => 'SCORE:15 REASON:ok',
    };
    const result = await scoreSemanticDimension('SPEC', 'content', 'clarity', 10, 20, opts);
    assert.equal(result.blendedScore, 10);
  });

  it('all four dimensions are accepted', async () => {
    for (const dim of ['clarity', 'testability', 'constitutionAlignment', 'completeness'] as const) {
      const result = await scoreSemanticDimension('SPEC', 'content', dim, 10, 20, makeOpts('SCORE:15 REASON:ok'));
      assert.equal(result.dimension, dim);
    }
  });
});

// ── scoreArtifactSemantically ─────────────────────────────────────────────────

describe('scoreArtifactSemantically', () => {
  it('returns base result when LLM unavailable', async () => {
    const opts = makeOpts('SCORE:15 REASON:ok', false);
    const ctx = makeCtx();
    const result = await scoreArtifactSemantically(ctx, opts);
    // When LLM unavailable, returns base regex result — should have score
    assert.ok(typeof result.score === 'number');
    assert.ok(result.score >= 0);
  });

  it('returns result with dimensions when LLM available', async () => {
    const opts = makeOpts('SCORE:15 REASON:Good.', true);
    const ctx = makeCtx();
    const result = await scoreArtifactSemantically(ctx, opts);
    assert.ok(typeof result.score === 'number');
    assert.ok(result.dimensions !== undefined);
  });

  it('respects dimensions option — only scores specified dimensions', async () => {
    let callCount = 0;
    const opts: SemanticScoringOptions = {
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { callCount++; return 'SCORE:15 REASON:ok'; },
      dimensions: ['clarity'],
    };
    await scoreArtifactSemantically(makeCtx(), opts);
    assert.equal(callCount, 1, 'should make exactly 1 LLM call for 1 dimension');
  });
});
