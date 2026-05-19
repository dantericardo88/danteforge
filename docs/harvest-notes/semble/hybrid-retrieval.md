# Harvest note: Hybrid retrieval (BM25 + dense rerank) (Semble)

> PRD reference: docs/PRDs/autonomous-frontier-reaching.md Phase L.1 / L.3
> Harvest discipline (invariant I2): this note describes what was understood. DanteForge does NOT depend on Semble. The pattern is reimplemented natively.

## What Semble does

Semble's retrieval pipeline runs in two stages:

**Stage 1: BM25 sparse keyword index.** A textbook BM25 inverted index over tokenized chunks. Fast, lexical, no model required. Returns top-200 candidates for any query.

**Stage 2: Dense vector rerank.** A sentence-transformer model produces a 384-or-768-dim embedding for each chunk and for the query. The top-200 BM25 candidates are reranked by cosine similarity against the query embedding. The final top-K (typically 10-20) is what the LLM consumer sees.

The two stages cover orthogonal failure modes. BM25 alone misses semantic matches ("how do I authenticate users" doesn't keyword-match a function called `loginFlow`). Dense vectors alone are slow over large corpora and have a recall problem on identifier-heavy code (variable names like `_dbConn` don't embed meaningfully). The combination — sparse for recall, dense for precision — beats either alone on every benchmark Semble reports.

## The insight behind why it works

LLM-driven code search has two different relevance signals:

1. **Lexical**: the query mentions specific symbols, file paths, or strings that appear in the code. BM25 nails this.
2. **Semantic**: the query describes a capability or pattern that the code implements but doesn't name. Dense embeddings catch this.

A naive system ranks by one signal and loses the other. Hybrid retrieval keeps both — BM25 produces a high-recall candidate set, and dense rerank applies semantic precision over it. The two-stage architecture lets BM25 do the heavy lifting (it's O(query-terms) vs dense's O(corpus-size)), with dense reranking only the small top-N.

Critical detail: the BM25 candidate set must be larger than the final K. Semble defaults to BM25 top-200 → rerank → final 20. If BM25 returns only 20 candidates, the rerank can't recover from BM25 misses.

## Trade-offs Semble accepts

1. **Embedding model dependency.** Semble bundles or downloads a model (~80-200MB depending on dimension). Without it, dense rerank degrades to identity.
2. **Per-query latency cost.** Dense rerank adds ~50-200ms per query on CPU. Acceptable for human-in-the-loop search; matters for high-frequency programmatic search.
3. **Index storage doubles.** BM25 stores postings; vectors store dense floats. Combined index is ~2x BM25 alone. Quantization (int8) recovers most of that.

## How DanteForge reimplements natively

Three modules ship in DanteForge:

- **BM25** (`src/matrix/search/bm25-index.ts`): textbook k1=1.5, b=0.75 with the strictly-positive IDF variant. Pure TS, no deps. Phase L.3a complete.
- **VectorIndex** (`src/matrix/search/vector-index.ts`): wraps `@xenova/transformers` (MIT-licensed, runs in Node, no GPU) with `Xenova/all-MiniLM-L6-v2` (384-dim, ~80MB). Int8 quantization for compact persistence. Phase L.3c shipped (this session).
- **HybridRetriever** (`src/matrix/search/hybrid-retriever.ts`): composes BM25 (top-200) → vector rerank → top-K (default 20). Phase L.3 hybrid retrieval shipped (this session).

Earlier the substrate also shipped `simhash-index.ts` — a 64-bit SimHash that ships without an embedding model. It's the fallback when @xenova/transformers can't load (offline, restricted env, missing model cache). Hybrid retrieval prefers vectors when available and degrades to SimHash when not.

## What is NOT harvested

- Semble's specific model choice (DanteForge uses Xenova/all-MiniLM-L6-v2; Semble's choice is its own business)
- Semble's exact BM25 parameters (DanteForge uses textbook defaults)
- Semble's quantization scheme (DanteForge uses simple linear int8 mapping; Semble's may be more sophisticated)

The pattern — "BM25 for recall, dense vectors for precision, candidate-then-rerank pipeline" — is what was harvested. DanteForge's implementations are its own.
