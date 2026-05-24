// Matrix Kernel — Merge receipt schema with hand-rolled validators (Phase B).
//
// Every score write to matrix.json must produce a receipt containing tier-probe
// evidence (T1 compiled, T2 tests, etc.) and — when the proposed score is at or
// above HARDEN_GATE_THRESHOLD — harden evidence. Receipts without these blocks
// are rejected by the pre-commit hook.
//
// We deliberately avoid adding zod as a dependency: the existing capability-test
// types use simple type guards (isCapabilityTestSpec, isNoCapabilityTest), so we
// match that pattern. The validators below are pure, exhaustive, and cite
// missing/invalid fields in their error messages.

import type { CapabilityTier, TierResult } from './capability-test.js';
import type { HardenCheckResult, HardenCheckId } from './harden-check.js';

// ── Evidence blocks ──────────────────────────────────────────────────────────

export interface RuntimeEvidence {
  /** Highest tier that passed for this dim. */
  tier_reached: CapabilityTier | null;
  /** Per-tier results. */
  tier_results: TierResult[];
  /** Convenience aggregates. */
  build_exit?: number;
  test_exit?: number;
  mutation_score?: number;
  e2e_exit?: number;
}

export interface HardenEvidence {
  /** Was the harden gate run for this dim? */
  ran: boolean;
  /** True if no check failed without an override. */
  allowed: boolean;
  /** Score cap applied (10.0 when allowed, else min failed-check cap). */
  scoreCap: number;
  /** Per-check results. */
  checks: HardenCheckResult[];
  /** Checks that failed (for log convenience). */
  failedChecks: HardenCheckId[];
  /** Path to the receipt file. */
  evidencePath?: string;
}

// ── Top-level receipt ────────────────────────────────────────────────────────

export interface MergeReceipt {
  receiptId: string;
  reconciledAt: string;
  gitSha: string | null;
  proposalsConsidered: number;
  proposalsApplied: number;
  perDimension: Array<{
    dimensionId: string;
    proposedScore: number;
    appliedScore: number;
    capApplied: number;
    capTier: CapabilityTier | null;
    runtime_evidence: RuntimeEvidence;
    harden_evidence: HardenEvidence;
  }>;
  receiptPath: string;
}

// ── Validators ───────────────────────────────────────────────────────────────

const TIER_NAMES: ReadonlyArray<CapabilityTier> = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const HARDEN_CHECK_NAMES: ReadonlyArray<HardenCheckId> = [
  'orphan-audit', 'claim-auditor', 'hardcoded-fallback', 'import-resolves', 'functional-diff',
];

function isTier(v: unknown): v is CapabilityTier {
  return typeof v === 'string' && (TIER_NAMES as ReadonlyArray<string>).includes(v);
}

function isHardenCheckId(v: unknown): v is HardenCheckId {
  return typeof v === 'string' && (HARDEN_CHECK_NAMES as ReadonlyArray<string>).includes(v);
}

function pathInvalid(value: string): string | null {
  return value.length === 0 ? 'empty' : null;
}

export interface ValidationError {
  path: string;
  reason: string;
}

export function validateRuntimeEvidence(v: unknown): ValidationError[] {
  const errs: ValidationError[] = [];
  if (typeof v !== 'object' || v === null) {
    return [{ path: '.', reason: 'runtime_evidence must be an object' }];
  }
  const r = v as Record<string, unknown>;
  if (r.tier_reached !== null && !isTier(r.tier_reached)) {
    errs.push({ path: '.tier_reached', reason: 'must be null or T0..T6' });
  }
  if (!Array.isArray(r.tier_results)) {
    errs.push({ path: '.tier_results', reason: 'must be an array' });
  } else {
    r.tier_results.forEach((res, i) => {
      if (typeof res !== 'object' || res === null) {
        errs.push({ path: `.tier_results[${i}]`, reason: 'must be an object' });
        return;
      }
      const tr = res as Record<string, unknown>;
      if (!isTier(tr.tier)) errs.push({ path: `.tier_results[${i}].tier`, reason: 'must be T0..T6' });
      if (typeof tr.passed !== 'boolean') errs.push({ path: `.tier_results[${i}].passed`, reason: 'must be boolean' });
      if (typeof tr.exitCode !== 'number') errs.push({ path: `.tier_results[${i}].exitCode`, reason: 'must be number' });
    });
  }
  return errs;
}

export function validateHardenEvidence(v: unknown): ValidationError[] {
  const errs: ValidationError[] = [];
  if (typeof v !== 'object' || v === null) {
    return [{ path: '.', reason: 'harden_evidence must be an object' }];
  }
  const h = v as Record<string, unknown>;
  if (typeof h.ran !== 'boolean') errs.push({ path: '.ran', reason: 'must be boolean' });
  if (typeof h.allowed !== 'boolean') errs.push({ path: '.allowed', reason: 'must be boolean' });
  if (typeof h.scoreCap !== 'number') errs.push({ path: '.scoreCap', reason: 'must be number' });
  if (!Array.isArray(h.checks)) {
    errs.push({ path: '.checks', reason: 'must be an array' });
  } else {
    h.checks.forEach((c, i) => {
      if (typeof c !== 'object' || c === null) {
        errs.push({ path: `.checks[${i}]`, reason: 'must be an object' });
        return;
      }
      const cr = c as Record<string, unknown>;
      if (!isHardenCheckId(cr.check)) errs.push({ path: `.checks[${i}].check`, reason: 'unknown harden check id' });
      if (typeof cr.passed !== 'boolean') errs.push({ path: `.checks[${i}].passed`, reason: 'must be boolean' });
      if (typeof cr.scoreCap !== 'number') errs.push({ path: `.checks[${i}].scoreCap`, reason: 'must be number' });
    });
  }
  if (!Array.isArray(h.failedChecks)) {
    errs.push({ path: '.failedChecks', reason: 'must be an array' });
  } else {
    h.failedChecks.forEach((id, i) => {
      if (!isHardenCheckId(id)) errs.push({ path: `.failedChecks[${i}]`, reason: 'unknown harden check id' });
    });
  }
  return errs;
}

export function validateMergeReceipt(v: unknown): ValidationError[] {
  const errs: ValidationError[] = [];
  if (typeof v !== 'object' || v === null) {
    return [{ path: '.', reason: 'receipt must be an object' }];
  }
  const r = v as Record<string, unknown>;
  if (typeof r.receiptId !== 'string' || pathInvalid(r.receiptId)) errs.push({ path: '.receiptId', reason: 'required string' });
  if (typeof r.reconciledAt !== 'string') errs.push({ path: '.reconciledAt', reason: 'required ISO string' });
  if (r.gitSha !== null && typeof r.gitSha !== 'string') errs.push({ path: '.gitSha', reason: 'string or null' });
  if (typeof r.proposalsApplied !== 'number') errs.push({ path: '.proposalsApplied', reason: 'required number' });

  if (!Array.isArray(r.perDimension)) {
    errs.push({ path: '.perDimension', reason: 'must be an array' });
    return errs;
  }

  r.perDimension.forEach((d, i) => {
    if (typeof d !== 'object' || d === null) {
      errs.push({ path: `.perDimension[${i}]`, reason: 'must be an object' });
      return;
    }
    const pd = d as Record<string, unknown>;
    if (typeof pd.dimensionId !== 'string') errs.push({ path: `.perDimension[${i}].dimensionId`, reason: 'required string' });
    if (typeof pd.proposedScore !== 'number') errs.push({ path: `.perDimension[${i}].proposedScore`, reason: 'required number' });
    if (typeof pd.appliedScore !== 'number') errs.push({ path: `.perDimension[${i}].appliedScore`, reason: 'required number' });
    if (typeof pd.capApplied !== 'number') errs.push({ path: `.perDimension[${i}].capApplied`, reason: 'required number' });

    // runtime_evidence is MANDATORY on every dim.
    const reErrs = validateRuntimeEvidence(pd.runtime_evidence);
    for (const e of reErrs) errs.push({ path: `.perDimension[${i}].runtime_evidence${e.path}`, reason: e.reason });

    // harden_evidence is MANDATORY when appliedScore >= HARDEN_GATE_THRESHOLD (7.0).
    if (typeof pd.appliedScore === 'number' && pd.appliedScore >= 7.0) {
      const heErrs = validateHardenEvidence(pd.harden_evidence);
      for (const e of heErrs) errs.push({ path: `.perDimension[${i}].harden_evidence${e.path}`, reason: e.reason });
    } else if (pd.harden_evidence !== undefined) {
      // Below threshold: harden_evidence still must validate IF present (informational).
      const heErrs = validateHardenEvidence(pd.harden_evidence);
      for (const e of heErrs) errs.push({ path: `.perDimension[${i}].harden_evidence${e.path}`, reason: e.reason });
    }
  });

  return errs;
}

/** Convenience: true iff the receipt validates without errors. */
export function isValidMergeReceipt(v: unknown): v is MergeReceipt {
  return validateMergeReceipt(v).length === 0;
}
