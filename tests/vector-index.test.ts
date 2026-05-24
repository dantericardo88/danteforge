// vector-index.test.ts — Phase L.3c transformer-embedding tests.
//
// Honest scope: these tests do NOT download the @xenova/transformers model.
// They use the `_pipelineFactory` seam to inject a deterministic fake
// embedding function. This keeps tests fast and offline-safe while still
// exercising the quantization + cosine + persistence paths.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  VectorIndex,
  _internals,
  type EmbedFn,
} from '../src/matrix/search/vector-index.js';

// ── Fake embedding pipeline ──────────────────────────────────────────────────

const FAKE_DIM = 8;

/**
 * Deterministic fake embedder. Hashes the text into a fixed-dimension float
 * vector. Identical inputs produce identical vectors; lexically similar inputs
 * produce vectors with similar leading dimensions.
 */
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
    // Normalize so cosine is meaningful.
    let norm = 0;
    for (let i = 0; i < FAKE_DIM; i++) norm += out[i]! * out[i]!;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < FAKE_DIM; i++) out[i] = out[i]! / norm;
    return out;
  };
}

// ── Internals ────────────────────────────────────────────────────────────────

describe('_internals.quantize/dequantize', () => {
  it('round-trips approximately for a typical float vector', () => {
    const v = new Float32Array([0.1, -0.3, 0.7, -0.9, 0.0]);
    const scales = _internals.buildScales([v]);
    const q = _internals.quantize(v, scales);
    const dq = _internals.dequantize(q, scales);
    for (let i = 0; i < v.length; i++) {
      assert.ok(Math.abs(v[i]! - dq[i]!) < 1e-3, `dim ${i}: ${v[i]} vs ${dq[i]}`);
    }
  });

  it('quantizes within int8 bounds', () => {
    const v = new Float32Array([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0]);
    const scales = { scale: new Float32Array([1, 1, 1]), midpoint: new Float32Array([0, 0, 0]) };
    const q = _internals.quantize(v, scales);
    for (const value of q) assert.ok(value >= -128 && value <= 127);
  });
});

describe('_internals.cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    assert.equal(_internals.cosineSimilarity(a, b), 1);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    assert.equal(_internals.cosineSimilarity(a, b), 0);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    assert.equal(_internals.cosineSimilarity(a, b), -1);
  });
});

// ── VectorIndex ──────────────────────────────────────────────────────────────

describe('VectorIndex', () => {
  it('buildFromCorpus + search ranks identical document highest', async () => {
    const idx = new VectorIndex({ _pipelineFactory: async () => makeFakeEmbedder() });
    await idx.buildFromCorpus([
      { id: 'a', text: 'apple banana cherry' },
      { id: 'b', text: 'dog elephant fox' },
      { id: 'c', text: 'zebra yak xylophone' },
    ]);
    const hits = await idx.search('apple banana cherry');
    assert.equal(hits[0]!.id, 'a');
    // Quantization round-trip + cosine accumulates float error; use a tight tolerance.
    assert.ok(Math.abs(hits[0]!.similarity - 1) < 1e-6, `expected ~1, got ${hits[0]!.similarity}`);
  });

  it('search returns empty when the index is empty', async () => {
    const idx = new VectorIndex({ _pipelineFactory: async () => makeFakeEmbedder() });
    const hits = await idx.search('anything');
    assert.deepEqual(hits, []);
  });

  it('size + dim reflect the corpus after build', async () => {
    const idx = new VectorIndex({ _pipelineFactory: async () => makeFakeEmbedder() });
    await idx.buildFromCorpus([
      { id: 'a', text: 'one' },
      { id: 'b', text: 'two' },
    ]);
    assert.equal(idx.size, 2);
    assert.equal(idx.dim, FAKE_DIM);
  });

  it('toJSON + fromJSON round-trip preserves entries', async () => {
    const idx = new VectorIndex({ _pipelineFactory: async () => makeFakeEmbedder() });
    await idx.buildFromCorpus([
      { id: 'a', text: 'apple banana', meta: { file: 'src/a.ts' } },
      { id: 'b', text: 'cherry durian' },
    ]);
    const serialized = idx.toJSON();
    const restored = VectorIndex.fromJSON(serialized, { _pipelineFactory: async () => makeFakeEmbedder() });
    assert.equal(restored.size, 2);
    assert.equal(restored.dim, FAKE_DIM);
    const hits = await restored.search('apple banana');
    assert.equal(hits[0]!.id, 'a');
    assert.deepEqual(hits[0]!.meta, { file: 'src/a.ts' });
  });

  it('saveToFile + loadFromFile round-trip', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-vec-'));
    const filePath = path.join(tmpDir, 'sub', 'vec.json');
    const idx = new VectorIndex({ _pipelineFactory: async () => makeFakeEmbedder() });
    await idx.buildFromCorpus([
      { id: 'a', text: 'cat dog' },
      { id: 'b', text: 'sun moon' },
    ]);
    await idx.saveToFile(filePath);
    const loaded = await VectorIndex.loadFromFile(filePath, { _pipelineFactory: async () => makeFakeEmbedder() });
    assert.ok(loaded);
    assert.equal(loaded!.size, 2);
    const hits = await loaded!.search('cat dog');
    assert.equal(hits[0]!.id, 'a');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loadFromFile returns null on missing/malformed file', async () => {
    const missing = await VectorIndex.loadFromFile('/nonexistent/path/here.json');
    assert.equal(missing, null);
  });
});
