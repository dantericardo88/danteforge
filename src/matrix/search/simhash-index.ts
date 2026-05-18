// simhash-index.ts — Phase L.3c MVP.
//
// HONEST SCOPE: This is NOT a transformer embedding-based vector index. It is
// a 64-bit SimHash (Charikar, 2002) that gives approximate similarity for code
// chunks without any external dependency (embedding model, GPU, API). Two
// chunks with high SimHash agreement share many tokens at similar weights;
// chunks with low agreement do not.
//
// Why this matters: the PRD's L.3c calls for quantized vectors + hybrid
// retrieval (BM25 + dense rerank). True transformer embeddings are a multi-day
// operator decision (model selection, dimension, quantization scheme). SimHash
// is a fast, sovereign, in-substrate approximation that ships TODAY and gives
// real semantic-ish similarity for queries like "find chunks similar to
// `runHardenGate`'s body" or "find code chunks that look like this orphan
// candidate".
//
// What it does NOT do:
//   - Capture token semantics (synonyms, etc.) — purely lexical
//   - Cross-language similarity in a meaningful way
//   - Replace BM25 for keyword queries
//
// What it DOES do:
//   - Tell you which code chunks have similar token distributions
//   - Run in pure JavaScript at ~10K chunks/sec
//   - Stay sovereign — no embeddings API, no model file
//
// Hybrid retrieval per PRD: BM25 ranks keyword relevance; SimHash reranks
// the top-K by structural similarity to a reference chunk. The substrate's
// consumer chooses when to use SimHash vs BM25 alone.

import crypto from 'node:crypto';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Tokenize for SimHash. More lenient than BM25's tokenizer (includes short tokens). */
function shTokens(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(t => t.length >= 1);
}

/** SHA-1-derived 64-bit feature hash. Returns a bigint. */
function featureHash64(token: string): bigint {
  const h = crypto.createHash('sha1').update(token).digest();
  // Take the first 8 bytes as a big-endian uint64.
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(h[i]!);
  return v;
}

// ── SimHash computation ─────────────────────────────────────────────────────

export function simhash64(text: string): bigint {
  const tokens = shTokens(text);
  if (tokens.length === 0) return 0n;

  // Weight by token frequency (simple TF; matches the BM25 tokenizer style).
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  // Per-bit accumulator: +weight when bit=1, -weight when bit=0.
  const accumulator = new Array<number>(64).fill(0);
  for (const [token, weight] of freq) {
    const hash = featureHash64(token);
    for (let bit = 0; bit < 64; bit++) {
      const isSet = ((hash >> BigInt(bit)) & 1n) === 1n;
      accumulator[bit] = (accumulator[bit] ?? 0) + (isSet ? weight : -weight);
    }
  }

  // Final hash: bit i is 1 iff accumulator[i] > 0.
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if ((accumulator[bit] ?? 0) > 0) {
      out |= 1n << BigInt(bit);
    }
  }
  return out;
}

/** Hamming distance between two 64-bit values. Returns int 0..64. */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Similarity in [0, 1]. 1.0 = identical SimHash. */
export function similarity(a: bigint, b: bigint): number {
  return 1 - hammingDistance(a, b) / 64;
}

// ── Index ────────────────────────────────────────────────────────────────────

export interface SimhashEntry {
  /** Document or chunk id. */
  id: string;
  /** 64-bit SimHash. Stored as bigint for arithmetic; serialized as hex. */
  hash: bigint;
  /** Optional metadata (e.g. file path + line range). */
  meta?: Record<string, unknown>;
}

export interface SimhashHit {
  id: string;
  similarity: number;
  hammingDistance: number;
  meta?: Record<string, unknown>;
}

export class SimhashIndex {
  private entries: SimhashEntry[] = [];

  /** Add or replace an entry. */
  add(id: string, text: string, meta?: Record<string, unknown>): void {
    const idx = this.entries.findIndex(e => e.id === id);
    const entry: SimhashEntry = { id, hash: simhash64(text), ...(meta ? { meta } : {}) };
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
  }

  /** Number of entries. */
  get size(): number { return this.entries.length; }

  /**
   * Find the top-K most similar entries to the given query text. Returns
   * results ordered by descending similarity. `maxDistance` (Hamming) caps
   * candidate set; default 32 (half the hash width — anything past that
   * is essentially noise).
   */
  search(text: string, topK = 10, maxDistance = 32): SimhashHit[] {
    const queryHash = simhash64(text);
    const hits: SimhashHit[] = [];
    for (const entry of this.entries) {
      const d = hammingDistance(queryHash, entry.hash);
      if (d > maxDistance) continue;
      hits.push({
        id: entry.id,
        similarity: 1 - d / 64,
        hammingDistance: d,
        ...(entry.meta ? { meta: entry.meta } : {}),
      });
    }
    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, topK);
  }

  /**
   * Find entries whose hash is within `maxDistance` of `queryHash` directly.
   * Useful when the consumer already has a SimHash (e.g. from a chunk in
   * the same corpus) and doesn't want to re-tokenize.
   */
  searchByHash(queryHash: bigint, topK = 10, maxDistance = 32): SimhashHit[] {
    const hits: SimhashHit[] = [];
    for (const entry of this.entries) {
      const d = hammingDistance(queryHash, entry.hash);
      if (d > maxDistance) continue;
      hits.push({
        id: entry.id,
        similarity: 1 - d / 64,
        hammingDistance: d,
        ...(entry.meta ? { meta: entry.meta } : {}),
      });
    }
    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, topK);
  }

  /** Serialize for persistence (Phase L.4-compatible). */
  toJSON(): { version: 1; entries: Array<{ id: string; hashHex: string; meta?: Record<string, unknown> }> } {
    return {
      version: 1,
      entries: this.entries.map(e => ({
        id: e.id,
        hashHex: e.hash.toString(16).padStart(16, '0'),
        ...(e.meta ? { meta: e.meta } : {}),
      })),
    };
  }

  /** Restore from serialized form. */
  static fromJSON(data: { version: number; entries: Array<{ id: string; hashHex: string; meta?: Record<string, unknown> }> }): SimhashIndex {
    const idx = new SimhashIndex();
    if (data.version !== 1) return idx;
    for (const e of data.entries) {
      idx.entries.push({
        id: e.id,
        hash: BigInt('0x' + e.hashHex),
        ...(e.meta ? { meta: e.meta } : {}),
      });
    }
    return idx;
  }
}
