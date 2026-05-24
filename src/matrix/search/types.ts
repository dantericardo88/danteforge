// Matrix Search — canonical interface for the substrate's code-search primitive.
//
// Phase L of docs/PRDs/autonomous-frontier-reaching.md. Every substrate operation
// that needs to inspect code (orphan audit, harden checks, capability test
// callsite resolution, claim auditor, crusade wave inspection) goes through this
// interface. Two implementations ship in this session: RipgrepFallback (always
// available, subprocess wrap when `rg` is present, pure-Node walker otherwise)
// and MinimalNativeEngine (TS-symbol-aware via existing buildSymbolGraph).
//
// Full Phase L per the PRD adds BM25 + tree-sitter + quantized vectors. Those
// are explicitly deferred (multi-day work). This interface is forward-compatible
// — future engines just implement SearchEngine and the factory picks them up.

// ── Match types ──────────────────────────────────────────────────────────────

export interface SymbolMatch {
  /** File path relative to the indexed repo root. */
  file: string;
  /** 1-indexed line number where the symbol is declared. */
  line: number;
  /** The matched symbol name (verbatim). */
  symbol: string;
  /** What kind of declaration this is, when known. */
  kind?: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'let' | 'var' | 'unknown';
  /** True when the declaration is exported. */
  exported?: boolean;
  /** ~120 char snippet around the declaration. */
  snippet?: string;
}

export interface ImportMatch {
  /** File path that contains the import (relative to repo root). */
  file: string;
  /** 1-indexed line where the import statement lives. */
  line: number;
  /** The full import statement (single line). */
  importStatement: string;
  /** The module specifier (e.g. './foo.js', 'react'). */
  moduleSpecifier: string;
}

export interface PatternMatch {
  /** File path relative to repo root. */
  file: string;
  /** 1-indexed line number of the match. */
  line: number;
  /** The matched line (verbatim, no truncation). */
  text: string;
  /** Column where the match starts (1-indexed). */
  column?: number;
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface SearchOpts {
  /**
   * Optional file glob filter. When supplied, only files matching the glob are
   * searched. Format: standard shell glob (e.g. `src/**\/*.ts`).
   */
  glob?: string;
  /**
   * When true, include test/spec files in the result set. Default: false.
   * Most substrate operations want production-only results (orphan audit etc).
   */
  includeTests?: boolean;
  /**
   * Hard cap on number of matches returned. Default: 1000.
   */
  maxResults?: number;
}

export interface IndexOptions {
  /** Force re-indexing even when a fresh index exists for the current gitSha. */
  forceCold?: boolean;
}

// ── Engine handle ────────────────────────────────────────────────────────────

export interface IndexHandle {
  /** Engine that produced this handle (informational). */
  engine: 'ripgrep' | 'native';
  /** Absolute path to the repo root that was indexed. */
  repoRoot: string;
  /** gitSha at indexing time (null when not in a git repo). */
  gitSha: string | null;
  /** Wall-clock ms taken to build the index. */
  indexedMs: number;
  /** Number of files that contributed to the index. */
  fileCount: number;
}

// ── The interface ────────────────────────────────────────────────────────────

export interface SearchEngine {
  /**
   * Build (or refresh) the engine's index for the given repo root. Some engines
   * (RipgrepFallback) treat indexing as a no-op; others (MinimalNativeEngine)
   * walk the repo, parse TS files, and populate a symbol map. Returns the
   * handle which is forwarded to close() for clean shutdown.
   */
  index(repoRoot: string, options?: IndexOptions): Promise<IndexHandle>;

  /**
   * Find declarations of a symbol. The PRD's "findSymbol" semantics:
   * locate every file that declares this symbol (function, class, etc).
   */
  findSymbol(query: string, opts?: SearchOpts): Promise<SymbolMatch[]>;

  /**
   * Find production-code imports of a symbol. Test files excluded by default
   * (opts.includeTests=true to override). Returns the import statement and
   * the file location. Used by orphan-audit + import-resolves harden checks.
   */
  findImports(symbol: string, opts?: SearchOpts): Promise<ImportMatch[]>;

  /**
   * Free-form regex pattern search. Returns every matching line across the
   * indexed repo. Used by claim-auditor + hardcoded-fallback harden checks.
   */
  findPattern(regex: string, opts?: SearchOpts): Promise<PatternMatch[]>;

  /**
   * Release any resources held by the engine. Idempotent.
   */
  close(handle: IndexHandle): Promise<void>;
}

// ── Factory options ──────────────────────────────────────────────────────────

export type SearchEnginePreference = 'auto' | 'native' | 'ripgrep';

export interface CreateSearchEngineOptions {
  /** Explicit engine choice. Default 'auto' = native when supported, ripgrep otherwise. */
  preference?: SearchEnginePreference;
  /** When true, prefer ripgrep subprocess even for TS-only repos. */
  forceRipgrep?: boolean;
}
