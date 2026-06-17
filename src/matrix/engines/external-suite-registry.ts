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

/** Type guard: true only for a recognized, independently-reproducible suite. */
export function isRegisteredExternalSuite(value: unknown): value is RegisteredExternalSuite {
  return typeof value === 'string'
    && REGISTERED_EXTERNAL_SUITES.has(value.toLowerCase() as RegisteredExternalSuite);
}
