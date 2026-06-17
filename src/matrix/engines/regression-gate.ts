// regression-gate.ts — pure logic for the SWE-bench solver's structural regression gate (CH-039/040/041).
//
// The gate runs the repo's own public test suite BEFORE and AFTER a candidate patch. Tests that fail after
// but NOT before are regressions the patch caused. The target (FAIL_TO_PASS) tests go fail->pass, never
// pass->fail, so they are never counted as regressions — the feedback can name only existing tests the
// patch broke, which is NOT an answer leak (a real engineer runs the suite and sees the same). These
// functions decide WHAT gets fed back to the solver each iteration; a bug here silently corrupts the climb,
// so they are extracted here and unit-tested rather than living inline in scripts/run-swebench-grounding.mjs.

/** True if a repo-relative path is a TEST file. The solver's prediction must be SOURCE-only: SWE-bench's
 *  grader resets test files (the gold test patch is authoritative), so any solver edit to a test is ignored
 *  by the grader — but a NAIVE local gate that re-runs the *patched* tests would be GAMED into "no
 *  regressions" by a solver that edits tests to silence them (observed: v3 attempt 2 edited 15 test files,
 *  the local gate accepted, the grader correctly failed it 0/1). Reverting test edits before grading makes
 *  predictions honest (source-only) and the gate faithful (runs the original tests). */
export function isTestFile(path: string): boolean {
  return /(^|\/)tests?\//.test(path)            // a tests/ or test/ directory
    || /(^|\/)test_[^/]*\.[a-z]+$/.test(path)   // test_foo.py
    || /_test\.[a-z]+$/.test(path)              // foo_test.go / foo_test.py
    || /\.(test|spec)\.[a-z]+$/.test(path)      // foo.test.ts / foo.spec.js
    || /(^|\/)conftest\.py$/.test(path);        // pytest conftest
}

/** Parse the set of FAILED/ERROR test ids from pytest output. `--tb=no -q` prints lines like
 *  `FAILED path::Test::id - AssertionError` and `ERROR path::id`. Returns bare test ids. */
export function parsePytestFailures(output: string): Set<string> {
  const ids = new Set<string>();
  for (const raw of (output ?? '').split('\n')) {
    const m = /^(?:FAILED|ERROR)\s+(\S+)/.exec(raw.trim());
    if (m) ids.add(m[1]!.replace(/\s*-\s.*$/, '')); // defensive: strip a trailing " - reason" if present
  }
  return ids;
}

/** Regressions = tests failing AFTER the patch that were NOT failing before it. Order-preserving on `post`. */
export function computeRegressions(baselineFailures: Set<string>, postFailures: Set<string>): string[] {
  return [...postFailures].filter(t => !baselineFailures.has(t));
}

/** Build the solver feedback that names the regressions (capped) and asks it to judge real-vs-expected —
 *  so it fixes true regressions without un-fixing the bug, and isn't drowned by tests the fix legitimately
 *  changes (the CH-041 over-counting noise). */
export function formatRegressionFeedback(regressions: string[], cap = 25): string {
  const list = regressions.slice(0, cap).map(t => `  - ${t}`).join('\n');
  return (
    `Your patch fixed the issue but BROKE these previously-passing tests (they MUST stay green — keeping them ` +
    `passing is REQUIRED):\n${list}\nFor EACH: run it, decide whether your change SHOULD have affected it. If it ` +
    `is a real regression, narrow your edit so the test passes again WITHOUT un-fixing the issue. Do NOT modify ` +
    `the test files. Keep the original bug fixed.`
  );
}
