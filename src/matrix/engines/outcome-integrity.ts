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

// ── Types ─────────────────────────────────────────────────────────────────────

export type ViolationKind = 'SHARED_RECEIPT' | 'MARKET_DIM' | 'SEAM_USAGE';
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

function extractTestFiles(command: string): string[] {
  const matches = command.match(/[\w.-]+\.test\.[jt]sx?/g);
  return matches ? [...new Set(matches)] : [];
}

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

// ── Main ──────────────────────────────────────────────────────────────────────

interface MinimalDim {
  id: string;
  outcomes?: Array<{ id: string; tier: string; kind?: string; command?: string }>;
}

export async function checkOutcomeIntegrity(
  dims: MinimalDim[],
  projectPath: string,
): Promise<IntegrityReport> {
  const violations: IntegrityViolation[] = [];
  const sharedReceiptDimSet = new Set<string>();
  const marketCapDimSet = new Set<string>();
  const seamedDimSet = new Set<string>();

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
    }
  }

  // Cross-dim shared-receipt detection
  for (const [testFile, refs] of fileToOutcomes) {
    const dimsUsingFile = new Set(refs.map(r => r.dimId));
    if (dimsUsingFile.size < 2) continue;

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
  };
  for (const v of report.violations) byKind[v.kind].push(v);

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
