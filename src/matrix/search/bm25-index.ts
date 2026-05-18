// BM25 sparse keyword index (PRD Phase L.3 of docs/PRDs/autonomous-frontier-reaching.md).
//
// Textbook BM25: a relevance score for documents given a query. Used by the
// SearchEngine to rank multi-term query results by relevance instead of file
// order. For single-term queries, BM25 reduces to IDF * TF — the regex
// fallback is just as good. For "outcome derived score" (3 terms across the
// project), BM25 pulls the genuinely-most-relevant files to the top.
//
// Implementation notes:
//   - k1 = 1.5 (standard term-frequency saturation)
//   - b  = 0.75 (standard document-length normalization)
//   - Tokenizer: lowercase, split on non-word chars, drop length-1 tokens
//   - Stop-word list intentionally minimal — programming text is too varied
//   - Inverted index in memory; no on-disk persistence yet (Phase L.3 follow-up)

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const MIN_TOKEN_LENGTH = 2;

// ── Tokenization ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'it', 'be', 'as', 'are', 'was', 'were',
]);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    if (raw.length < MIN_TOKEN_LENGTH) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

// ── Index types ──────────────────────────────────────────────────────────────

export interface DocumentEntry {
  /** Identifier for the document (e.g. file path). */
  id: string;
  /** Number of tokens after stop-word filtering. */
  length: number;
}

export interface PostingEntry {
  docId: string;
  /** Number of times the term appears in this doc. */
  termFrequency: number;
}

export interface BM25Score {
  docId: string;
  score: number;
}

// ── BM25 index ───────────────────────────────────────────────────────────────

export class BM25Index {
  private documents = new Map<string, DocumentEntry>();
  /** term → list of postings (doc + termFreq). */
  private postings = new Map<string, PostingEntry[]>();
  /** Sum of all document lengths, used to compute avgdl. */
  private totalLength = 0;

  /**
   * Add a document to the index. `id` is the unique key; re-adding replaces.
   * Tokenizes the text, computes per-term frequencies, and updates the
   * inverted index.
   */
  addDocument(id: string, text: string): void {
    if (this.documents.has(id)) this.removeDocument(id);

    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }

    this.documents.set(id, { id, length: tokens.length });
    this.totalLength += tokens.length;

    for (const [term, freq] of tf) {
      const list = this.postings.get(term) ?? [];
      list.push({ docId: id, termFrequency: freq });
      this.postings.set(term, list);
    }
  }

  /**
   * Remove a document from the index. Slow path; used only when re-indexing.
   */
  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;
    this.totalLength -= doc.length;
    this.documents.delete(id);
    for (const [term, list] of this.postings) {
      const filtered = list.filter(p => p.docId !== id);
      if (filtered.length === 0) this.postings.delete(term);
      else this.postings.set(term, filtered);
    }
  }

  /** Number of documents in the index. */
  get size(): number {
    return this.documents.size;
  }

  /** Average document length (for the b-parameter). */
  private get avgdl(): number {
    if (this.documents.size === 0) return 0;
    return this.totalLength / this.documents.size;
  }

  /**
   * Inverse document frequency for a term. Uses the standard BM25 IDF formula:
   *   idf(t) = ln((N - df(t) + 0.5) / (df(t) + 0.5) + 1)
   * The "+1" inside the log keeps the result strictly positive even for terms
   * appearing in >50% of documents (avoids negative IDF distortion).
   */
  idf(term: string): number {
    const N = this.documents.size;
    if (N === 0) return 0;
    const df = this.postings.get(term)?.length ?? 0;
    return Math.log((N - df + 0.5) / (df + 0.5) + 1);
  }

  /**
   * Score a single document against a query. Returns 0 when the doc is
   * unknown or no query term appears in it.
   */
  scoreDocument(docId: string, queryTerms: string[]): number {
    const doc = this.documents.get(docId);
    if (!doc) return 0;
    const avgdl = this.avgdl;
    if (avgdl === 0) return 0;
    let score = 0;
    for (const term of queryTerms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const entry = posting.find(p => p.docId === docId);
      if (!entry) continue;
      const tf = entry.termFrequency;
      const idfVal = this.idf(term);
      // BM25 saturation term:
      //   numerator   = tf * (k1 + 1)
      //   denominator = tf + k1 * (1 - b + b * |d|/avgdl)
      const norm = 1 - BM25_B + BM25_B * (doc.length / avgdl);
      const tfWeight = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm);
      score += idfVal * tfWeight;
    }
    return score;
  }

  /**
   * Score every document that contains at least one query term. Returns the
   * top-K by score descending. K defaults to 100; pass `undefined` for "all
   * non-zero scores".
   */
  search(query: string, topK = 100): BM25Score[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    // Collect candidate docs (any doc with at least one query term).
    const candidates = new Set<string>();
    for (const term of queryTerms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      for (const p of posting) candidates.add(p.docId);
    }

    const scored: BM25Score[] = [];
    for (const docId of candidates) {
      const score = this.scoreDocument(docId, queryTerms);
      if (score > 0) scored.push({ docId, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Return the index's tunable constants (for tests + debugging). */
  static get parameters(): { k1: number; b: number } {
    return { k1: BM25_K1, b: BM25_B };
  }
}
