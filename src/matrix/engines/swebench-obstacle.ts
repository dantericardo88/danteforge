// swebench-obstacle.ts — the grader-env-mismatch obstacle + its decomposition (the council's ranked
// sub-problems, 2026-06-21). When the SWE-bench solver self-disables its regression gate on an env-mismatch
// instance and ships unresolved, the loop calls solveOrDecompose with these so a hard instance becomes a
// tracked worklist (CH-051..054) — never a silent "unresolved". The children are the real next-work, ordered
// by leverage: an executable env-matched oracle first, everything else downstream of it.

import type { Obstacle } from '../../core/obstacle-registry.js';
import type { ChildObstacle } from '../../core/obstacle-decomposition.js';

/** The obstacle: the solver optimizes a proxy because it cannot see the grader's verdict locally. */
export function graderEnvMismatchObstacle(instanceId: string, regressions: string[] = []): Obstacle {
  return {
    kind: 'grader-env-mismatch',
    signal: 'The SWE-bench solver edits BLIND to the grader oracle: PASS_TO_PASS tests fail in the local pip env so '
      + 'the regression gate self-disables; the solver optimizes a proxy and ships regressions, unresolved even with '
      + 'detail feedback',
    context: { instanceId, regressions },
  };
}

/** The council's ranked decomposition — each a DEFINED, smaller problem. Stable text so the ledger dedups. */
export function graderEnvMismatchChildren(): ChildObstacle[] {
  return [
    {
      kind: 'test-in-grader-image',
      signal: 'Generalize gradeOneInstance into runTestsInGraderImage(instance,testIds,patch): run the failing '
        + 'PASS_TO_PASS inside the grader image and route computeRegressions through it INSTEAD of self-disabling on env-mismatch',
      rationale: 'HIGHEST leverage (council-unanimous): gives the solver an executable env-matched oracle, upstream of '
        + 'every other fix; turns fly-blind into fly-with-instruments',
    },
    {
      kind: 'fresh-attempt-ban-prior-approach',
      signal: 'On a byte-identical patch across attempts, fingerprint+ban the prior approach and restart from a clean '
        + 'checkout carrying explicit constraints (do NOT rewrite shared message strings with wide blast radius)',
      rationale: 'De-anchors the solver from its first approach; second priority once the oracle is real',
    },
    {
      kind: 'expected-behavior-feedback',
      signal: 'Feed the EXPECTED behavior of the broken tests (valid input still passes; clean input trips no new rule), '
        + 'not only the failure assertion',
      rationale: 'Expected behavior is encoded in tests the solver cannot run; a cheaper partial, subsumed by test-in-grader-image',
    },
    {
      kind: 'solve-budget-after-oracle',
      signal: 'A solve timeout that cuts a genuine revision short (exit null) needs a longer/again budget AFTER the '
        + 'oracle is real so the revision is not killed mid-flight',
      rationale: 'Lowest leverage (council): more time on a blind trajectory only extends the stuck path',
    },
  ];
}
