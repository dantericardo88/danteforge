// production-usage-fresh.ts — Phase H Slice 2 + Phase M.6.
//
// Built-in outcome runner for kind: 'production-usage-fresh'. Verifies that the
// capability's required_callsite is BOTH imported by at least one production
// (non-test) file AND that importer was modified within `freshnessDays` against
// `baseBranch`. Catches the orphan + parallel-implementation failure modes
// that plain test-passes-but-nothing-uses-it slip through.
//
// Phase M.6 (PRD section 4): when a SearchEngine is injected, importer
// discovery routes through `SearchEngine.findImports` instead of an internal
// regex+fs-walk. The legacy regex path is preserved as a fallback for parity
// and for environments where SearchEngine isn't available.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProductionUsageFreshOutcome, OutcomeEvidenceEntry } from '../types/outcome.js';
import type { SearchEngine } from '../search/types.js';

const execFileAsync = promisify(execFile);

// ── Helpers (mirrors hardener.ts patterns) ───────────────────────────────────

interface FreshIO {
  listFiles: (dir: string) => Promise<string[]>;
  readFile: (p: string) => Promise<string>;
  exists: (p: string) => Promise<boolean>;
  /** Returns ISO timestamp of last commit touching the file on baseBranch, or null. */
  getLastCommit: (file: string, cwd: string, baseBranch: string) => Promise<string | null>;
}

function defaultFreshIO(): FreshIO {
  return {
    readFile: (p) => fs.readFile(p, 'utf8'),
    exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
    listFiles: async (dir) => {
      const out: string[] = [];
      const walk = async (d: string): Promise<void> => {
        let entries: string[];
        try { entries = await fs.readdir(d); } catch { return; }
        for (const e of entries) {
          if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
          const full = path.join(d, e);
          try {
            const st = await fs.stat(full);
            if (st.isDirectory()) await walk(full);
            else if (/\.(tsx?|jsx?|mjs|py)$/.test(e)) out.push(full);
          } catch { /* skip */ }
        }
      };
      await walk(dir);
      return out;
    },
    getLastCommit: async (file, cwd, baseBranch) => {
      try {
        // Most-recent commit on baseBranch that touched the file. Falls back to HEAD if
        // baseBranch doesn't exist or git is unavailable.
        const args = ['log', '-1', '--format=%cI', baseBranch, '--', file];
        const { stdout } = await execFileAsync('git', args, { cwd, timeout: 5_000 });
        const iso = stdout.trim();
        if (iso) return iso;
        // Fallback: query HEAD.
        const { stdout: stdout2 } = await execFileAsync('git', ['log', '-1', '--format=%cI', '--', file], { cwd, timeout: 5_000 });
        return stdout2.trim() || null;
      } catch {
        return null;
      }
    },
  };
}

// ── The check ────────────────────────────────────────────────────────────────

export interface FreshCheckResult {
  passed: boolean;
  totalImporters: number;
  freshImporters: number;
  freshnessDays: number;
  baseBranch: string;
  detail: Array<{ importer: string; lastCommit: string | null; fresh: boolean }>;
  reason: string;
}

export async function runProductionUsageFresh(
  outcome: ProductionUsageFreshOutcome,
  cwd: string,
  io: FreshIO = defaultFreshIO(),
  searchEngine?: SearchEngine,
): Promise<FreshCheckResult> {
  const callsite = outcome.required_callsite;
  if (!callsite) {
    return {
      passed: false, totalImporters: 0, freshImporters: 0,
      freshnessDays: outcome.freshnessDays ?? 30,
      baseBranch: outcome.baseBranch ?? 'main',
      detail: [],
      reason: 'required_callsite is missing — production-usage-fresh cannot run',
    };
  }

  const callsiteAbsPath = path.join(cwd, callsite);
  if (!(await io.exists(callsiteAbsPath))) {
    return {
      passed: false, totalImporters: 0, freshImporters: 0,
      freshnessDays: outcome.freshnessDays ?? 30,
      baseBranch: outcome.baseBranch ?? 'main',
      detail: [],
      reason: `required_callsite "${callsite}" does not exist on disk`,
    };
  }

  // ── Step A: find production importers ──────────────────────────────────────

  const importers = searchEngine
    ? await findImportersViaSearchEngine(searchEngine, callsite, callsiteAbsPath, cwd)
    : await findImportersViaRegex(io, callsite, callsiteAbsPath, cwd);

  // ── Step B: freshness check ────────────────────────────────────────────────

  const freshnessDays = outcome.freshnessDays ?? 30;
  const baseBranch = outcome.baseBranch ?? 'main';
  const freshnessMs = freshnessDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - freshnessMs;

  const detail: FreshCheckResult['detail'] = [];
  let freshCount = 0;
  for (const imp of importers) {
    const rel = path.relative(cwd, imp);
    const iso = await io.getLastCommit(rel, cwd, baseBranch);
    const fresh = iso !== null && Date.parse(iso) >= cutoff;
    if (fresh) freshCount++;
    detail.push({ importer: rel, lastCommit: iso, fresh });
  }

  let passed = importers.length > 0 && freshCount > 0;
  let reason: string;
  if (importers.length === 0) {
    reason = `0 production files import "${callsite}" — capability is orphaned`;
  } else if (freshCount === 0) {
    reason = `${importers.length} production importers exist but none modified in the last ${freshnessDays}d on ${baseBranch} — capability is stale (likely superseded by parallel implementation)`;
  } else {
    reason = `${freshCount}/${importers.length} production importers modified within ${freshnessDays}d on ${baseBranch}`;
  }

  return {
    passed,
    totalImporters: importers.length,
    freshImporters: freshCount,
    freshnessDays,
    baseBranch,
    detail,
    reason,
  };
}

// ── Importer discovery — two paths ──────────────────────────────────────────

/**
 * Phase M.6 path: use SearchEngine.findImports to discover production
 * importers. Excludes the callsite file itself + any test files. Returns
 * absolute paths matching the legacy regex path's output.
 */
async function findImportersViaSearchEngine(
  engine: SearchEngine,
  callsite: string,
  callsiteAbsPath: string,
  cwd: string,
): Promise<string[]> {
  await engine.index(cwd).catch(() => undefined);
  const baseName = path.basename(callsite).replace(/\.(tsx?|jsx?|mjs|py)$/, '');
  // Use both findImports (semantic) and findPattern (regex fallback for
  // namespace/re-export edge cases that findImports might miss).
  const symbolMatches = await engine.findImports(baseName, { includeTests: false });
  const callsitePathNorm = path.normalize(callsiteAbsPath).replace(/\\/g, '/');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of symbolMatches) {
    const abs = path.resolve(cwd, m.file);
    const norm = abs.replace(/\\/g, '/');
    if (norm === callsitePathNorm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(abs);
  }
  return out;
}

/**
 * Legacy regex+fs-walk path. Preserved for parity testing and as a fallback
 * when SearchEngine is unavailable.
 */
async function findImportersViaRegex(
  io: FreshIO,
  callsite: string,
  callsiteAbsPath: string,
  cwd: string,
): Promise<string[]> {
  const moduleSpec = callsite.replace(/\.(tsx?|jsx?|mjs|py)$/, '').replace(/^src\//, '').replace(/^\.\//, '');
  const baseName = path.basename(callsite).replace(/\.(tsx?|jsx?|mjs|py)$/, '');
  const moduleNeedle = moduleSpec.replace(/[/\\]/g, '[/\\\\]');
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importRe = new RegExp(
    `(?:from|import|require)\\s*\\(?\\s*['"][^'"]*(?:${moduleNeedle}|[/\\\\]${escapedBase})(?:\\.[a-z]+)?['"]`,
    'g',
  );

  const cwdSrc = path.join(cwd, 'src');
  const allFiles = await io.listFiles(cwdSrc);
  const productionFiles = allFiles.filter(f => !/[/\\]tests?[/\\]/.test(f));
  const importers: string[] = [];
  for (const f of productionFiles) {
    if (path.resolve(f) === path.resolve(callsiteAbsPath)) continue;
    try {
      const content = await io.readFile(f);
      if (importRe.test(content)) importers.push(f);
      importRe.lastIndex = 0;
    } catch { /* skip */ }
  }
  return importers;
}

/** Convert a FreshCheckResult into an OutcomeEvidenceEntry. */
export function freshResultToEvidence(
  outcome: ProductionUsageFreshOutcome,
  dimensionId: string,
  result: FreshCheckResult,
  gitSha: string | null,
  evidencePath: string,
  durationMs: number,
): OutcomeEvidenceEntry {
  return {
    dimensionId,
    outcomeId: outcome.id,
    tier: outcome.tier,
    gitSha,
    passed: result.passed,
    exitCode: result.passed ? 0 : 1,
    durationMs,
    stdoutTail: JSON.stringify({
      totalImporters: result.totalImporters,
      freshImporters: result.freshImporters,
      freshnessDays: result.freshnessDays,
      baseBranch: result.baseBranch,
      // Truncate per-importer detail to top 20
      detail: result.detail.slice(0, 20),
    }, null, 2),
    stderrTail: '',
    failureReason: result.passed ? undefined : result.reason,
    ranAt: new Date().toISOString(),
    evidencePath,
  };
}
