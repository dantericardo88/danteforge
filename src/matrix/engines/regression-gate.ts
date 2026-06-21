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
 * CH-059: true when a SWE-bench instance has FAIL_TO_PASS target tests — i.e. there is a defined bug-fix to
 * verify. An instance with NONE is ill-posed for "did the solver fix the bug" (no target to check); solving it
 * wastes a solver call and dilutes the resolve rate with an un-evaluable 0 (the forensics: 8 of the n=20 had
 * empty FAIL_TO_PASS, dragging 2/8 well-posed = 25% down to 2/20 = 10%). Filtering these measures capability on
 * WELL-POSED instances. Reuses parsePassToPass (it parses any JSON-array / bracketed test-list string).
 */
export function hasTargetTests(failToPass: string | undefined): boolean {
  return parsePassToPass(failToPass).size > 0;
}

/** CH-064: the cheap LOCAL resolve verdict — the scoring the autonomy loop's self-improvement inner loop needs
 *  so it can run UNATTENDED on the primary machine (the council's design: mutate the solver → score by a cheap
 *  local proxy → keep/revert, with only PERIODIC Docker confirmation). It is the loop's missing "operator on the
 *  solver" made cheap. APPROXIMATE (the local CH-062 env != the grader's Docker env), so it is a RELATIVE signal
 *  for comparing solver variants on the same instances — never a substitute for the grader's authoritative receipt. */
export interface LocalResolveVerdict {
  /** Every FAIL_TO_PASS target test now passes locally (the bug is fixed in the local env). */
  targetFixed: boolean;
  targetTotal: number;
  /** Must-stay-green tests that newly fail locally (the patch regressed them) — excluding target tests. */
  regressions: string[];
  /** targetFixed AND no regressions — a LOCAL approximation of the grader's "resolved". */
  locallyResolved: boolean;
}

/**
 * Score a candidate patch LOCALLY from before/after test runs (CH-062 env). `targetTests` = FAIL_TO_PASS;
 * `baselineFailures`/`postFailures` = the failing-test sets pre/post patch; `mustStayGreen` = PASS_TO_PASS.
 * Pure. Reuses computeRegressions for the regression half. The inner self-improvement loop ranks solver variants
 * by `locallyResolved` (or, as a continuous signal, targetFixed minus regression count) — cheaply, no Docker.
 */
export function scoreLocalResolve(
  targetTests: Set<string>,
  baselineFailures: Set<string>,
  postFailures: Set<string>,
  mustStayGreen?: Set<string>,
): LocalResolveVerdict {
  const targetTotal = targetTests.size;
  const targetStillFailing = [...targetTests].filter(t => postFailures.has(t));
  const targetFixed = targetTotal > 0 && targetStillFailing.length === 0;
  const regressions = computeRegressions(baselineFailures, postFailures, mustStayGreen)
    .filter(t => !targetTests.has(t)); // a target test going fail→pass is the GOAL, never a regression
  return { targetFixed, targetTotal, regressions, locallyResolved: targetFixed && regressions.length === 0 };
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

/**
 * CH-050: extract pytest failure DETAIL (the assertion/error lines) for specific tests from a grader log.
 * The grade-in-loop's first validation showed the solver re-submitted a BYTE-IDENTICAL patch when handed only
 * test NAMES — because on an env-mismatch instance it cannot reproduce those failures locally, so a bare name
 * is undebuggable. The grader's post_patch_log.txt DOES carry the real assertion (e.g. "E AssertionError:
 * expected call not found"); feeding that back gives the solver something concrete to act on. pytest prints
 * each failure under a `____ Class.method ____` banner — capture that section's error lines per requested test.
 */
export function extractFailureDetail(logText: string, testIds: string[], capPerTest = 1200): string {
  if (!logText || testIds.length === 0) return '';
  // Split into [preamble, banner1, body1, banner2, body2, …] on pytest's underscore failure banners.
  const parts = logText.split(/\n_{4,}\s*(.+?)\s*_{4,}\n/);
  const out: string[] = [];
  for (const id of testIds) {
    const method = (id.split('::').pop() ?? id).trim();
    if (!method) continue;
    for (let i = 1; i + 1 < parts.length; i += 2) {
      if (!(parts[i] ?? '').includes(method)) continue;
      const body = (parts[i + 1] ?? '').trim();
      // Prefer pytest's "E   …" error lines (the assertion); fall back to the body tail if none present.
      const eLines = body.split('\n').filter(l => /^\s*E\s/.test(l)).join('\n').trim();
      const detail = (eLines || body.split('\n').slice(-12).join('\n')).slice(0, capPerTest);
      if (detail) out.push(`• ${id}\n${detail}`);
      break;
    }
  }
  return out.join('\n\n');
}

/** CH-050: regression feedback augmented with the grader's actual failure output, when available. The detail
 *  is essential on env-mismatch instances where the solver cannot reproduce the failures locally. */
export function formatRegressionFeedbackWithDetail(regressions: string[], detail: string, cap = 25): string {
  const base = formatRegressionFeedback(regressions, cap);
  if (!detail.trim()) return base;
  return `${base}\n\nThe GRADER's failure output for these tests (you CANNOT reproduce these locally — the ` +
    `grader's environment differs from yours — so read this carefully to understand what your patch changed):\n${detail}`;
}

/** CH-052: a whitespace-insensitive fingerprint of a patch — so a cosmetically-reformatted but structurally
 *  identical patch still reads as "the same approach". Empty patch → empty fingerprint (never counts as a match). */
export function patchFingerprint(patch: string): string {
  return (patch ?? '').replace(/\s+/g, ' ').trim();
}

/** CH-052: true when the current patch repeats a prior attempt's — the solver has ANCHORED (re-did the
 *  identical fix despite feedback; the observed cfn-lint-3798 failure: byte-identical patch + timeout). */
export function hasAnchored(currentPatch: string, priorPatches: string[]): boolean {
  const fp = patchFingerprint(currentPatch);
  if (!fp) return false;
  return priorPatches.some(p => patchFingerprint(p) === fp);
}

/** CH-052: de-anchoring feedback. The solver re-submitted an identical patch, so "narrow your edit" is stuck —
 *  force a STRUCTURALLY DIFFERENT approach and ban the wide-blast-radius shortcut (rewriting shared functions /
 *  message strings) that caused the regressions in the first place. */
export function deAnchorFeedback(regressions: string[], detail: string): string {
  const base = formatRegressionFeedbackWithDetail(regressions, detail);
  return `STOP — your last patch was BYTE-IDENTICAL to a previous attempt; repeating it fails the same way. You ` +
    `MUST take a STRUCTURALLY DIFFERENT approach now: do NOT re-apply the same edit, and do NOT make ` +
    `wide-blast-radius changes (rewriting shared/base functions or message strings many call-sites depend on). ` +
    `Find the NARROWEST edit that fixes the issue WITHOUT changing the behavior these tests rely on.\n\n${base}`;
}
