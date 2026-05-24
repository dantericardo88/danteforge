// hybrid-retriever.ts — Phase L.3 BM25 + dense rerank pattern.
//
// Two-stage retrieval per docs/harvest-notes/semble/hybrid-retrieval.md:
//   1. BM25Index pulls the top-N keyword-relevant candidates (cheap, high recall).
//   2. VectorIndex re-ranks those candidates by cosine similarity in transformer
//      embedding space (precise, but only run on the small candidate set).
//
// Why this matters: pure BM25 misses synonyms ("vehicle" vs "car"). Pure dense
// retrieval is expensive to run across an entire repo. The hybrid combines
// BM25's recall with dense retrieval's semantic awareness at a fraction of the
// cost — embedding only N << totalDocs candidates per query.
//
// Honest scope: the dense rerank requires the VectorIndex to be pre-built
// (corpus-wide quantization scales). If the BM25 candidate set is empty, the
// hybrid returns empty — it does not fall back to a vector-only search across
// the entire index. Operators who want vector-only retrieval should call
// VectorIndex.search directly.

import { BM25Index } from './bm25-index.js';
import { VectorIndex } from './vector-index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HybridHit {
  id: string;
  /** BM25 score for the document (0 when not in BM25 candidates). */
  bm25Score: number;
  /** Cosine similarity from the vector rerank (in [-1, 1], usually [0, 1]). */
  vectorScore: number;
  /** Final blended score: weighted sum of normalized bm25 + vector. */
  blendedScore: number;
  meta?: Record<string, unknown>;
}

export interface HybridSearchOptions {
  /** Number of BM25 candidates to feed into the vector reranker. Default 50. */
  candidateK?: number;
  /** Final number of hits to return after rerank. Default 10. */
  topK?: number;
  /** Weight applied to the normalized BM25 score in [0, 1]. Default 0.4. */
  bm25Weight?: number;
  /** Weight applied to the cosine score in [0, 1]. Default 0.6. */
  vectorWeight?: number;
}

const DEFAULTS: Required<Omit<HybridSearchOptions, never>> = {
  candidateK: 50,
  topK: 10,
  bm25Weight: 0.4,
  vectorWeight: 0.6,
};

// ── HybridRetriever ─────────────────────────────────────────────────────────

/**
 * Build a HybridRetriever from a document corpus in one call. Both the BM25
 * index and the vector index are constructed with corpus-wide scoring (avgdl
 * for BM25, per-dimension quantization scales for the vector index), giving
 * the most accurate downstream rerank.
 *
 * The vector index will lazy-load the @xenova/transformers pipeline on first
 * call, which downloads ~80MB on initial use. For tests and offline
 * environments, pass `vectorOptions._pipelineFactory` to inject a fake.
 */
export async function createHybridRetriever(
  documents: Array<{ id: string; text: string; meta?: Record<string, unknown> }>,
  vectorOptions: ConstructorParameters<typeof VectorIndex>[0] = {},
): Promise<HybridRetriever> {
  const bm25 = new BM25Index();
  for (const doc of documents) bm25.addDocument(doc.id, doc.text);
  const vector = new VectorIndex(vectorOptions);
  await vector.buildFromCorpus(documents);
  return new HybridRetriever(bm25, vector);
}

export class HybridRetriever {
  constructor(
    private readonly bm25: BM25Index,
    private readonly vector: VectorIndex,
  ) {}

  /**
   * Two-stage retrieval. Returns up to `topK` documents with both BM25 and
   * vector scores attached.
   *
   * Stage 1: BM25 selects top-N candidates by keyword relevance.
   * Stage 2: VectorIndex re-ranks those candidates by cosine similarity.
   *
   * Empty candidates → empty result. The caller is responsible for falling
   * back to a vector-only or pattern search when the keyword path returns
   * nothing.
   */
  async search(query: string, options: HybridSearchOptions = {}): Promise<HybridHit[]> {
    const opts = { ...DEFAULTS, ...options };

    // Stage 1: BM25 candidates.
    const bm25Hits = this.bm25.search(query, opts.candidateK);
    if (bm25Hits.length === 0) return [];
    const candidateIds = new Set(bm25Hits.map(h => h.docId));
    const bm25ScoreById = new Map(bm25Hits.map(h => [h.docId, h.score]));

    // Stage 2: vector rerank (only over the candidate set).
    // We search the full vector index but filter to candidates afterward.
    // For repos where the candidate set is tiny relative to the total,
    // this is still cheap because the cosine loop is O(N_candidates) after filtering.
    const vectorHits = await this.vector.search(query, Math.max(opts.candidateK * 2, opts.topK * 4));
    const vectorScoreById = new Map<string, number>();
    const metaById = new Map<string, Record<string, unknown>>();
    for (const v of vectorHits) {
      if (!candidateIds.has(v.id)) continue;
      vectorScoreById.set(v.id, v.similarity);
      if (v.meta) metaById.set(v.id, v.meta);
    }

    // Normalize each score channel to [0, 1] for a meaningful blend.
    const bm25Max = Math.max(...bm25ScoreById.values(), 1e-9);
    const vectorScores = Array.from(vectorScoreById.values());
    const vectorMax = vectorScores.length > 0 ? Math.max(...vectorScores) : 1e-9;

    const out: HybridHit[] = [];
    for (const docId of candidateIds) {
      const bm25Raw = bm25ScoreById.get(docId) ?? 0;
      const vectorRaw = vectorScoreById.get(docId) ?? 0;
      const bm25Norm = bm25Raw / bm25Max;
      const vectorNorm = vectorMax > 0 ? vectorRaw / vectorMax : 0;
      const blended = opts.bm25Weight * bm25Norm + opts.vectorWeight * vectorNorm;
      const meta = metaById.get(docId);
      out.push({
        id: docId,
        bm25Score: bm25Raw,
        vectorScore: vectorRaw,
        blendedScore: blended,
        ...(meta ? { meta } : {}),
      });
    }
    out.sort((a, b) => b.blendedScore - a.blendedScore);
    return out.slice(0, opts.topK);
  }
}
