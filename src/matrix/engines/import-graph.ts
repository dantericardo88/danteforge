// import-graph.ts — Production import-graph reachability for JS/TS callsites.
//
// The Depth Doctrine's T4 bar is "production callsite wired". The basename check
// (outcome-integrity.ts buildWiredBasenames) credits a callsite when its module
// basename merely APPEARS in any import/require line of any non-test file — which
// also credits a token import, a re-export barrel nothing consumes, or a discarded
// construction. This module is the precision upgrade for JS/TS: a callsite is
// WIRED only when a chain of static imports/re-exports from a production
// ENTRYPOINT (package.json main/bin/exports, workspace packages, src/index.*,
// src/cli/index.*) actually reaches the callsite file.
//
// Design notes:
// - Specifier extraction is the same regex family as buildWiredBasenames
//   (from / import( / require( with a quoted specifier), so `export * from`,
//   side-effect imports, and literal dynamic import() are all followed.
//   (sanitize-boundary.ts buildSymbolGraph was considered per the reuse map, but
//   it builds a SINGLE-FILE symbol graph — declarations + intra-file references —
//   and extracts no module specifiers, so it cannot serve cross-file reachability;
//   per-file AST parsing would also burn the audit's time budget on large repos.)
// - Resolution is on-disk only: relative specifiers, ESM `.js`→`.ts` twins,
//   extension probing, and index files. Bare package specifiers are skipped, so
//   the walk can never enter node_modules.
// - The build is bounded by the caller's deadline + file budget. On exhaustion it
//   returns `{ ok: false }` so the audit degrades to the basename check instead of
//   hanging or hard-failing (the same non-blocking philosophy as the hardener's
//   orphan-scan timeout).

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImportReachability {
  ok: true;
  /** Normalized keys (see normKey) of every file reachable from a production entrypoint. */
  reachable: Set<string>;
  /** Project-relative entrypoint paths, for diagnostics. */
  entrypoints: string[];
  filesWalked: number;
}

export interface ImportReachabilityFailure {
  ok: false;
  /** Why the graph could not be built — the caller falls back to basename matching. */
  reason: string;
}

export type ImportReachabilityResult = ImportReachability | ImportReachabilityFailure;

export interface ReachabilityBudget {
  /** Wall-clock deadline (Date.now() ms). Tripping it degrades, never hangs. */
  deadlineMs: number;
  /** Max files admitted into the reachable set before degrading. */
  maxFiles: number;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
// ESM TS convention: an import of './x.js' compiles from './x.ts' — probe twins.
const EXT_TWINS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.jsx': ['.tsx', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
  '.ts': ['.ts'],
  '.tsx': ['.tsx'],
  '.mts': ['.mts'],
  '.cts': ['.cts'],
};

export function isJsTsCallsite(p: string): boolean {
  return /\.[cm]?[jt]sx?$/i.test(p);
}

/** Canonical membership key: resolved, forward slashes, case-folded on Windows. */
export function normKey(absPath: string): string {
  const n = path.resolve(absPath).replace(/\\/g, '/');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/** On-disk candidates for an import target: ext twins, ext probing, index files. */
function candidatePaths(abs: string): string[] {
  const ext = path.extname(abs).toLowerCase();
  const twins = EXT_TWINS[ext];
  if (twins) {
    const stem = abs.slice(0, -ext.length);
    return twins.map(t => stem + t);
  }
  const out: string[] = [];
  for (const t of SOURCE_EXTS) out.push(abs + t);
  for (const t of SOURCE_EXTS) out.push(path.join(abs, 'index' + t));
  return out;
}

async function fileExists(p: string, cache: Map<string, boolean>): Promise<boolean> {
  const k = normKey(p);
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  let ok = false;
  try { ok = (await fs.stat(p)).isFile(); } catch { ok = false; }
  cache.set(k, ok);
  return ok;
}

// ── Specifier extraction ──────────────────────────────────────────────────────

// Same recognizer family as buildWiredBasenames: static `from`, side-effect
// `import '...'`, literal dynamic `import('...')`, and `require('...')`.
const SPECIFIER_RE = /(?:from|import|require)\s*\(?\s*['"]([^'"\n]+)['"]/g;

function extractRelativeSpecifiers(content: string): string[] {
  const specs: string[] = [];
  for (const m of content.matchAll(SPECIFIER_RE)) {
    const s = m[1]!;
    if (s.startsWith('./') || s.startsWith('../')) specs.push(s);
  }
  return specs;
}

// ── Entrypoint resolution ─────────────────────────────────────────────────────

interface PkgLike {
  main?: unknown;
  module?: unknown;
  bin?: unknown;
  exports?: unknown;
  workspaces?: unknown;
}

async function readPkg(dir: string): Promise<PkgLike | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as PkgLike;
  } catch {
    return null;
  }
}

/** All JS-shaped relative paths a package.json declares as public entry surfaces. */
function collectPkgEntryRels(pkg: PkgLike): string[] {
  const rels: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) rels.push(v.trim());
  };
  push(pkg.main);
  push(pkg.module);
  if (typeof pkg.bin === 'string') push(pkg.bin);
  else if (pkg.bin && typeof pkg.bin === 'object') for (const v of Object.values(pkg.bin)) push(v);
  const walkExports = (node: unknown): void => {
    if (typeof node === 'string') { push(node); return; }
    if (node && typeof node === 'object') for (const v of Object.values(node)) walkExports(v);
  };
  walkExports(pkg.exports);
  return rels.filter(r => !r.endsWith('.d.ts') && isJsTsCallsite(r));
}

// A main/bin pointing at build output (dist/index.js) usually compiles from a src
// twin — probe it so the graph roots in real source, not just the bundle.
const BUILD_OUTPUT_DIRS = new Set(['dist', 'build', 'out']);
function srcTwinsOf(rel: string): string[] {
  const parts = rel.replace(/^\.\//, '').replace(/\\/g, '/').split('/');
  if (parts.length < 2 || !BUILD_OUTPUT_DIRS.has(parts[0]!)) return [];
  return [['src', ...parts.slice(1)].join('/')];
}

const MAX_WORKSPACE_DIRS = 64;

/** Expand simple workspace globs ("packages/*") to candidate package dirs. */
async function listWorkspaceDirs(projectPath: string, pkg: PkgLike): Promise<string[]> {
  const raw: unknown[] = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : (pkg.workspaces && typeof pkg.workspaces === 'object'
        && Array.isArray((pkg.workspaces as { packages?: unknown }).packages))
      ? (pkg.workspaces as { packages: unknown[] }).packages
      : [];
  const dirs: string[] = [];
  for (const pat of raw) {
    if (typeof pat !== 'string' || pat.trim() === '') continue;
    const starIdx = pat.indexOf('*');
    if (starIdx === -1) { dirs.push(path.join(projectPath, pat)); continue; }
    const baseRel = pat.slice(0, starIdx).replace(/[/\\]+$/, '');
    try {
      const entries = await fs.readdir(path.join(projectPath, baseRel), { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
          dirs.push(path.join(projectPath, baseRel, e.name));
        }
      }
    } catch { /* base dir missing — pattern matches nothing */ }
    if (dirs.length >= MAX_WORKSPACE_DIRS) break;
  }
  return dirs.slice(0, MAX_WORKSPACE_DIRS);
}

async function resolveEntrypoints(
  projectPath: string,
  existsCache: Map<string, boolean>,
): Promise<string[]> {
  const found = new Map<string, string>();
  const tryAdd = async (abs: string): Promise<void> => {
    for (const cand of candidatePaths(abs)) {
      if (await fileExists(cand, existsCache)) {
        found.set(normKey(cand), cand);
        return;
      }
    }
  };

  // Conventional roots — resolve whatever exists on disk.
  await tryAdd(path.join(projectPath, 'src', 'index'));
  await tryAdd(path.join(projectPath, 'src', 'cli', 'index'));

  // Root package.json + workspace packages.
  const roots: Array<{ dir: string; pkg: PkgLike }> = [];
  const rootPkg = await readPkg(projectPath);
  if (rootPkg) {
    roots.push({ dir: projectPath, pkg: rootPkg });
    for (const wd of await listWorkspaceDirs(projectPath, rootPkg)) {
      await tryAdd(path.join(wd, 'src', 'index'));
      const wp = await readPkg(wd);
      if (wp) roots.push({ dir: wd, pkg: wp });
    }
  }
  for (const { dir, pkg } of roots) {
    for (const rel of collectPkgEntryRels(pkg)) {
      await tryAdd(path.join(dir, rel));
      for (const twin of srcTwinsOf(rel)) await tryAdd(path.join(dir, twin));
    }
  }
  return [...found.values()];
}

// ── Reachability build ────────────────────────────────────────────────────────

/**
 * Build the set of files reachable from production entrypoints via static
 * imports/re-exports. Returns `{ ok: false }` (never throws, never hangs) when
 * no entrypoint resolves or the budget trips — callers degrade to the basename
 * check so the audit always completes.
 */
export async function buildImportReachability(
  projectPath: string,
  budget: ReachabilityBudget,
): Promise<ImportReachabilityResult> {
  const existsCache = new Map<string, boolean>();
  let entrypoints: string[];
  try {
    entrypoints = await resolveEntrypoints(projectPath, existsCache);
  } catch (err) {
    return { ok: false, reason: `entrypoint resolution failed: ${(err as Error).message}` };
  }
  if (Date.now() > budget.deadlineMs) {
    return { ok: false, reason: 'import-graph build exceeded its time budget during entrypoint resolution' };
  }
  if (entrypoints.length === 0) {
    return {
      ok: false,
      reason: 'no production entrypoints resolvable (package.json main/bin/exports, src/index.*, src/cli/index.*)',
    };
  }

  const reachable = new Set<string>(entrypoints.map(normKey));
  const queue = [...entrypoints];
  let walked = 0;
  while (queue.length > 0) {
    if (Date.now() > budget.deadlineMs) {
      return { ok: false, reason: `import-graph build exceeded its time budget after ${walked} files` };
    }
    if (reachable.size > budget.maxFiles) {
      return { ok: false, reason: `import-graph build exceeded its file budget (${budget.maxFiles} files)` };
    }
    const file = queue.shift()!;
    walked++;
    let content: string;
    try { content = await fs.readFile(file, 'utf8'); } catch { continue; }
    const dir = path.dirname(file);
    for (const spec of extractRelativeSpecifiers(content)) {
      const target = path.resolve(dir, spec);
      if (normKey(target).includes('/node_modules/')) continue;
      for (const cand of candidatePaths(target)) {
        const k = normKey(cand);
        if (reachable.has(k)) break; // target already resolved + queued
        if (await fileExists(cand, existsCache)) {
          reachable.add(k);
          queue.push(cand);
          break;
        }
      }
    }
  }

  return {
    ok: true,
    reachable,
    entrypoints: entrypoints.map(e => path.relative(projectPath, e).replace(/\\/g, '/')),
    filesWalked: walked,
  };
}

/** Is the declared callsite (project-relative path) reachable from an entrypoint? */
export function isCallsiteReachable(
  r: ImportReachability,
  projectPath: string,
  callsite: string,
): boolean {
  const abs = path.resolve(projectPath, callsite);
  if (r.reachable.has(normKey(abs))) return true;
  // The matrix may declare the compiled name (.js) while the source is .ts.
  for (const cand of candidatePaths(abs)) {
    if (r.reachable.has(normKey(cand))) return true;
  }
  return false;
}
