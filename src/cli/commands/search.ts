// search.ts — `danteforge search ...` command surface (Phase L of
// docs/PRDs/autonomous-frontier-reaching.md).
//
// Six subcommands:
//   index          — build/refresh the search index
//   find <regex>   — pattern search
//   symbol <name>  — declaration lookup
//   imports <name> — find production imports of a symbol
//   orphans        — wraps the orphan-audit check using SearchEngine
//   benchmark      — compare native vs ripgrep engines on a sample workload

import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { createSearchEngine } from '../../matrix/search/factory.js';
import type {
  CreateSearchEngineOptions,
  ImportMatch,
  PatternMatch,
  SearchEngine,
  SymbolMatch,
} from '../../matrix/search/types.js';

export interface SearchCommandOptions {
  cwd?: string;
  json?: boolean;
  glob?: string;
  includeTests?: boolean;
  maxResults?: number;
  engine?: 'auto' | 'native' | 'ripgrep';
}

function getEngine(opts: SearchCommandOptions): SearchEngine {
  const factoryOpts: CreateSearchEngineOptions = {};
  if (opts.engine && opts.engine !== 'auto') {
    factoryOpts.preference = opts.engine;
  }
  return createSearchEngine(factoryOpts);
}

function runOpts(opts: SearchCommandOptions) {
  const out: import('../../matrix/search/types.js').SearchOpts = {};
  if (opts.glob) out.glob = opts.glob;
  if (opts.includeTests) out.includeTests = opts.includeTests;
  if (opts.maxResults !== undefined) out.maxResults = opts.maxResults;
  return out;
}

// ── index ────────────────────────────────────────────────────────────────────

export async function runSearchIndex(opts: SearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const engine = getEngine(opts);
  const handle = await engine.index(cwd, { forceCold: true });
  if (opts.json) {
    process.stdout.write(JSON.stringify(handle, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.success(`Indexed ${handle.fileCount} files in ${handle.indexedMs}ms (engine=${handle.engine})`);
}

// ── find <regex> ─────────────────────────────────────────────────────────────

export async function runSearchFind(pattern: string, opts: SearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const engine = getEngine(opts);
  await engine.index(cwd).catch(() => undefined);
  const matches = await engine.findPattern(pattern, runOpts(opts));
  emitPatternMatches(pattern, matches, opts.json);
}

// ── symbol <name> ────────────────────────────────────────────────────────────

export async function runSearchSymbol(name: string, opts: SearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const engine = getEngine(opts);
  await engine.index(cwd).catch(() => undefined);
  const matches = await engine.findSymbol(name, runOpts(opts));
  emitSymbolMatches(name, matches, opts.json);
}

// ── imports <name> ───────────────────────────────────────────────────────────

export async function runSearchImports(symbol: string, opts: SearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const engine = getEngine(opts);
  await engine.index(cwd).catch(() => undefined);
  const matches = await engine.findImports(symbol, runOpts(opts));
  emitImportMatches(symbol, matches, opts.json);
}

// ── orphans ──────────────────────────────────────────────────────────────────

export interface OrphansResult {
  cwd: string;
  totalDimensions: number;
  orphans: Array<{ dimensionId: string; callsite?: { file: string; symbol: string } }>;
}

export async function runSearchOrphans(opts: SearchCommandOptions = {}): Promise<OrphansResult> {
  const cwd = opts.cwd ?? process.cwd();
  const engine = getEngine(opts);
  const [{ loadMatrix }, { checkOrphanAudit }] = await Promise.all([
    import('../../core/compete-matrix.js'),
    import('../../matrix/engines/hardener.js'),
  ]);
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);

  const orphans: OrphansResult['orphans'] = [];
  for (const dim of matrix.dimensions) {
    const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as
      | { file: string; symbol: string } | undefined;
    const verdict = await checkOrphanAudit(dim, cwd, undefined, engine);
    if (!verdict.passed && !verdict.skipped) {
      orphans.push({ dimensionId: dim.id, ...(callsite ? { callsite } : {}) });
    }
  }
  const result: OrphansResult = { cwd, totalDimensions: matrix.dimensions.length, orphans };

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }
  logger.info('');
  if (orphans.length === 0) {
    logger.success(`No orphans across ${matrix.dimensions.length} dimensions.`);
  } else {
    logger.warn(`${orphans.length} orphan(s) detected:`);
    for (const o of orphans) {
      logger.warn(`  ${chalk.red('●')} ${o.dimensionId}  ${o.callsite ? chalk.dim(`${o.callsite.file}::${o.callsite.symbol}`) : ''}`);
    }
  }
  return result;
}

// ── benchmark ────────────────────────────────────────────────────────────────

export async function runSearchBenchmark(opts: SearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const native = createSearchEngine({ preference: 'native' });
  const ripgrep = createSearchEngine({ preference: 'ripgrep' });

  const testQueries = [
    { kind: 'symbol', q: 'createSearchEngine' },
    { kind: 'symbol', q: 'runHardenGate' },
    { kind: 'imports', q: 'loadMatrix' },
    { kind: 'pattern', q: 'TODO' },
  ];

  const results: Array<{ kind: string; q: string; nativeMs: number; ripgrepMs: number; nativeCount: number; ripgrepCount: number }> = [];

  // Warm both indexes.
  await native.index(cwd);
  await ripgrep.index(cwd);

  for (const t of testQueries) {
    const nStart = Date.now();
    let nCount = 0;
    if (t.kind === 'symbol') nCount = (await native.findSymbol(t.q)).length;
    else if (t.kind === 'imports') nCount = (await native.findImports(t.q)).length;
    else nCount = (await native.findPattern(t.q)).length;
    const nativeMs = Date.now() - nStart;

    const rStart = Date.now();
    let rCount = 0;
    if (t.kind === 'symbol') rCount = (await ripgrep.findSymbol(t.q)).length;
    else if (t.kind === 'imports') rCount = (await ripgrep.findImports(t.q)).length;
    else rCount = (await ripgrep.findPattern(t.q)).length;
    const ripgrepMs = Date.now() - rStart;

    results.push({ kind: t.kind, q: t.q, nativeMs, ripgrepMs, nativeCount: nCount, ripgrepCount: rCount });
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.info(chalk.bold('Search benchmark'));
  logger.info(chalk.dim('─'.repeat(60)));
  for (const r of results) {
    const fastest = r.nativeMs < r.ripgrepMs ? 'native' : 'ripgrep';
    logger.info(`  [${r.kind.padEnd(8)}] ${r.q.padEnd(24)}  native=${String(r.nativeMs).padStart(5)}ms (${r.nativeCount})  ripgrep=${String(r.ripgrepMs).padStart(5)}ms (${r.ripgrepCount})  → ${chalk.green(fastest)}`);
  }
  logger.info('');
  logger.info(chalk.dim('Note: Phase L MVP. BM25 + tree-sitter + quantized vectors deferred (see docs/PRDs/autonomous-frontier-reaching.md L.3).'));
  void path; // future use for index path display
}

// ── output helpers ───────────────────────────────────────────────────────────

function emitSymbolMatches(name: string, matches: SymbolMatch[], asJson?: boolean): void {
  if (asJson) {
    process.stdout.write(JSON.stringify(matches, null, 2) + '\n');
    return;
  }
  logger.info('');
  if (matches.length === 0) {
    logger.warn(`No symbol declarations found for "${name}".`);
    return;
  }
  logger.success(`${matches.length} declaration(s) for "${name}":`);
  for (const m of matches) {
    const exp = m.exported ? chalk.green('export ') : '';
    logger.info(`  ${chalk.cyan(m.file)}:${m.line}  ${exp}${m.kind ?? ''} ${chalk.bold(m.symbol)}`);
  }
}

function emitImportMatches(symbol: string, matches: ImportMatch[], asJson?: boolean): void {
  if (asJson) {
    process.stdout.write(JSON.stringify(matches, null, 2) + '\n');
    return;
  }
  logger.info('');
  if (matches.length === 0) {
    logger.warn(`No production imports of "${symbol}".`);
    return;
  }
  logger.success(`${matches.length} import(s) of "${symbol}":`);
  for (const m of matches) {
    logger.info(`  ${chalk.cyan(m.file)}:${m.line}  ${chalk.dim(m.importStatement)}`);
  }
}

function emitPatternMatches(pattern: string, matches: PatternMatch[], asJson?: boolean): void {
  if (asJson) {
    process.stdout.write(JSON.stringify(matches, null, 2) + '\n');
    return;
  }
  logger.info('');
  if (matches.length === 0) {
    logger.warn(`No matches for /${pattern}/.`);
    return;
  }
  logger.success(`${matches.length} match(es) for /${pattern}/:`);
  for (const m of matches) {
    logger.info(`  ${chalk.cyan(m.file)}:${m.line}  ${chalk.dim(m.text.slice(0, 100))}`);
  }
}
