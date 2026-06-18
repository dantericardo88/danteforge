// external-suite-registry.ts — the allowlist of independently-reproducible
// benchmark suites that may unlock the 9.5 (T8) tier.
//
// Why a registry and not a regex: the old gate awarded 9.5 to any command matching
// /swe[-\s]?bench|benchmark.*--suite/i, so an agent could write
//   node -e "console.log('benchmark --suite pass')"
// and claim frontier evidence. A suite name checked against this Set is structural —
// it can only be satisfied by declaring one of the recognized suites, and (for the
// external-benchmark kind) by a real report receipt the runner produces.

import type { RegisteredExternalSuite } from '../types/outcome.js';

export const REGISTERED_EXTERNAL_SUITES: ReadonlySet<RegisteredExternalSuite> = new Set<RegisteredExternalSuite>([
  'swe-bench',
  'swe-bench-lite',
  'swe-bench-verified',
  'swe-bench-live', // contamination-resistant (post-2024, leak-detected); graded via scripts/swebench-orch/Dockerfile.live
  'exercism',
  'humaneval',
  'mbpp',
]);

/** The CONTAMINATION-RESISTANT subset: post-cutoff, leak-detected suites a model could not have trained on.
 *  The others (humaneval, swe-bench-lite/verified, mbpp, exercism) are pre-cutoff — a PASS on them is
 *  "chain-proof" (the pipeline runs) but is inflated by memorization, NOT honest frontier capability. The
 *  grounding report distinguishes these so a flattering chain-proof receipt cannot read as real grounding
 *  (CH-044). Today only SWE-bench-Live qualifies; add suites here only when genuinely contamination-resistant. */
export const CONTAMINATION_RESISTANT_SUITES: ReadonlySet<RegisteredExternalSuite> = new Set<RegisteredExternalSuite>([
  'swe-bench-live',
]);

/** Type guard: true only for a recognized, independently-reproducible suite. */
export function isRegisteredExternalSuite(value: unknown): value is RegisteredExternalSuite {
  return typeof value === 'string'
    && REGISTERED_EXTERNAL_SUITES.has(value.toLowerCase() as RegisteredExternalSuite);
}

/** True only for a contamination-resistant suite — the honest-frontier subset (not a memorization-inflated
 *  chain-proof benchmark like HumanEval). */
export function isContaminationResistantSuite(value: unknown): boolean {
  return typeof value === 'string'
    && CONTAMINATION_RESISTANT_SUITES.has(value.toLowerCase() as RegisteredExternalSuite);
}
