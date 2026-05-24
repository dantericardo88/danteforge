# Harvest note: Tree-sitter symbol-aware chunking (Semble)

> PRD reference: docs/PRDs/autonomous-frontier-reaching.md Phase L.1 / L.3b
> Harvest discipline (invariant I2): this note describes what was understood from reading Semble's source. DanteForge does NOT install or depend on Semble. The pattern is reimplemented natively under DanteForge conventions.

## What Semble does

Semble's code index does NOT chunk by line-window or character-count. It walks each file with a tree-sitter parser tuned per-language, then emits one chunk per "semantic unit" — function, method, class, top-level constant block, type declaration. The chunk's metadata records the language, the chunk's symbol identity (its name), its start/end line, and its full source text.

When a query lands, Semble retrieves chunks rather than line-windows. A response can quote a function body whole rather than 5 lines on either side of a grep match. That single property — "every result is a complete semantic unit" — is what makes the engine feel agent-friendly.

## The insight behind why it works

LLM agents consuming search results pay token cost in proportion to the returned text. Line-window results (the grep+read pattern) waste tokens on:

- Imports at the top of the file (irrelevant to the matched line)
- Closing braces of containing functions (irrelevant)
- Comments that bracketed but didn't contain the match
- Adjacent functions that happen to be near the match

Symbol-aware chunks return ONLY the matched function. The agent sees the function in full, with its own signature and body — enough to reason about it. Nothing else. Token cost drops by an order of magnitude on typical code-comprehension queries.

Tree-sitter is the right primitive for two reasons. First, it's error-tolerant: it produces a parse tree even when the file has syntax errors, so the index keeps working on actively-edited code. Second, the same tree-sitter grammar gives the same chunk boundaries across IDEs, language servers, and search engines — there's no per-engine "what counts as a function" disagreement.

## Trade-offs Semble accepts

1. **Native build requirement.** Tree-sitter is a C library; node-gyp + a C++ toolchain must be installed to build the bindings. On developer machines and CI Linux this is automatic; on operator Windows machines without Visual Studio build tools it fails.
2. **Per-language grammar coverage.** Tree-sitter has solid grammars for top-30 languages; obscure languages fall back to whole-file chunks.
3. **Index size.** Symbol-aware chunks store each chunk's full source text. For a 1M-file corpus this is ~3-5x the BM25-index size. Semble accepts this; the speed-up at query time dominates.

## How DanteForge reimplements natively

DanteForge already has TypeScript AST parsing via the `typescript` compiler API (used in `src/core/sanitize-boundary.ts:buildSymbolGraph`). That handles ~50% of DanteForge's own codebase. For other languages:

- **TS / TSX / MTS / CTS**: use the existing `buildSymbolGraph` (lossless TS-compiler-API parse, already in dependencies). PRD-aligned with native quality.
- **Python**: use a regex-based pass that respects indentation. Identifies `def` and `class` at any nesting level. Not as precise as tree-sitter-python on decorated functions, but ships without node-gyp.
- **Other languages**: whole-file chunk. Honest degradation rather than silent failure.

The interface (`src/matrix/search/symbol-chunker.ts:chunkFile`) is forward-compatible — a future tree-sitter wrapper drops in without changing callers. The substrate ships with the pure-Node fallback as the floor; operators who install node-gyp can upgrade by replacing one module.

## What is NOT harvested

- Semble's chunk-metadata schema (DanteForge's `SymbolChunk` is a fresh design that fits DanteForge's needs)
- Semble's per-language config files (DanteForge defaults are operator-overridable per `prompts/research/` pattern)
- Semble's CLI surface (DanteForge has its own `danteforge search` namespace per PRD section 10)

The pattern — "chunks are complete semantic units, not line-windows" — is what was harvested. The implementation is DanteForge's own.
