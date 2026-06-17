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

/** Parse the dataset's PASS_TO_PASS field (the grader's must-stay-green test list) into a Set of ids.
 *  SWE-bench stores it as a JSON array string (sometimes a Python-list string); fall back to splitting. This
 *  is harness-side ONLY — it is never given to the solver (toSolverInput passes only the problem statement),
 *  so it is not an answer leak; it tells the gate WHICH existing tests the grader actually scores. */
export function parsePassToPass(field: string | undefined): Set<string> {
  if (!field || !field.trim()) return new Set();
  try {
    const arr = JSON.parse(field);
    if (Array.isArray(arr)) return new Set(arr.map(String));
  } catch { /* not JSON — fall through */ }
  return new Set(field.replace(/^[[]|[\]]$/g, '').split(/[\s,]+/).map(s => s.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean));
}

/**
 * Regressions = tests failing AFTER the patch that were NOT failing before it. When `mustStayGreen` (the
 * dataset PASS_TO_PASS set) is supplied, intersect with it so the gate matches the GRADER's verdict instead
 * of over-counting tests the correct fix legitimately changes (CH-041: full-suite flagged 26 where the
 * grader scored 4). SAFETY: if no post-failure matches any must-stay-green id (an id-format mismatch would
 * silently zero out real regressions → a dangerous false-accept), fall back to the conservative full set.
 */
export function computeRegressions(
  baselineFailures: Set<string>,
  postFailures: Set<string>,
  mustStayGreen?: Set<string>,
): string[] {
  const newlyFailing = [...postFailures].filter(t => !baselineFailures.has(t));
  if (mustStayGreen && mustStayGreen.size > 0) {
    const anyMatch = [...postFailures].some(t => mustStayGreen.has(t));
    if (anyMatch) return newlyFailing.filter(t => mustStayGreen.has(t)); // faithful to the grader
    // else: id formats don't line up — do NOT trust the intersection; stay conservative (over-count, never under)
  }
  return newlyFailing;
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
