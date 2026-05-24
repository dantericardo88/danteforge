// hybrid-retriever.test.ts — Phase L.3 hybrid retrieval tests.
//
// Uses the same fake-pipeline seam as vector-index.test.ts to avoid model
// downloads. Verifies the two-stage candidate-then-rerank workflow.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index } from '../src/matrix/search/bm25-index.js';
import { VectorIndex, type EmbedFn } from '../src/matrix/search/vector-index.js';
import { HybridRetriever, createHybridRetriever } from '../src/matrix/search/hybrid-retriever.js';

const FAKE_DIM = 8;

function makeFakeEmbedder(): EmbedFn {
  return async (text: string): Promise<Float32Array> => {
    const out = new Float32Array(FAKE_DIM);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      let h = 0;
      for (let j = 0; j < t.length; j++) h = (h * 31 + t.charCodeAt(j)) >>> 0;
      const idx = h % FAKE_DIM;
      out[idx] = (out[idx] ?? 0) + 1;
    }
    let norm = 0;
    for (let i = 0; i < FAKE_DIM; i++) norm += out[i]! * out[i]!;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < FAKE_DIM; i++) out[i] = out[i]! / norm;
    return out;
  };
}

describe('HybridRetriever', () => {
  it('returns empty when BM25 finds no candidates', async () => {
    const bm25 = new BM25Index();
    bm25.addDocument('a', 'apple banana');
    const vec = new VectorIndex({ _pipelineFactory: async () => makeFakeEmbedder() });
    await vec.buildFromCorpus([{ id: 'a', text: 'apple banana' }]);
    const r = new HybridRetriever(bm25, vec);
    const hits = await r.search('completely-different-term-xyz');
    assert.deepEqual(hits, []);
  });

  it('exact match has highest blended score', async () => {
    const docs = [
      { id: 'exact', text: 'apple banana cherry durian' },
      { id: 'partial', text: 'apple banana zebra yak' },
      { id: 'unrelated', text: 'zebra yak xylophone vodka' },
    ];
    const r = await createHybridRetriever(docs, { _pipelineFactory: async () => makeFakeEmbedder() });
    const hits = await r.search('apple banana cherry durian', { topK: 3 });
    assert.equal(hits[0]!.id, 'exact');
  });

  it('respects topK cap', async () => {
    const docs = Array.from({ length: 8 }, (_, i) => ({
      id: `d${i}`,
      text: `apple banana ${i}`,
    }));
    const r = await createHybridRetriever(docs, { _pipelineFactory: async () => makeFakeEmbedder() });
    const hits = await r.search('apple banana', { topK: 3 });
    assert.equal(hits.length, 3);
  });

  it('attaches meta from the vector index when present', async () => {
    const docs = [
      { id: 'a', text: 'apple banana cherry', meta: { file: 'src/a.ts', kind: 'function' } },
      { id: 'b', text: 'dog elephant fox' },
    ];
    const r = await createHybridRetriever(docs, { _pipelineFactory: async () => makeFakeEmbedder() });
    const hits = await r.search('apple banana cherry');
    const aHit = hits.find(h => h.id === 'a');
    assert.ok(aHit);
    assert.deepEqual(aHit!.meta, { file: 'src/a.ts', kind: 'function' });
  });
});
