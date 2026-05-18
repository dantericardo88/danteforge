// Matrix Kernel — Hardening check types (Phase C).
//
// PDSE rewards "module + passing tests + matrix bumped" but the rubric implicitly
// requires "capability delivered to the user that survives a skeptic regrade."
// Those came apart. Three sibling projects (DanteAgents, DanteFinance, DanteDojo)
// independently confirmed the failure mode:
//   - capability_test verifies SHAPE: function exists, returns something non-null
//   - real-world quality requires SUBSTANCE: function actually does what docstring claims
//   - LLM agents satisfy letter, not spirit, especially under usage caps
//
// The five harden checks are deterministic code inspections — no LLM judgment in
// the gate. An agent can only pass them by actually fixing the code.

import type { MatrixDimension } from '../../core/compete-matrix.js';

// ── Check IDs ─────────────────────────────────────────────────────────────────

export type HardenCheckId =
  | 'orphan-audit'        // is the capability_callsite reached by production imports?
  | 'claim-auditor'       // do numeric/textual claims in docstrings match code reality?
  | 'hardcoded-fallback'  // illustrative-data literals (e.g. return ['DIS','PFE']) in non-test code?
  | 'import-resolves'     // does every import in an except-ImportError / catch block exist?
  | 'functional-diff';    // two distinct inputs → byte-identical output (hardcoded behavior)?

/** Per-check score caps applied when the check fails. min wins across failed checks. */
export const HARDEN_CHECK_CAPS: Record<HardenCheckId, number> = {
  'orphan-audit': 6.0,
  'claim-auditor': 7.0,
  'hardcoded-fallback': 6.5,
  'import-resolves': 4.0,
  'functional-diff': 5.5,
};

/** Harden gate only fires for proposed scores at or above this threshold. */
export const HARDEN_GATE_THRESHOLD = 7.0;

// ── Per-check result ─────────────────────────────────────────────────────────

export interface HardenFinding {
  /** File path relative to cwd. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** Up to ~120 chars of context. */
  snippet: string;
  /** Human-readable explanation. */
  reason: string;
}

export interface HardenCheckResult {
  check: HardenCheckId;
  /** true if no findings (or all findings are explicitly overridden). */
  passed: boolean;
  /** Wall-clock duration. */
  durationMs: number;
  /** All findings (empty if passed). */
  findings: HardenFinding[];
  /** Score cap applied if this check fails (from HARDEN_CHECK_CAPS). */
  scoreCap: number;
  /** True when the check was not applicable (e.g. capability_callsite undeclared). */
  skipped?: boolean;
  /** Reason for skip. */
  skipReason?: string;
}

// ── Aggregate verdict ────────────────────────────────────────────────────────

export interface HardenVerdict {
  dimensionId: string;
  /** false if ANY check failed without an explicit override. */
  allowed: boolean;
  /** min(failed-check.scoreCap) or 10.0 when all checks pass. */
  scoreCap: number;
  /** All check results, including skipped. */
  checks: HardenCheckResult[];
  /** Path to .danteforge/harden-receipts/<sha>-<dimId>.json */
  evidencePath: string;
  ranAt: string;
  /** Human-readable summary for logs. */
  reason: string;
}

// ── Overrides ────────────────────────────────────────────────────────────────

export interface HardenOverride {
  /** Which check to suppress. */
  check: HardenCheckId;
  /** Required: why this exception is approved. */
  reason: string;
  /** ISO date when the override was created. */
  approvedAt: string;
  /** Operator id (e.g. "richard.porras@realempanada.com"). */
  approvedBy: string;
  /** Optional: scope override to specific findings by file (glob). */
  fileGlob?: string;
}

// ── Status (written into matrix.json per dim) ────────────────────────────────

export interface HardenStatus {
  lastRun: string;
  lastVerdict: 'CLEAN' | 'WARN' | 'FAIL';
  failedChecks: HardenCheckId[];
  gateReceiptPath: string;
  /** When the dim was last successfully gated above HARDEN_GATE_THRESHOLD. */
  lastClearedAboveThreshold?: string;
}

// ── Options for runHardenGate ────────────────────────────────────────────────

export interface RunHardenGateOptions {
  dimensionId: string;
  dim: MatrixDimension;
  cwd: string;
  /** Only run these checks. Defaults to all five. */
  onlyChecks?: HardenCheckId[];
  /** Injection seam: replaces a specific check. Used by tests. */
  _check?: Partial<Record<HardenCheckId, (dim: MatrixDimension, cwd: string) => Promise<HardenCheckResult>>>;
  /** Skip writing the receipt file. */
  _noWrite?: boolean;
  /**
   * Phase H Time Machine integration injection seam. Best-effort commit on
   * every verdict so audits can reconstruct gate decisions. Pass `null` to
   * disable in tests; undefined (the default) lazy-imports the real function.
   */
  _createTimeMachineCommit?: ((opts: import('../../core/time-machine.js').CreateTimeMachineCommitOptions) => Promise<unknown>) | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compose the final score cap from a verdict: minimum cap across all failed
 * checks (lower cap wins), accounting for any overrides on the dim.
 */
export function computeHardenScoreCap(verdict: HardenVerdict): number {
  let lowest = 10.0;
  for (const r of verdict.checks) {
    if (r.passed || r.skipped) continue;
    if (r.scoreCap < lowest) lowest = r.scoreCap;
  }
  return lowest;
}

/**
 * Apply a verdict to a proposed score: clamp the proposed score down to the
 * verdict's scoreCap when the verdict is not allowed.
 */
export function applyHardenCap(proposedScore: number, verdict: HardenVerdict): number {
  if (verdict.allowed) return proposedScore;
  return Math.min(proposedScore, verdict.scoreCap);
}
