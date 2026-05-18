// simhash-index.test.ts — Phase L.3c approximate similarity.
//
// Honest scope: verifies SimHash properties + index search behavior.
// Not asserting "semantic similarity" — only structural / lexical similarity.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SimhashIndex,
  simhash64,
  hammingDistance,
  similarity,
} from '../src/matrix/search/simhash-index.js';

describe('simhash64', () => {
  it('returns 0 for empty text', () => {
    assert.equal(simhash64(''), 0n);
  });

  it('returns identical hashes for identical input', () => {
    const a = simhash64('the quick brown fox jumps over the lazy dog');
    const b = simhash64('the quick brown fox jumps over the lazy dog');
    assert.equal(a, b);
  });

  it('returns similar hashes for similar input (high similarity)', () => {
    const a = simhash64('export function widgetMaker() { return widget; }');
    const b = simhash64('export function widgetMaker() { return widgets; }');
    const sim = similarity(a, b);
    assert.ok(sim > 0.7, `expected similarity > 0.7, got ${sim}`);
  });

  it('returns different hashes for unrelated input (low similarity)', () => {
    const a = simhash64('apple banana cherry durian elderberry fig grape');
    const b = simhash64('zebra yak xylophone whisky vodka uranium tundra');
    const sim = similarity(a, b);
    assert.ok(sim < 0.7, `expected similarity < 0.7, got ${sim}`);
  });
});

describe('hammingDistance + similarity', () => {
  it('returns 0 for identical hashes', () => {
    assert.equal(hammingDistance(0xabcdn, 0xabcdn), 0);
    assert.equal(similarity(0xabcdn, 0xabcdn), 1.0);
  });

  it('returns 64 for fully-inverted hashes', () => {
    const all = (1n << 64n) - 1n;
    assert.equal(hammingDistance(0n, all), 64);
    assert.equal(similarity(0n, all), 0);
  });

  it('returns 1 when exactly one bit differs', () => {
    assert.equal(hammingDistance(0n, 1n), 1);
  });
});

describe('SimhashIndex', () => {
  it('size reflects entries added', () => {
    const idx = new SimhashIndex();
    assert.equal(idx.size, 0);
    idx.add('a', 'apple banana');
    idx.add('b', 'cherry durian');
    assert.equal(idx.size, 2);
  });

  it('add replaces existing entries with the same id', () => {
    const idx = new SimhashIndex();
    idx.add('a', 'first');
    idx.add('a', 'second');
    assert.equal(idx.size, 1);
  });

  it('search ranks similar chunks higher', () => {
    const idx = new SimhashIndex();
    idx.add('very-similar', 'function alpha returns the alpha widget value');
    idx.add('somewhat-similar', 'function alpha returns the beta widget result');
    idx.add('unrelated', 'database connection pool initialization');
    const hits = idx.search('function alpha returns alpha widget', 10);
    assert.equal(hits[0]!.id, 'very-similar', `top hit was ${hits[0]!.id}`);
    assert.ok(hits[0]!.similarity >= hits[1]!.similarity);
  });

  it('search respects topK cap', () => {
    const idx = new SimhashIndex();
    for (let i = 0; i < 20; i++) idx.add(`d${i}`, `chunk number ${i} with shared terms apple banana`);
    const hits = idx.search('apple banana', 5);
    assert.equal(hits.length, 5);
  });

  it('search filters by maxDistance', () => {
    const idx = new SimhashIndex();
    idx.add('close', 'apple banana cherry');
    idx.add('far', 'unrelated zebra xylophone vodka tundra');
    // Very tight maxDistance — only the close one should survive.
    const hits = idx.search('apple banana cherry', 10, 5);
    assert.equal(hits[0]!.id, 'close');
  });

  it('serialize + restore round-trip preserves entries', () => {
    const idx = new SimhashIndex();
    idx.add('a', 'apple banana');
    idx.add('b', 'cherry durian', { file: 'src/foo.ts' });
    const serialized = idx.toJSON();
    const restored = SimhashIndex.fromJSON(serialized);
    assert.equal(restored.size, 2);
    const hitsForA = restored.search('apple banana');
    assert.equal(hitsForA[0]!.id, 'a');
    assert.equal(hitsForA[0]!.meta, undefined);
    const hitsForB = restored.search('cherry durian');
    assert.deepEqual(hitsForB[0]!.meta, { file: 'src/foo.ts' });
  });

  it('searchByHash works with a precomputed hash', () => {
    const idx = new SimhashIndex();
    idx.add('apple-doc', 'apple banana cherry');
    const queryHash = simhash64('apple banana cherry');
    const hits = idx.searchByHash(queryHash);
    assert.equal(hits[0]!.id, 'apple-doc');
    assert.equal(hits[0]!.similarity, 1.0);
  });
});
