// vector-index.ts — Phase L.3c transformer-embedding vector index.
//
// Uses @xenova/transformers (MIT-licensed, runs in Node, no GPU) with
// Xenova/all-MiniLM-L6-v2 (384-dim sentence transformer, ~80MB on first use).
// Stored vectors are int8-quantized for compact persistence per the harvest
// note at docs/harvest-notes/semble/quantized-vector-indices.md.
//
// Lazy pipeline initialization: the @xenova/transformers pipeline is imported
// only when embed() is first called. This keeps the substrate's startup time
// untouched when the vector engine isn't in use. The model downloads on first
// embed call to ~/.cache/huggingface/ (operator's machine); subsequent runs
// reuse the cache.
//
// Honest disclosure: this is full transformer embeddings, NOT SimHash. For
// environments where the model can't be downloaded (offline, restricted),
// `src/matrix/search/simhash-index.ts` is the sovereign fallback.

import fs from 'node:fs/promises';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VectorEntry {
  /** Unique identifier (file path, chunk id, etc). */
  id: string;
  /** Quantized int8 values. Length = embedding dim. */
  qValues: Int8Array;
  /** Optional metadata (e.g. file path + line range). */
  meta?: Record<string, unknown>;
}

export interface VectorHit {
  id: string;
  similarity: number;
  meta?: Record<string, unknown>;
}

export interface VectorIndexOptions {
  /** Embedding model id. Default: 'Xenova/all-MiniLM-L6-v2' (384-dim). */
  model?: string;
  /** Test-only seam: replace the pipeline factory. */
  _pipelineFactory?: () => Promise<EmbedFn>;
}

/** Function that returns a Float32Array embedding for a text input. */
export type EmbedFn = (text: string) => Promise<Float32Array>;

// ── Quantization ────────────────────────────────────────────────────────────

interface QuantizationScales {
  /** Per-dimension scale (Float32Array; length = embedding dim). */
  scale: Float32Array;
  /** Per-dimension midpoint (Float32Array; length = embedding dim). */
  midpoint: Float32Array;
}

/**
 * Build quantization scales from a corpus of float embeddings. Computes per-
 * dimension min/max across all vectors and derives scale/midpoint mappings
 * to the int8 range [-128, 127].
 */
function buildScales(vectors: Float32Array[]): QuantizationScales {
  if (vectors.length === 0) {
    return { scale: new Float32Array(0), midpoint: new Float32Array(0) };
  }
  const dim = vectors[0]!.length;
  const mins = new Float32Array(dim).fill(Number.POSITIVE_INFINITY);
  const maxs = new Float32Array(dim).fill(Number.NEGATIVE_INFINITY);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      const x = v[i]!;
      if (x < mins[i]!) mins[i] = x;
      if (x > maxs[i]!) maxs[i] = x;
    }
  }
  const scale = new Float32Array(dim);
  const midpoint = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    const range = (maxs[i]! - mins[i]!) || 1e-6;
    scale[i] = range / 254;  // map to [-127, 127]
    midpoint[i] = (mins[i]! + maxs[i]!) / 2;
  }
  return { scale, midpoint };
}

function quantize(v: Float32Array, scales: QuantizationScales): Int8Array {
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const normalized = (v[i]! - scales.midpoint[i]!) / scales.scale[i]!;
    out[i] = Math.max(-128, Math.min(127, Math.round(normalized)));
  }
  return out;
}

function dequantize(q: Int8Array, scales: QuantizationScales): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) {
    out[i] = q[i]! * scales.scale[i]! + scales.midpoint[i]!;
  }
  return out;
}

// ── Cosine similarity ───────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ── VectorIndex ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

export class VectorIndex {
  private entries: VectorEntry[] = [];
  private scales: QuantizationScales | null = null;
  private embedFn: EmbedFn | null = null;
  private modelId: string;
  private pipelineFactory: (() => Promise<EmbedFn>) | null;

  constructor(options: VectorIndexOptions = {}) {
    this.modelId = options.model ?? DEFAULT_MODEL;
    this.pipelineFactory = options._pipelineFactory ?? null;
  }

  /**
   * Lazy-load the embedding pipeline. First call downloads the model
   * (~80MB for the default) to operator's HuggingFace cache; subsequent
   * calls reuse it. Idempotent.
   */
  private async getEmbedFn(): Promise<EmbedFn> {
    if (this.embedFn) return this.embedFn;
    if (this.pipelineFactory) {
      this.embedFn = await this.pipelineFactory();
      return this.embedFn;
    }
    // Lazy-import @xenova/transformers — only loaded when actually needed.
    const transformers = await import('@xenova/transformers') as { pipeline: (task: string, model: string) => Promise<(text: string, opts?: Record<string, unknown>) => Promise<{ data: Float32Array }>> };
    const pipe = await transformers.pipeline('feature-extraction', this.modelId);
    this.embedFn = async (text: string): Promise<Float32Array> => {
      const result = await pipe(text, { pooling: 'mean', normalize: true });
      return new Float32Array(result.data);
    };
    return this.embedFn;
  }

  /**
   * Add a document by computing its embedding then quantizing into int8 storage.
   * The first add() also defines quantization scales — subsequent adds use the
   * same scales for compatibility. For best quality, call `buildFromCorpus`
   * with all documents at once so the scales are computed across the full
   * corpus.
   */
  async add(id: string, text: string, meta?: Record<string, unknown>): Promise<void> {
    const embed = await this.getEmbedFn();
    const vec = await embed(text);
    if (!this.scales) {
      // First entry: scales must be built. Use the single vector to seed
      // (will be refined when more vectors arrive via buildFromCorpus).
      this.scales = buildScales([vec]);
    }
    const qValues = quantize(vec, this.scales);
    const idx = this.entries.findIndex(e => e.id === id);
    const entry: VectorEntry = { id, qValues, ...(meta ? { meta } : {}) };
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
  }

  /**
   * Build the index from a corpus of (id, text) pairs in a single pass.
   * Computes embeddings, then quantization scales from the full corpus,
   * then quantizes every vector with the corpus-wide scales. Use this
   * over repeated add() when the full document set is known up front.
   */
  async buildFromCorpus(documents: Array<{ id: string; text: string; meta?: Record<string, unknown> }>): Promise<void> {
    const embed = await this.getEmbedFn();
    const rawVectors: Float32Array[] = [];
    for (const doc of documents) {
      rawVectors.push(await embed(doc.text));
    }
    this.scales = buildScales(rawVectors);
    this.entries = documents.map((doc, i) => ({
      id: doc.id,
      qValues: quantize(rawVectors[i]!, this.scales!),
      ...(doc.meta ? { meta: doc.meta } : {}),
    }));
  }

  /**
   * Search the index by query text. Returns the top-K entries ranked by
   * cosine similarity (vectors dequantized at query time).
   */
  async search(query: string, topK = 10): Promise<VectorHit[]> {
    if (!this.scales || this.entries.length === 0) return [];
    const embed = await this.getEmbedFn();
    const queryVec = await embed(query);
    const hits: VectorHit[] = [];
    for (const entry of this.entries) {
      const entryVec = dequantize(entry.qValues, this.scales);
      const sim = cosineSimilarity(queryVec, entryVec);
      hits.push({ id: entry.id, similarity: sim, ...(entry.meta ? { meta: entry.meta } : {}) });
    }
    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, topK);
  }

  /** Number of entries in the index. */
  get size(): number { return this.entries.length; }

  /** Embedding dimension (0 when index is empty). */
  get dim(): number { return this.entries[0]?.qValues.length ?? 0; }

  // ── Persistence (Phase L.4-compatible) ────────────────────────────────────

  /**
   * Serialize the index to JSON. The int8 arrays are base64-encoded for compact
   * persistence. Scales are stored alongside.
   */
  toJSON(): SerializedVectorIndex {
    if (!this.scales) {
      return {
        version: 1,
        modelId: this.modelId,
        dim: 0,
        scaleBase64: '',
        midpointBase64: '',
        entries: [],
      };
    }
    return {
      version: 1,
      modelId: this.modelId,
      dim: this.scales.scale.length,
      scaleBase64: Buffer.from(this.scales.scale.buffer).toString('base64'),
      midpointBase64: Buffer.from(this.scales.midpoint.buffer).toString('base64'),
      entries: this.entries.map(e => ({
        id: e.id,
        qBase64: Buffer.from(e.qValues.buffer, e.qValues.byteOffset, e.qValues.byteLength).toString('base64'),
        ...(e.meta ? { meta: e.meta } : {}),
      })),
    };
  }

  /** Restore an index from serialized form. */
  static fromJSON(data: SerializedVectorIndex, options: VectorIndexOptions = {}): VectorIndex {
    const idx = new VectorIndex(options);
    if (data.version !== 1) return idx;
    if (data.dim === 0) return idx;
    const scaleBuf = Buffer.from(data.scaleBase64, 'base64');
    const midpointBuf = Buffer.from(data.midpointBase64, 'base64');
    idx.scales = {
      scale: new Float32Array(scaleBuf.buffer, scaleBuf.byteOffset, data.dim),
      midpoint: new Float32Array(midpointBuf.buffer, midpointBuf.byteOffset, data.dim),
    };
    idx.entries = data.entries.map(e => {
      const buf = Buffer.from(e.qBase64, 'base64');
      return {
        id: e.id,
        qValues: new Int8Array(buf.buffer, buf.byteOffset, data.dim),
        ...(e.meta ? { meta: e.meta } : {}),
      };
    });
    return idx;
  }

  /** Save the index to a file on disk. */
  async saveToFile(filePath: string): Promise<void> {
    const path = await import('node:path');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(this.toJSON()), 'utf8');
  }

  /** Load an index from a file on disk. Returns null if file missing/malformed. */
  static async loadFromFile(filePath: string, options: VectorIndexOptions = {}): Promise<VectorIndex | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as SerializedVectorIndex;
      return VectorIndex.fromJSON(parsed, options);
    } catch {
      return null;
    }
  }
}

// ── Serialized form ─────────────────────────────────────────────────────────

export interface SerializedVectorIndex {
  version: 1;
  modelId: string;
  dim: number;
  scaleBase64: string;
  midpointBase64: string;
  entries: Array<{ id: string; qBase64: string; meta?: Record<string, unknown> }>;
}

// ── Exposed primitives for testing ──────────────────────────────────────────

export const _internals = {
  buildScales,
  quantize,
  dequantize,
  cosineSimilarity,
};
