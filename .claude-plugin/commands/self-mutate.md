---
name: danteforge-self-mutate
description: "Run mutation testing on DanteForge's own core files — validates that tests actually catch bugs, not just pass"
---

# /self-mutate — Mutation Test Quality Gate

When the user invokes `/self-mutate`, run mutation testing on the 6 most critical core files
to verify that the test suite would catch real bugs.

1. **Target files**: Tests these 6 core files against their paired test files:
   - `src/core/circuit-breaker.ts` → `tests/circuit-breaker.test.ts`
   - `src/core/plateau-detector.ts` → `tests/plateau-detector.test.ts`
   - `src/core/objective-metrics.ts` → `tests/objective-metrics.test.ts`
   - `src/core/bundle-trust.ts` → `tests/bundle-trust.test.ts`
   - `src/core/adversarial-scorer.ts` → `tests/adversarial-scorer.test.ts`
   - `src/core/causal-attribution.ts` → `tests/causal-attribution.test.ts`
2. **Per-file mutation**: Applies 5 operators (condition-flip, boolean-literal, return-null, boundary-shift, arithmetic-flip)
3. **Targeted test run**: Runs only the paired test file per mutation (~200ms each, not the full suite)
4. **Report**: Shows per-file kill rate and overall mutation score
5. **Gate**: Fails if overall score < 0.6 (tests are not catching enough bugs)

## When to use this
- After writing new tests, to verify they actually test the logic
- Before claiming a feature is "complete with tests"
- When the test count is high but you suspect test theater (assertions that always pass)

## Output
- Per-file mutation score (killed/total)
- Overall mutation score
- Gate: PASS (≥60%) or FAIL (<60%)
- Report saved to `.danteforge/mutation-report.json`

CLI parity: `danteforge self-mutate [--min-score 0.6] [--max-mutants 10]`
