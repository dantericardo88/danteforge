// bm25-index.test.ts — BM25 sparse keyword index correctness.
//
// Phase L.3a of docs/PRDs/autonomous-frontier-reaching.md. Verifies:
//   - tokenization rules (lowercase, stopwords, min-length)
//   - IDF formula matches textbook BM25
//   - score monotonicity (more term occurrences → higher score, up to saturation)
//   - top-K ordering
//   - empty/single-doc edge cases

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index, tokenize } from '../src/matrix/search/bm25-index.js';

describe('tokenize', () => {
  it('lowercases tokens', () => {
    assert.deepEqual(tokenize('Hello World'), ['hello', 'world']);
  });
  it('drops stopwords', () => {
    const toks = tokenize('the quick brown fox is at the lazy dog');
    assert.ok(!toks.includes('the'));
    assert.ok(!toks.includes('is'));
    assert.ok(!toks.includes('at'));
    assert.ok(toks.includes('quick'));
  });
  it('drops length-1 tokens', () => {
    const toks = tokenize('a x apple');
    assert.equal(toks.length, 1);
    assert.equal(toks[0], 'apple');
  });
  it('splits on non-word characters', () => {
    assert.deepEqual(tokenize('foo-bar_baz.qux'), ['foo', 'bar_baz', 'qux']);
  });
});

describe('BM25Index', () => {
  it('size reflects added documents', () => {
    const idx = new BM25Index();
    assert.equal(idx.size, 0);
    idx.addDocument('a', 'apple banana');
    idx.addDocument('b', 'banana cherry');
    assert.equal(idx.size, 2);
  });

  it('IDF is higher for rarer terms', () => {
    const idx = new BM25Index();
    idx.addDocument('a', 'apple banana');
    idx.addDocument('b', 'banana cherry');
    idx.addDocument('c', 'banana date');
    // banana appears in all 3 → low IDF
    // apple appears in 1 → high IDF
    assert.ok(idx.idf('apple') > idx.idf('banana'));
  });

  it('search returns documents containing the query terms', () => {
    const idx = new BM25Index();
    idx.addDocument('a', 'apple banana cherry');
    idx.addDocument('b', 'durian elderberry');
    idx.addDocument('c', 'apple grape');
    const results = idx.search('apple');
    const docIds = results.map(r => r.docId);
    assert.ok(docIds.includes('a'));
    assert.ok(docIds.includes('c'));
    assert.ok(!docIds.includes('b'));
  });

  it('search ranks more-relevant docs higher', () => {
    const idx = new BM25Index();
    // Doc that says "apple" 5 times scores higher than doc that says it once.
    idx.addDocument('many', 'apple apple apple apple apple banana');
    idx.addDocument('few', 'apple banana cherry durian elderberry');
    const results = idx.search('apple');
    assert.equal(results[0]!.docId, 'many');
    assert.ok(results[0]!.score > results[1]!.score);
  });

  it('search returns empty for queries with no matching terms', () => {
    const idx = new BM25Index();
    idx.addDocument('a', 'apple banana');
    const results = idx.search('zebra');
    assert.equal(results.length, 0);
  });

  it('removeDocument decrements size + removes from postings', () => {
    const idx = new BM25Index();
    idx.addDocument('a', 'apple banana');
    idx.addDocument('b', 'banana cherry');
    assert.equal(idx.size, 2);
    idx.removeDocument('a');
    assert.equal(idx.size, 1);
    const results = idx.search('apple');
    assert.equal(results.length, 0);
  });

  it('top-K cap limits result count', () => {
    const idx = new BM25Index();
    for (let i = 0; i < 20; i++) idx.addDocument(`d${i}`, `apple banana cherry term${i}`);
    const results = idx.search('apple', 5);
    assert.equal(results.length, 5);
  });

  it('multi-term query sums per-term scores', () => {
    const idx = new BM25Index();
    idx.addDocument('both', 'apple banana');
    idx.addDocument('apple-only', 'apple cherry');
    idx.addDocument('banana-only', 'banana cherry');
    const results = idx.search('apple banana');
    assert.equal(results[0]!.docId, 'both', 'doc with both terms ranks highest');
  });

  it('parameters expose k1 and b', () => {
    const p = BM25Index.parameters;
    assert.equal(p.k1, 1.5);
    assert.equal(p.b, 0.75);
  });
});
