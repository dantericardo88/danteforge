# Harvest note: Quantized vector indices (Semble)

> PRD reference: docs/PRDs/autonomous-frontier-reaching.md Phase L.1 / L.3c
> Harvest discipline (invariant I2): describes what was understood. DanteForge does NOT depend on Semble.

## What Semble does

Semble's vector index stores chunk embeddings as int8 quantized values rather than float32. A 384-dim embedding at float32 is 1.5KB per chunk; at int8 it's 384B — a 4x storage reduction with negligible search-quality loss.

The quantization scheme is linear scalar quantization with per-dimension scale factors:

1. For each embedding dimension, compute min/max across the corpus
2. Map values to int8 range [-128, 127] via `(value - midpoint) / (range / 254)`
3. Store the quantized int8 vector + the per-dimension scale array (small constant overhead)

At search time, vectors are de-quantized to float32 before computing cosine similarity. The de-quantization is O(384) per vector — negligible relative to the search work itself.

## The insight behind why it works

Embedding models output float32 by default, but the precision is wasted. Studies show int8 quantization recovers >99% of search recall on standard benchmarks. The 1% loss is in the long tail (ranks 100+) that almost no consumer cares about.

The storage win matters at scale. A 1M-chunk corpus:
- float32: 1.5GB
- int8: 384MB
- int4: 192MB (lossier, recovers ~95%)

DanteForge's typical corpora are smaller (DanteForge itself has ~260 source files), so the storage delta is in MB not GB. But the time-to-load saves: reading 384MB from disk is meaningfully faster than reading 1.5GB.

Per-dimension scale factors matter. A naive global scale (one min/max for the whole vector) loses precision on dimensions with low variance. Per-dimension scales preserve the signal in every dimension.

## Trade-offs Semble accepts

1. **Long-tail recall loss.** Int8 quantization causes occasional swaps in the top-50 search results. Operators tolerate this on code search; not acceptable on, e.g., medical retrieval.
2. **Scale-factor recomputation.** When the corpus changes, scale factors must be recomputed. Semble re-quantizes per index rebuild.
3. **Asymmetric query.** Queries are usually NOT quantized (only stored vectors are). The query embedding is computed at full float32, then the cosine math happens between float32 query and de-quantized float32 vectors.

## How DanteForge reimplements natively

DanteForge's `VectorIndex` (`src/matrix/search/vector-index.ts`, this session) stores quantized int8 vectors:

```typescript
interface QuantizedVector {
  qValues: Int8Array;          // length = embedding dim
  scale: Float32Array;         // length = embedding dim
  midpoint: Float32Array;      // length = embedding dim
}
```

At search time:
```typescript
function dequantize(qv: QuantizedVector): Float32Array {
  const out = new Float32Array(qv.qValues.length);
  for (let i = 0; i < qv.qValues.length; i++) {
    out[i] = qv.qValues[i]! * qv.scale[i]! + qv.midpoint[i]!;
  }
  return out;
}
```

Cosine similarity is computed against the dequantized vector. The scale/midpoint arrays are stored ONCE per index, not per-vector — so the per-vector cost is just the Int8Array (384 bytes for MiniLM, 768 for BERT-base, etc).

Persistence: vectors stored as JSON with hex-encoded Int8Array, alongside the symbol-index from Phase L.4. Same `.danteforge/search-index/<repoHash>/<gitSha>/` layout.

## What is NOT harvested

- Semble's specific scale-factor recomputation policy (DanteForge recomputes on every full index)
- Semble's HNSW or other ANN structures (DanteForge does linear scan; acceptable for <10K vectors)
- Semble's float16 alternative (DanteForge goes straight to int8 for simplicity)

The pattern — "quantize to int8 with per-dimension scales; dequantize at query time; cosine against dequantized" — is what was harvested.

For corpora larger than ~10K chunks, a future iteration adds HNSW for approximate-nearest-neighbor search. DanteForge's current consumers are well under that threshold; linear scan is fast enough.
