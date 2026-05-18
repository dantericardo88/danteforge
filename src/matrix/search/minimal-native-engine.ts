// MinimalNativeEngine — TS-symbol-aware SearchEngine that reuses DanteForge's
// existing `buildSymbolGraph` (sanitize-boundary.ts) for symbol extraction and
// delegates pattern search to the RipgrepFallback.
//
// HONEST SCOPE: This is the Phase L MVP. It is NOT the full PRD-specified
// native engine. Explicitly NOT included in this implementation:
//   - BM25 sparse keyword index
//   - tree-sitter symbol-aware chunking (uses the existing `typescript` AST
//     parser already in the codebase instead)
//   - Quantized vector index + hybrid retrieval
//   - Cross-language support (Python/Go/Rust covered only via ripgrep fallback)
//
// What it DOES provide:
//   - Pre-built per-file symbol map so findSymbol is O(symbols) not O(files)
//   - Symbol-aware filtering: findSymbol returns AST-level declarations, not
//     regex line matches
//   - findImports via ripgrep (same path as RipgrepFallback) — full Phase L
//     would index imports too
//   - findPattern delegated to RipgrepFallback
//
// The substrate gets the speed-up where it matters (orphan-audit calls
// findImports + findSymbol on every dim every wave) without the multi-day
// native-engine investment.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSymbolGraph } from '../../core/sanitize-boundary.js';
import { RipgrepFallback } from './ripgrep-fallback.js';
import type {
  IndexHandle,
  IndexOptions,
  ImportMatch,
  PatternMatch,
  SearchEngine,
  SearchOpts,
  SymbolMatch,
} from './types.js';

const execFileAsync = promisify(execFile);
const INDEX_DIR = path.join('.danteforge', 'search-index');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.danteforge', 'coverage', 'build', '.next']);
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function isTestFile(relPath: string): boolean {
  const lower = relPath.replace(/\\/g, '/').toLowerCase();
  if (lower.includes('/__tests__/')) return true;
  if (lower.includes('/test/') || lower.includes('/tests/')) return true;
  if (lower.includes('/spec/') || lower.includes('/specs/')) return true;
  return /\.(test|spec)\.[mc]?[jt]sx?$/i.test(lower);
}

async function walkTsFiles(cwd: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        await walk(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!TS_EXTENSIONS.has(ext)) continue;
        out.push(path.relative(cwd, path.join(dir, ent.name)).replace(/\\/g, '/'));
      }
    }
  }
  await walk(cwd);
  return out;
}

interface SymbolEntry {
  file: string;
  line: number;
  symbol: string;
  kind: SymbolMatch['kind'];
  exported: boolean;
}

export class MinimalNativeEngine implements SearchEngine {
  private symbolIndex = new Map<string, SymbolEntry[]>();
  private ripgrep = new RipgrepFallback();
  private indexedRoot: string | null = null;

  async index(repoRoot: string, options?: IndexOptions): Promise<IndexHandle> {
    const start = Date.now();
    const forceCold = options?.forceCold ?? false;
    if (this.indexedRoot === repoRoot && !forceCold) {
      // Already indexed in-memory; return a fresh handle without re-walking.
      return {
        engine: 'native',
        repoRoot,
        gitSha: null,
        indexedMs: 0,
        fileCount: this.symbolIndex.size > 0
          ? new Set(Array.from(this.symbolIndex.values()).flat().map(e => e.file)).size
          : 0,
      };
    }

    // Phase L.4: on-disk per-SHA index persistence. Try to load from disk
    // when forceCold is false; rebuild and persist when missing or stale.
    const gitSha = await readGitSha(repoRoot);
    if (!forceCold && gitSha) {
      const loaded = await loadIndexFromDisk(repoRoot, gitSha);
      if (loaded) {
        this.symbolIndex = loaded.symbolIndex;
        this.indexedRoot = repoRoot;
        return {
          engine: 'native',
          repoRoot,
          gitSha,
          indexedMs: Date.now() - start,
          fileCount: loaded.fileCount,
        };
      }
    }

    this.symbolIndex.clear();
    const files = await walkTsFiles(repoRoot);
    for (const rel of files) {
      let content: string;
      try { content = await fs.readFile(path.join(repoRoot, rel), 'utf8'); }
      catch { continue; }
      let graph;
      try { graph = buildSymbolGraph(content, rel); }
      catch { continue; }
      for (const [name, node] of graph.nodes) {
        const entry: SymbolEntry = {
          file: rel,
          line: node.startLine,
          symbol: name,
          kind: node.kind as SymbolMatch['kind'],
          exported: node.exported,
        };
        const list = this.symbolIndex.get(name) ?? [];
        list.push(entry);
        this.symbolIndex.set(name, list);
      }
    }

    this.indexedRoot = repoRoot;
    // Persist to disk for next cold-start (Phase L.4).
    if (gitSha) {
      void saveIndexToDisk(repoRoot, gitSha, this.symbolIndex, files.length);
    }
    return {
      engine: 'native',
      repoRoot,
      gitSha,
      indexedMs: Date.now() - start,
      fileCount: files.length,
    };
  }

  async findSymbol(query: string, opts: SearchOpts = {}): Promise<SymbolMatch[]> {
    // Ensure index exists before lookup. Lazy index on first query.
    if (this.indexedRoot === null) {
      await this.index(process.cwd());
    }
    const entries = this.symbolIndex.get(query) ?? [];
    const includeTests = opts.includeTests ?? false;
    const max = opts.maxResults ?? 1000;
    const out: SymbolMatch[] = [];
    for (const e of entries) {
      if (!includeTests && isTestFile(e.file)) continue;
      if (opts.glob && !matchesGlob(e.file, opts.glob)) continue;
      out.push({
        file: e.file,
        line: e.line,
        symbol: e.symbol,
        kind: e.kind,
        exported: e.exported,
      });
      if (out.length >= max) break;
    }
    return out;
  }

  async findImports(symbol: string, opts: SearchOpts = {}): Promise<ImportMatch[]> {
    // Delegate to ripgrep for now — full native engine would index imports too.
    return this.ripgrep.findImports(symbol, opts);
  }

  async findPattern(regex: string, opts: SearchOpts = {}): Promise<PatternMatch[]> {
    return this.ripgrep.findPattern(regex, opts);
  }

  async close(_handle: IndexHandle): Promise<void> {
    void _handle;
    this.symbolIndex.clear();
    this.indexedRoot = null;
  }
}

// ── Phase L.4: on-disk index persistence ────────────────────────────────────

async function readGitSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 2000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function repoHash(repoRoot: string): string {
  return crypto.createHash('sha256').update(path.resolve(repoRoot)).digest('hex').slice(0, 16);
}

function indexPathFor(repoRoot: string, gitSha: string): string {
  return path.join(repoRoot, INDEX_DIR, repoHash(repoRoot), gitSha, 'symbol-index.json');
}

interface SerializedIndex {
  version: 1;
  gitSha: string;
  fileCount: number;
  symbolIndex: Array<[string, SymbolEntry[]]>;
  builtAt: string;
}

async function loadIndexFromDisk(
  repoRoot: string,
  gitSha: string,
): Promise<{ symbolIndex: Map<string, SymbolEntry[]>; fileCount: number } | null> {
  const p = indexPathFor(repoRoot, gitSha);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as SerializedIndex;
    if (parsed.version !== 1 || parsed.gitSha !== gitSha) return null;
    return {
      symbolIndex: new Map(parsed.symbolIndex),
      fileCount: parsed.fileCount,
    };
  } catch {
    return null;
  }
}

async function saveIndexToDisk(
  repoRoot: string,
  gitSha: string,
  symbolIndex: Map<string, SymbolEntry[]>,
  fileCount: number,
): Promise<void> {
  const p = indexPathFor(repoRoot, gitSha);
  const payload: SerializedIndex = {
    version: 1,
    gitSha,
    fileCount,
    symbolIndex: Array.from(symbolIndex.entries()),
    builtAt: new Date().toISOString(),
  };
  try {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(payload), 'utf8');
    // TTL cleanup: keep last 10 indexes per repo per docs/CAPABILITY-TIERS R2.
    await pruneOldIndexes(repoRoot, gitSha);
  } catch {
    // Persistence failure is non-fatal — in-memory index still works.
  }
}

async function pruneOldIndexes(repoRoot: string, currentSha: string): Promise<void> {
  const root = path.join(repoRoot, INDEX_DIR, repoHash(repoRoot));
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    if (dirs.length <= 10) return;
    // Sort by mtime — keep the 10 most recent.
    const stats = await Promise.all(dirs.map(async d => {
      try {
        const st = await fs.stat(path.join(root, d));
        return { name: d, mtimeMs: st.mtimeMs };
      } catch {
        return { name: d, mtimeMs: 0 };
      }
    }));
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const toRemove = stats.slice(10).map(s => s.name).filter(n => n !== currentSha);
    for (const name of toRemove) {
      try { await fs.rm(path.join(root, name), { recursive: true, force: true }); }
      catch { /* skip */ }
    }
  } catch { /* skip */ }
}

function matchesGlob(rel: string, glob: string): boolean {
  const re = new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, ' ')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/ /g, '.*') +
      '$',
  );
  return re.test(rel);
}
