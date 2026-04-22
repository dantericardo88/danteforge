import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFileHash,
  levenshteinSimilarity,
  fuzzyMatchEntity,
  hasStubContent,
} from '../src/core/wiki-ingestor.js';

describe('computeFileHash', () => {
  it('returns a hex string', () => {
    const hash = computeFileHash('hello world');
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  });

  it('same content produces same hash', () => {
    const a = computeFileHash('same content');
    const b = computeFileHash('same content');
    assert.equal(a, b);
  });

  it('different content produces different hash', () => {
    const a = computeFileHash('content a');
    const b = computeFileHash('content b');
    assert.notEqual(a, b);
  });

  it('handles empty string', () => {
    const hash = computeFileHash('');
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  });
});

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    assert.equal(levenshteinSimilarity('hello', 'hello'), 1);
  });

  it('returns 0 when one string is empty', () => {
    assert.equal(levenshteinSimilarity('hello', ''), 0);
    assert.equal(levenshteinSimilarity('', 'hello'), 0);
  });

  it('returns 1 for case-insensitive match', () => {
    assert.equal(levenshteinSimilarity('Hello', 'HELLO'), 1);
  });

  it('returns value between 0 and 1 for similar strings', () => {
    const score = levenshteinSimilarity('kitten', 'sitting');
    assert.ok(score > 0 && score < 1, `Expected 0 < score < 1, got ${score}`);
  });

  it('similar strings score higher than dissimilar ones', () => {
    const close = levenshteinSimilarity('autoforge', 'autofarce');
    const far = levenshteinSimilarity('autoforge', 'xyz');
    assert.ok(close > far);
  });
});

describe('fuzzyMatchEntity', () => {
  it('returns null for empty entity list', () => {
    const result = fuzzyMatchEntity('my-func', []);
    assert.equal(result, null);
  });

  it('returns best match when above threshold', () => {
    const result = fuzzyMatchEntity('autoforge', ['autoforge', 'autofarce', 'other']);
    assert.ok(result !== null);
    assert.equal(result.entityId, 'autoforge');
    assert.equal(result.score, 1);
  });

  it('returns null when no match exceeds default threshold', () => {
    const result = fuzzyMatchEntity('xyz', ['autoforge', 'magic', 'ascend']);
    assert.equal(result, null);
  });

  it('uses custom threshold', () => {
    // With threshold 0.5, 'kite' and 'bite' are close enough
    const result = fuzzyMatchEntity('kite', ['bite', 'dog', 'cat'], 0.5);
    assert.ok(result !== null);
  });
});

describe('hasStubContent', () => {
  it('returns false for normal content', () => {
    const result = hasStubContent('export function doSomething() { return 42; }');
    assert.equal(result, false);
  });

  it('detects TODO stub pattern', () => {
    const result = hasStubContent('// TODO: implement this function');
    assert.ok(result, 'Expected stub detection for TODO comment');
  });

  it('detects not implemented pattern', () => {
    const result = hasStubContent('throw new Error("Not implemented")');
    assert.ok(result, 'Expected stub detection for not-implemented');
  });

  it('is case-insensitive', () => {
    const result = hasStubContent('// todo: implement this');
    assert.ok(result);
  });
});
