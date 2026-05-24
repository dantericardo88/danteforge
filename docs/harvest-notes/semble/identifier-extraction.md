# Harvest note: Per-language identifier extraction (Semble)

> PRD reference: docs/PRDs/autonomous-frontier-reaching.md Phase L.1
> Harvest discipline (invariant I2): describes what was understood. DanteForge does NOT depend on Semble.

## What Semble does

Semble builds, alongside its BM25 and vector indexes, a third index: a flat symbol table that maps every declared identifier in the corpus to the file + line where it's declared. This is the "find me where this is defined" index — the index that answers `findSymbol('SearchEngine')` in O(1).

Each language's parser knows the syntax for declarations:

- **TypeScript / JavaScript**: `function`, `class`, `interface`, `type`, `enum`, `const`, `let`, `var`, `export default`, `import { X as Y }` rename
- **Python**: `def`, `class`, top-level assignments
- **Go**: `func`, `type`, `var`, `const`
- **Rust**: `fn`, `struct`, `enum`, `trait`, `impl`
- **Java / Kotlin / Scala**: `class`, `interface`, method signatures inside class bodies

The result is a per-language symbol table: a map from identifier name to declaration locations. When the engine indexes a 10K-file corpus, the symbol table holds maybe 100K-500K entries total. Lookups are O(1) hash; iteration is O(N) but rare.

## The insight behind why it works

LLM agents inspecting code constantly ask the same question: "where is this defined?" Without a symbol index, every such question is a grep over the corpus — O(N-files × file-size). With a symbol index, it's an O(1) lookup.

The substrate's `orphan-audit` check, harden gate's `import-resolves`, claim-auditor's per-symbol claim verification, and crusade wave's frontier-reverse-engineer agent ALL ask "where is this defined" repeatedly per wave. Without the symbol index, each query costs hundreds of file reads. With it, the cost is constant.

Per-language extraction matters because a symbol's declaration syntax is language-specific. A regex that matches `function foo` works in JS but misses `def foo` in Python. The per-language parser knows the local rules and emits a normalized symbol entry.

## Trade-offs Semble accepts

1. **Per-language parser cost.** Each supported language requires either a tree-sitter grammar or a custom regex pass. The matrix grows as languages are added.
2. **Index staleness.** The symbol table must be rebuilt when files change. Semble triggers a partial rebuild per changed file; full rebuild on git-SHA change.
3. **Re-export blindness.** TypeScript's `export { X } from './foo'` re-exports a symbol from a different file. Naive symbol extraction reports the re-export site, not the original declaration. Semble follows re-export chains; DanteForge's current implementation doesn't (yet).

## How DanteForge reimplements natively

The per-language symbol table lives at `src/matrix/search/minimal-native-engine.ts:symbolIndex` — a `Map<string, SymbolEntry[]>` where each entry records file, line, kind, exported-flag. Populated by:

- **TS / TSX / MTS / CTS**: `buildSymbolGraph` from `src/core/sanitize-boundary.ts`, which uses the TS compiler API. Lossless.
- **Python**: regex-based pass in `symbol-chunker.ts:chunkPython`. Catches `def` and `class` at any nesting; misses obscure metaclass tricks.
- **Other languages**: not currently indexed at the symbol level. They fall through to the whole-file BM25 + ripgrep path. Honest degradation.

The substrate persists the symbol index to disk at `.danteforge/search-index/<repoHash>/<gitSha>/symbol-index.json` (Phase L.4). Cold-start time on a repo drops from ~2-5s (re-walk + re-parse) to ~50ms (JSON load) on repeat queries at the same SHA.

## What is NOT harvested

- Semble's re-export resolution (DanteForge doesn't yet follow `export { X } from`)
- Semble's per-language parser matrix beyond what's described above
- Semble's incremental-update logic (DanteForge currently does full rebuild per SHA; incremental is a follow-up)

The pattern — "a separate symbol table for O(1) declaration lookup, per-language parsed" — is what was harvested.
