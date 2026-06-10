// outcome-integrity.ts — Cross-dimension outcome sharing detector.
//
// The structural score inflation problem: the same test file appears as T5+
// evidence in 5+ dimensions simultaneously. One test suite cannot be
// multi-receipt for five capabilities — that's one receipt, not five.
//
// This module detects cross-dim shared receipts, seamed tests (injection-seam
// commands that prove code paths exist, not real behavior), and market dims
// that should be capped at 5.0 from internal tests alone.
//
// Called by `danteforge validate` as a best-effort pre-flight check. Violations
// are warnings, not blockers — the ceiling is enforced by derived-score.ts.

import fs from 'node:fs/promises';
import path from 'node:path';
import { extractPrimaryTestFiles } from '../../core/derived-score.js';
import { MARKET_CAPPED_DIMS } from '../../core/market-dims.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ViolationKind = 'SHARED_RECEIPT' | 'MARKET_DIM' | 'SEAM_USAGE' | 'CALLSITE_DECOUPLED' | 'ORPHAN_CALLSITE';
export type Severity = 'ERROR' | 'WARN';

export interface IntegrityViolation {
  kind: ViolationKind;
  severity: Severity;
  dimId: string;
  outcomeId: string;
  detail: string;
}

export interface IntegrityReport {
  violations: IntegrityViolation[];
  sharedReceiptDims: string[];
  marketCapDims: string[];
  seamedDims: string[];
  /** Dims whose high-tier outcome runs a test file that does NOT reference its required_callsite. */
  decoupledDims: string[];
  /** Dims with a T4+ outcome whose required_callsite EXISTS + is tested but is never imported by
   *  any production (non-test) src file — an orphan. Unwired code can't honestly claim T4+ (Depth
   *  Doctrine: T4 = production callsite wired). */
  orphanDims: string[];
  clean: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HIGH_TIERS = new Set(['T5', 'T6', 'T7', 'T8']);
// The orphan (production-wiring) check applies from T4 up — T4 IS the
// "production callsite wired" tier, so an unwired T4+ callsite is a violation.
const T4_PLUS = new Set(['T4', 'T5', 'T6', 'T7', 'T8']);
const MARKET_DIMS = MARKET_CAPPED_DIMS; // canonical set — src/core/market-dims.ts

const SEAM_PATTERNS = [
  /_cipCheck/,
  /_runPass/,
  /_runAutoforge/,
  /_runVerify/,
  /_now\b/,
  /_discover/,
  /_loadMatrix/,
  /_runAdapter/,
  /jest\.mock\(/,
  /vi\.mock\(/,
  /sinon\.stub\(/,
  /sinon\.mock\(/,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Single source of truth: the same extractor derived-score.ts uses for its
// distinct-receipt T7 veto. Sharing the regex prevents the integrity reporter
// and the score engine from disagreeing about what counts as "the same file"
// (the regex must include `/` so tests/a/x.test.ts ≠ tests/b/x.test.ts).
const extractTestFiles = extractPrimaryTestFiles;

export async function commandHasSeams(command: string, projectPath: string): Promise<boolean> {
  // Check the command string itself first
  if (SEAM_PATTERNS.some(p => p.test(command))) return true;
  // Check referenced test files for seam patterns
  const testFiles = extractTestFiles(command);
  for (const tf of testFiles) {
    const candidates = [
      path.join(projectPath, 'tests', tf),
      path.join(projectPath, 'src', tf),
      path.join(projectPath, tf),
    ];
    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, 'utf8');
        if (SEAM_PATTERNS.some(p => p.test(content))) return true;
      } catch {
        // file not found at this path — try next
      }
    }
  }
  return false;
}

// Callsite-coupling check: does the outcome's command actually exercise the file it
// claims as required_callsite? The audit found outcomes running an unrelated test
// (e.g. data-privacy-real-benchmark.test.ts) while declaring a different callsite — the
// evidence is about the wrong code. We verify by reading the referenced test file(s) and
// checking they mention the callsite module. Conservative by construction: only fires
// when we successfully read a referenced test file and NONE mention the callsite. Product
// runs (no test file) and unreadable files are NOT flagged.
function callsiteToken(requiredCallsite: string): string {
  const base = requiredCallsite.split(/[\\/]/).pop() ?? requiredCallsite;
  return base.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go)$/, '');
}

async function commandExercisesCallsite(
  command: string, requiredCallsite: string, projectPath: string,
): Promise<boolean> {
  const token = callsiteToken(requiredCallsite);
  if (!token || token.length < 3) return true; // too-generic to judge — don't false-flag
  const testFiles = extractTestFiles(command);
  if (testFiles.length === 0) return true; // product run / no test to inspect — not checkable here
  let readAny = false;
  for (const tf of testFiles) {
    for (const candidate of [path.join(projectPath, 'tests', tf), path.join(projectPath, 'src', tf), path.join(projectPath, tf)]) {
      try {
        const content = await fs.readFile(candidate, 'utf8');
        readAny = true;
        if (content.includes(token)) return true;
      } catch { /* try next candidate */ }
    }
  }
  return !readAny; // read a test file but none referenced the callsite → decoupled
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface MinimalDim {
  id: string;
  outcomes?: Array<{ id: string; tier: string; kind?: string; command?: string; required_callsite?: string }>;
}

export async function checkOutcomeIntegrity(
  dims: MinimalDim[],
  projectPath: string,
): Promise<IntegrityReport> {
  const violations: IntegrityViolation[] = [];
  const sharedReceiptDimSet = new Set<string>();
  const marketCapDimSet = new Set<string>();
  const seamedDimSet = new Set<string>();
  const decoupledDimSet = new Set<string>();
  const orphanDimSet = new Set<string>();
  // Lazily built (only when a T4+ outcome with a callsite needs the orphan check).
  let wiredBasenames: Set<string> | null = null;

  // Map: testFile -> [(dimId, outcomeId), ...]  for T5+ outcomes
  const fileToOutcomes = new Map<string, Array<{ dimId: string; outcomeId: string }>>();

  for (const dim of dims) {
    const outcomes = dim.outcomes ?? [];

    for (const outcome of outcomes) {
      const command = outcome.command ?? '';

      // Orphan (production-wiring) check — T4+. A required_callsite that is never imported by any
      // production (non-test) src file is an orphan: it may have a passing seam-free test, but the
      // capability isn't wired into the product, so it can't honestly claim T4+. (The coupling +
      // seam checks below only prove the TEST exercises the module — not that PRODUCTION calls it.)
      const cs = outcome.required_callsite;
      if (T4_PLUS.has(outcome.tier) && cs && !cs.startsWith('tests/') && !cs.endsWith('.test.ts')) {
        if (wiredBasenames === null) wiredBasenames = await buildWiredBasenames(projectPath);
        const base = path.basename(cs).replace(/\.([cm]?[jt]sx?|py|rs|go)$/, '');
        if (!wiredBasenames.has(base)) {
          orphanDimSet.add(dim.id);
          violations.push({
            kind: 'ORPHAN_CALLSITE', severity: 'ERROR', dimId: dim.id, outcomeId: outcome.id,
            detail: `Outcome "${outcome.id}" required_callsite "${cs}" is not imported by any production (non-test) src file — an orphan (unwired). Unwired code cannot honestly claim T4+; capped at 7.0 until it is wired into the product or the outcome is downgraded.`,
          });
        }
      }

      if (!HIGH_TIERS.has(outcome.tier)) continue;

      // Index test files for cross-dim sharing detection
      const testFiles = extractTestFiles(command);
      for (const tf of testFiles) {
        const existing = fileToOutcomes.get(tf) ?? [];
        existing.push({ dimId: dim.id, outcomeId: outcome.id });
        fileToOutcomes.set(tf, existing);
      }

      // Market dim check
      if (MARKET_DIMS.has(dim.id)) {
        marketCapDimSet.add(dim.id);
        violations.push({
          kind: 'MARKET_DIM',
          severity: 'WARN',
          dimId: dim.id,
          outcomeId: outcome.id,
          detail:
            `${dim.id} is a market dim — internal tests cannot exceed 5.0. ` +
            `External signals (download counts, GitHub stars) required for higher scores.`,
        });
      }

      // Seam check
      try {
        const hasSeams = await commandHasSeams(command, projectPath);
        if (hasSeams) {
          seamedDimSet.add(dim.id);
          violations.push({
            kind: 'SEAM_USAGE',
            severity: 'WARN',
            dimId: dim.id,
            outcomeId: outcome.id,
            detail:
              `Outcome "${outcome.id}" uses injection seams (_cipCheck, _runPass, vi.mock, etc.). ` +
              `Seamed outcomes prove code paths exist, not real behavior. Score capped at 6.0.`,
          });
        }
      } catch {
        // seam check is best-effort
      }

      // Callsite-coupling check: the high-tier outcome must exercise the file it claims.
      if (outcome.required_callsite) {
        try {
          const exercises = await commandExercisesCallsite(command, outcome.required_callsite, projectPath);
          if (!exercises) {
            decoupledDimSet.add(dim.id);
            violations.push({
              kind: 'CALLSITE_DECOUPLED',
              severity: 'ERROR',
              dimId: dim.id,
              outcomeId: outcome.id,
              detail:
                `Outcome "${outcome.id}" runs a test that does not reference its required_callsite ` +
                `"${outcome.required_callsite}". The evidence exercises different code than the dim claims — ` +
                `capped at 7.0 until the outcome runs the declared callsite.`,
            });
          }
        } catch {
          // coupling check is best-effort
        }
      }
    }
  }

  // Cross-dim shared-receipt detection.
  // Two dims legitimately sharing a test (e.g. gates.test.ts proving both spec
  // enforcement AND governance) is acceptable. Three or more dims sharing the
  // same file is egregious — one test suite cannot be multi-receipt for 3+
  // distinct capabilities simultaneously.
  for (const [testFile, refs] of fileToOutcomes) {
    const dimsUsingFile = new Set(refs.map(r => r.dimId));
    if (dimsUsingFile.size < 3) continue;

    for (const ref of refs) {
      sharedReceiptDimSet.add(ref.dimId);
      violations.push({
        kind: 'SHARED_RECEIPT',
        severity: 'ERROR',
        dimId: ref.dimId,
        outcomeId: ref.outcomeId,
        detail:
          `"${testFile}" is used as T5+ evidence in ${dimsUsingFile.size} dimensions ` +
          `(${[...dimsUsingFile].join(', ')}). One test suite cannot be multi-receipt ` +
          `for ${dimsUsingFile.size} capabilities — both dims capped at 7.0.`,
      });
    }
  }

  return {
    violations,
    sharedReceiptDims: [...sharedReceiptDimSet],
    marketCapDims: [...marketCapDimSet],
    seamedDims: [...seamedDimSet],
    decoupledDims: [...decoupledDimSet],
    orphanDims: [...orphanDimSet],
    clean: violations.length === 0,
  };
}

// Collect the basename of every locally-imported module across all non-test source
// files in the project (static import, dynamic import(), and require()). A
// required_callsite whose basename is NOT in this set is never imported by
// production code = an orphan. Basename matching is deliberate: it catches dynamic
// and registrar wiring that a static `from`-only scan misses (so dynamically-loaded
// CLI commands aren't false-flagged). Walks the WHOLE project (skipping deps/build/
// tests) so it handles monorepos (packages/*/src) — not just a single src/ — which
// is essential for the fleet (DanteCode etc. are monorepos).
const WIRE_SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.danteforge', 'coverage', '.next', 'build', 'out', '.turbo', '.cache', '.vscode-test']);
const WIRE_IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
// Language-aware import scanners — production wiring exists in any language the fleet targets,
// not just JS/TS. Without these, a Python/Rust/Go required_callsite is NEVER found in the wired
// set and is force-flagged ORPHAN_CALLSITE (capped 7.0) even when production genuinely calls it.
//   Python: `from a.b.c import X` / `import a.b.c [as d]`  → wired basename = last dotted segment (c).
//   Rust:   `mod foo;` (declares foo.rs) + `use a::b::C;`   → wired basenames = each path segment.
//   Go:     `import "pkg/foo"` is quoted → handled by WIRE_IMPORT_RE (basename of the path).
const WIRE_PY_FROM_RE = /^[ \t]*from[ \t]+([.\w]+)[ \t]+import\b/gm;
const WIRE_PY_IMPORT_RE = /^[ \t]*import[ \t]+([.\w]+)/gm;
const WIRE_RS_MOD_RE = /^[ \t]*(?:pub[ \t]+)?mod[ \t]+(\w+)/gm;
const WIRE_RS_USE_RE = /\buse[ \t]+([\w:]+)/g;
function isTestPath(p: string): boolean {
  const n = p.replace(/\\/g, '/');
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(n)        // JS/TS
    || /\/(tests?|__tests__)\//.test(n)                // any test dir
    || /(^|\/)test_\w+\.py$/.test(n) || /_test\.py$/.test(n) || /(^|\/)conftest\.py$/.test(n)  // Python
    || /_test\.go$/.test(n);                            // Go
}
// A production source file in any language DanteForge fleets target.
function isWireSource(name: string): boolean {
  return /\.([cm]?[jt]sx?|py|rs|go)$/.test(name);
}
export async function buildWiredBasenames(projectPath: string): Promise<Set<string>> {
  const wired = new Set<string>();
  const addLast = (spec: string, sep: string): void => {
    const seg = spec.split(sep).filter(Boolean).pop();
    if (seg) wired.add(seg);
  };
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!WIRE_SKIP_DIRS.has(e.name)) await walk(p); continue; }
      if (!isWireSource(e.name) || isTestPath(p)) continue;
      let content: string;
      try { content = await fs.readFile(p, 'utf8'); } catch { continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (ext === '.py') {
        for (const m of content.matchAll(WIRE_PY_FROM_RE)) addLast(m[1]!, '.');
        for (const m of content.matchAll(WIRE_PY_IMPORT_RE)) addLast(m[1]!, '.');
      } else if (ext === '.rs') {
        for (const m of content.matchAll(WIRE_RS_MOD_RE)) wired.add(m[1]!);
        for (const m of content.matchAll(WIRE_RS_USE_RE))
          for (const seg of m[1]!.split('::'))
            if (seg && seg !== 'crate' && seg !== 'super' && seg !== 'self') wired.add(seg);
      } else {
        // JS/TS and Go both use quoted specifiers.
        for (const match of content.matchAll(WIRE_IMPORT_RE)) {
          const mod = match[1]!;
          if (!mod.includes('/')) continue; // bare package import — not a local module
          wired.add(path.basename(mod).replace(/\.[cm]?[jt]sx?$/, ''));
        }
      }
    }
  }
  await walk(projectPath);
  return wired;
}

export type IntegrityCapKind = 'SHARED_RECEIPT' | 'SEAM_USAGE' | 'CALLSITE_DECOUPLED' | 'ORPHAN_CALLSITE';

/**
 * Cap a score by a dim's outcome-integrity violations. Seam is the strictest
 * cap (6.0) — checked first so a dim that is both seamed AND shared/decoupled
 * gets the lower ceiling. Shared-receipt and callsite-decoupled cap at 7.0.
 *
 * This is the SINGLE source of truth for integrity caps. Both validate.ts
 * (which surfaces the cap to the operator) and the loadMatrix-derived path
 * (applyOutcomeDerivedScores) call it, so the headline score can never drift
 * above the honest, integrity-aware score the way it did before — derived was
 * recomputed UNcapped at load and clobbered validate's capped value.
 */
export function integrityCapFor(
  score: number,
  dimId: string,
  report: IntegrityReport | null,
): { cappedScore: number; integrityCap: IntegrityCapKind | undefined } {
  if (!report) return { cappedScore: score, integrityCap: undefined };
  if (report.seamedDims.includes(dimId) && score > 6.0)
    return { cappedScore: 6.0, integrityCap: 'SEAM_USAGE' };
  if (report.sharedReceiptDims.includes(dimId) && score > 7.0)
    return { cappedScore: 7.0, integrityCap: 'SHARED_RECEIPT' };
  if (report.decoupledDims.includes(dimId) && score > 7.0)
    return { cappedScore: 7.0, integrityCap: 'CALLSITE_DECOUPLED' };
  // Orphan: a T4+ outcome's required_callsite is not wired into production. The high-tier evidence
  // isn't validly anchored to product code → same 7.0 ceiling as callsite-decoupled.
  if ((report.orphanDims ?? []).includes(dimId) && score > 7.0)
    return { cappedScore: 7.0, integrityCap: 'ORPHAN_CALLSITE' };
  return { cappedScore: score, integrityCap: undefined };
}

export function formatIntegrityReport(report: IntegrityReport): string {
  if (report.clean) return 'Outcome integrity: clean';

  const lines: string[] = ['Outcome integrity violations detected:'];

  const byKind: Record<ViolationKind, IntegrityViolation[]> = {
    SHARED_RECEIPT: [],
    MARKET_DIM: [],
    SEAM_USAGE: [],
    CALLSITE_DECOUPLED: [],
    ORPHAN_CALLSITE: [],
  };
  for (const v of report.violations) byKind[v.kind].push(v);

  if (byKind.CALLSITE_DECOUPLED.length > 0) {
    lines.push('');
    lines.push('  CALLSITE_DECOUPLED (dims capped at 7.0):');
    for (const v of byKind.CALLSITE_DECOUPLED) {
      lines.push(`    [${v.dimId}] ${v.outcomeId}: ${v.detail}`);
    }
  }

  if (byKind.ORPHAN_CALLSITE.length > 0) {
    lines.push('');
    lines.push('  ORPHAN_CALLSITE (dims capped at 7.0 — callsite not wired into production):');
    for (const v of byKind.ORPHAN_CALLSITE) {
      lines.push(`    [${v.dimId}] ${v.outcomeId}: ${v.detail}`);
    }
  }

  if (byKind.SHARED_RECEIPT.length > 0) {
    lines.push('');
    lines.push('  SHARED_RECEIPT (dims capped at 7.0):');
    const seen = new Set<string>();
    for (const v of byKind.SHARED_RECEIPT) {
      const key = `${v.dimId}/${v.outcomeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`    [${v.dimId}] ${v.outcomeId}: ${v.detail}`);
    }
  }

  if (byKind.SEAM_USAGE.length > 0) {
    lines.push('');
    lines.push('  SEAM_USAGE (outcomes capped at 6.0):');
    for (const v of byKind.SEAM_USAGE) {
      lines.push(`    [${v.dimId}] ${v.outcomeId}: ${v.detail}`);
    }
  }

  if (byKind.MARKET_DIM.length > 0) {
    lines.push('');
    const marketDims = [...new Set(byKind.MARKET_DIM.map(v => v.dimId))];
    lines.push(`  MARKET_DIM (hard cap 5.0): ${marketDims.join(', ')}`);
  }

  return lines.join('\n');
}
