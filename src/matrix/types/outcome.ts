// Matrix Kernel — Outcome types (Phase F).
//
// THE LEAP: scores are no longer something agents write. They are computed at
// load time from the set of outcomes a dim declares and the evidence files
// showing which ones currently pass. Inflation becomes structurally impossible
// because there is no score field to inflate.
//
// Each Outcome is a shell command + an expected exit code (and optionally an
// output pattern). It runs cold, produces an evidence file keyed by gitSha,
// and contributes to the dim's derived score. The Capability Ladder tier is
// the unit of the score: a dim's score is determined by which tiers have all
// outcomes passing, with continuous progress within the next un-cleared tier.
//
// This replaces the writable scores.self field as the source of truth.

import type { CapabilityTier } from './capability-test.js';

// ── The shape of an outcome ──────────────────────────────────────────────────

export interface Outcome {
  /** Stable id, used to key evidence files. Must be unique within a dim. */
  id: string;
  /** The Capability Ladder tier this outcome contributes to. */
  tier: CapabilityTier;
  /** Human description: what user-visible thing this outcome proves. */
  description: string;
  /** Shell command run from the project root. Cold execution — no cache reuse. */
  command: string;
  /** Default 0 (exit success). Set non-zero only for "expected failure" outcomes. */
  expected_exit?: number;
  /** Optional regex on combined stdout+stderr that must match for the outcome to pass. */
  expected_output_pattern?: string;
  /** Default: T0/T1 60s, T2/T3 600s, T4+ 900s. */
  timeout_ms?: number;
  /** Tolerated flake rate (0..1) — fraction of recent runs that may fail. Default 0. */
  flake_tolerance?: number;
  /** When set, the outcome additionally requires a passing harden check on this file. */
  required_callsite?: string;
}

// ── Evidence ─────────────────────────────────────────────────────────────────

export interface OutcomeEvidenceEntry {
  dimensionId: string;
  outcomeId: string;
  tier: CapabilityTier;
  gitSha: string | null;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  /** Last ~100 lines of stdout, for forensics. */
  stdoutTail: string;
  /** Last ~100 lines of stderr. */
  stderrTail: string;
  /** Reason for failure when passed=false. */
  failureReason?: string;
  ranAt: string;
  /** Path to the file on disk that holds this entry. */
  evidencePath: string;
}

/**
 * Aggregate of outcome evidence for many dims/outcomes, keyed by `${dimId}/${outcomeId}`.
 * The runner produces this; the score derivation consumes it.
 */
export type OutcomeEvidence = Map<string, OutcomeEvidenceEntry>;

export function makeEvidenceKey(dimensionId: string, outcomeId: string): string {
  return `${dimensionId}/${outcomeId}`;
}

// ── Status snapshot (mirrored into matrix.json for fast display) ─────────────

export interface DimensionOutcomeStatus {
  lastRun: string;
  perOutcome: Record<string, {
    passed: boolean;
    evidencePath: string;
    ranAt: string;
  }>;
}

// ── Validators (pattern matches isCapabilityTestSpec) ────────────────────────

const TIER_NAMES: ReadonlyArray<CapabilityTier> = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

function isTier(v: unknown): v is CapabilityTier {
  return typeof v === 'string' && (TIER_NAMES as ReadonlyArray<string>).includes(v);
}

export function isValidOutcome(v: unknown): v is Outcome {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (!isTier(o.tier)) return false;
  if (typeof o.description !== 'string') return false;
  if (typeof o.command !== 'string' || o.command.length === 0) return false;
  return true;
}

/**
 * Apply default timeouts based on tier. Mutates the outcome (callers pass copies).
 */
export function applyOutcomeDefaults(outcome: Outcome): Outcome {
  if (outcome.timeout_ms !== undefined) return outcome;
  let timeout_ms: number;
  switch (outcome.tier) {
    case 'T0':
    case 'T1':
      timeout_ms = 60_000;
      break;
    case 'T2':
    case 'T3':
      timeout_ms = 600_000;
      break;
    default:
      timeout_ms = 900_000;
  }
  return { ...outcome, timeout_ms };
}

/**
 * Does the evidence entry pass? An outcome passes when:
 *   - exitCode === (outcome.expected_exit ?? 0), AND
 *   - if expected_output_pattern is set, stdout+stderr match it.
 */
export function isOutcomePassing(
  outcome: Outcome,
  entry: OutcomeEvidenceEntry | undefined,
): boolean {
  if (!entry) return false;
  if (!entry.passed) return false;
  const expectedExit = outcome.expected_exit ?? 0;
  if (entry.exitCode !== expectedExit) return false;
  if (outcome.expected_output_pattern) {
    try {
      const re = new RegExp(outcome.expected_output_pattern);
      if (!re.test(`${entry.stdoutTail}\n${entry.stderrTail}`)) return false;
    } catch {
      // Bad regex on the outcome declaration — treat as a hard fail with a clear reason.
      return false;
    }
  }
  return true;
}
