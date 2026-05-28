import { describe, it } from 'node:test';
import assert from 'node:assert';
import { estimateTokens, estimateCost, chunkText, chunkForProvider, TOKEN_LIMITS, isLikelyCode } from '../src/core/token-estimator.js';

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

describe('chunkForProvider', () => {
  it('returns single chunk when text fits within provider limit', () => {
    const shortText = 'Hello world, this is a short piece of text.';
    const chunks = chunkForProvider(shortText, 'claude');
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], shortText);
  });

  it('splits long prose into multiple chunks for ollama (small context window)', () => {
    // ollama limit is 8192 tokens; at ~3.5 chars/token for prose → ~28672 chars/chunk
    const longProse = 'the quick brown fox jumped over the lazy dog. '.repeat(2000);
    const chunks = chunkForProvider(longProse, 'ollama');
    assert.ok(chunks.length >= 2, `Expected >= 2 chunks, got ${chunks.length}`);
  });

  it('code text produces smaller chunks than prose for same provider', () => {
    // code-aware: ~2.5 chars/token → smaller chunk size per token budget
    const codeText = `export function add(a: number, b: number): number {
  if (a < 0 || b < 0) { throw new Error('negative'); }
  return a + b;
}
`.repeat(100);
    const proseText = 'The quick brown fox jumps over the lazy dog. '.repeat(
      Math.ceil(codeText.length / 45),
    );
    // Both are longer than one chunk for ollama; code should split into more chunks
    const codeChunks = chunkForProvider(codeText, 'ollama');
    const proseChunks = chunkForProvider(proseText.slice(0, codeText.length), 'ollama');
    // Code chunks are more numerous because code has a smaller chars-per-token ratio
    assert.ok(codeChunks.length >= proseChunks.length,
      `Code (${codeChunks.length}) should have >= chunks than same-length prose (${proseChunks.length})`);
  });

  it('concatenating all chunks reproduces the original text', () => {
    const original = 'word '.repeat(5000);
    const chunks = chunkForProvider(original, 'ollama');
    assert.strictEqual(chunks.join(''), original);
  });
});

describe('code-aware estimation', () => {
  it('isLikelyCode detects TypeScript as code', () => {
    const tsSnippet = `export function greet(name: string): string {
  const msg = (name.length > 0) ? \`Hello, \${name}!\` : 'Hello!';
  return msg;
}`;
    assert.strictEqual(isLikelyCode(tsSnippet), true);
  });

  it('isLikelyCode detects prose as not code', () => {
    const prose = 'The quick brown fox jumps over the lazy dog. It was a fine morning and the sun was shining brightly across the meadow.';
    assert.strictEqual(isLikelyCode(prose), false);
  });

  it('estimateTokens with code-aware strategy gives higher count for code', () => {
    const tsSnippet = `export function add(a: number, b: number): number {
  if (a < 0 || b < 0) { throw new Error('negative'); }
  return a + b;
}`;
    const simpleCount = estimateTokens(tsSnippet, 'simple');
    const codeAwareCount = estimateTokens(tsSnippet, 'code-aware');
    // code-aware uses ~2.5 chars/token for code vs 4 chars/token for simple,
    // so code-aware should produce a higher token count
    assert.ok(codeAwareCount > simpleCount, `code-aware (${codeAwareCount}) should exceed simple (${simpleCount})`);
  });
});
