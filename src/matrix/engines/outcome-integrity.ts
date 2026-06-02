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

// ── Types ─────────────────────────────────────────────────────────────────────

export type ViolationKind = 'SHARED_RECEIPT' | 'MARKET_DIM' | 'SEAM_USAGE' | 'CALLSITE_DECOUPLED';
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
  clean: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HIGH_TIERS = new Set(['T5', 'T6', 'T7', 'T8']);
const MARKET_DIMS = new Set(['community_adoption', 'enterprise_readiness']);

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

async function commandHasSeams(command: string, projectPath: string): Promise<boolean> {
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
  return base.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, '');
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

  // Map: testFile -> [(dimId, outcomeId), ...]  for T5+ outcomes
  const fileToOutcomes = new Map<string, Array<{ dimId: string; outcomeId: string }>>();

  for (const dim of dims) {
    const outcomes = dim.outcomes ?? [];

    for (const outcome of outcomes) {
      const command = outcome.command ?? '';
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
    clean: violations.length === 0,
  };
}

export function formatIntegrityReport(report: IntegrityReport): string {
  if (report.clean) return 'Outcome integrity: clean';

  const lines: string[] = ['Outcome integrity violations detected:'];

  const byKind: Record<ViolationKind, IntegrityViolation[]> = {
    SHARED_RECEIPT: [],
    MARKET_DIM: [],
    SEAM_USAGE: [],
    CALLSITE_DECOUPLED: [],
  };
  for (const v of report.violations) byKind[v.kind].push(v);

  if (byKind.CALLSITE_DECOUPLED.length > 0) {
    lines.push('');
    lines.push('  CALLSITE_DECOUPLED (dims capped at 7.0):');
    for (const v of byKind.CALLSITE_DECOUPLED) {
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
