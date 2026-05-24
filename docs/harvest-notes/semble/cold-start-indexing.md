# Harvest note: Cold-start indexing concurrency (Semble)

> PRD reference: docs/PRDs/autonomous-frontier-reaching.md Phase L.1
> Harvest discipline (invariant I2): describes what was understood. DanteForge does NOT depend on Semble.

## What Semble does

When Semble indexes a repo for the first time (or after the cached index is invalidated), it spawns a worker pool: one worker per CPU core, each consuming files from a shared queue. Each worker parses its file, extracts symbols + chunks + tokens, and pushes the result onto a result queue. A coordinator drains the result queue into the in-memory indexes (BM25, symbol table, vectors).

The PRD's stop-condition for L is "cold-start index <5 seconds on 1000-file repo." Semble achieves this through:

1. **CPU-bound parallelism.** Tree-sitter parsing is CPU-heavy; worker-thread parallelism scales near-linearly with cores.
2. **Streaming queue.** Workers don't wait for the full file list; they pull as files become available.
3. **In-memory merge.** Results are merged in memory; disk persistence is a single pass at the end, not per-file.
4. **Lazy embedding.** Vector embeddings are deferred until first query, not built at index time. The query-time penalty is one-time; the cold-start cost stays low.

## The insight behind why it works

Most code-indexers are I/O-bound on file reads and CPU-bound on parsing. Splitting these across workers eliminates serialization. A single-threaded indexer takes wall-clock = total-files × per-file-cost. A pool of N workers takes ceil(total-files / N) × per-file-cost — N-fold speedup until either I/O bandwidth or memory bandwidth saturates.

The lazy-vector trick is the deeper insight. Building 1M embeddings at index time on CPU takes minutes. Deferring them to query time means the index is usable in seconds; the first few queries pay the embedding cost, then it's cached. This trades initial-query latency for cold-start latency — and operators prefer that trade because cold-start is observed before any query is satisfied.

## Trade-offs Semble accepts

1. **Worker-thread complexity.** Worker pools in Node need careful message passing + ordering. Semble's coordinator code is non-trivial.
2. **Memory peak.** Holding the in-memory indexes for a large repo before persistence can spike RAM. Semble has a chunked-persist mode that flushes every N files.
3. **First-query latency.** Lazy vectors mean the first few queries are slower. Acceptable for human use; matters for cold-start CI.

## How DanteForge reimplements natively

DanteForge's `MinimalNativeEngine.index()` currently uses **sequential walk** — one file at a time. This is fine for DanteForge's own 264-file codebase (indexes in <500ms) but won't scale to 10K-file corpora.

The next iteration adds worker-thread parallelism via Node's `worker_threads` module. The substrate already has parallelism primitives in `src/core/headless-spawner.ts:spawnParallelAgents` and `src/utils/worktree.ts:createParallelWorktrees`. The same pattern lifts: each worker indexes a slice of the file list; a coordinator merges results.

For lazy vectors, DanteForge's `VectorIndex` (Phase L.3c, this session) already defers embedding generation. Vectors are computed only when search is called for the first time at a SHA; subsequent searches read from cache.

For repos under ~1000 files (most DanteForge consumers), sequential walk is fast enough and the worker-pool complexity isn't worth it. The Phase-L.5 benchmark identifies when the threshold is crossed.

## What is NOT harvested

- Semble's specific worker-pool implementation (DanteForge will use Node's `worker_threads` natively)
- Semble's chunked-persist heuristics (DanteForge persists once at end)
- Semble's incremental-update logic (DanteForge currently does full rebuild per SHA)

The pattern — "spawn workers, share a streaming queue, lazy-defer the expensive step (embeddings)" — is what was harvested. The substrate's `spawnParallelAgents` primitive is the right composition root for a future worker pool.
