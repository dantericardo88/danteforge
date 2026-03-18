import { describe, it } from 'node:test';
import assert from 'node:assert';
import { estimateTokens, estimateCost, chunkText, TOKEN_LIMITS } from '../src/core/token-estimator.js';

describe('estimateTokens', () => {
  it('estimates roughly 1 token per 4 chars', () => {
    assert.strictEqual(estimateTokens('abcd'), 1);
    assert.strictEqual(estimateTokens('abcdefgh'), 2);
  });

  it('returns 0 for empty string', () => {
    assert.strictEqual(estimateTokens(''), 0);
  });

  it('rounds up partial tokens', () => {
    assert.strictEqual(estimateTokens('abc'), 1); // 3/4 = 0.75 -> ceil = 1
  });
});

describe('estimateCost', () => {
  it('returns zero for ollama', () => {
    const cost = estimateCost(10000, 'ollama');
    assert.strictEqual(cost.totalEstimate, 0);
  });

  it('returns positive cost for paid providers', () => {
    const cost = estimateCost(100000, 'claude');
    assert.ok(cost.inputCost > 0);
    assert.ok(cost.outputCost > 0);
    assert.ok(cost.totalEstimate > 0);
  });

  it('output cost assumes 25% of input tokens', () => {
    const cost = estimateCost(1_000_000, 'openai');
    // Input: $2.50, Output: 250k tokens * $10/1M = $2.50
    assert.ok(cost.outputCost > 0);
  });
});

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('hello world', 100);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], 'hello world');
  });

  it('splits long text into multiple chunks', () => {
    const text = 'a'.repeat(500000);
    const chunks = chunkText(text, 100000);
    assert.ok(chunks.length >= 2);
  });

  it('tries to split at paragraph boundaries', () => {
    const text = 'paragraph one\n\nparagraph two\n\nparagraph three';
    const chunks = chunkText(text, 5); // very small limit forces split
    assert.ok(chunks.length >= 2);
  });

  it('handles empty text', () => {
    const chunks = chunkText('', 100);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], '');
  });
});

describe('TOKEN_LIMITS', () => {
  it('has limits for all providers', () => {
    assert.ok(TOKEN_LIMITS.grok > 0);
    assert.ok(TOKEN_LIMITS.claude > 0);
    assert.ok(TOKEN_LIMITS.openai > 0);
    assert.ok(TOKEN_LIMITS.gemini > 0);
    assert.ok(TOKEN_LIMITS.ollama > 0);
  });
});
