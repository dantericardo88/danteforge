import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePytestFailures, computeRegressions, formatRegressionFeedback, isTestFile, parsePassToPass } from '../src/matrix/engines/regression-gate.ts';

test('parsePassToPass parses a JSON array string and a bracketed/space list', () => {
  assert.deepEqual([...parsePassToPass('["a::t1", "b::t2"]')].sort(), ['a::t1', 'b::t2']);
  assert.deepEqual([...parsePassToPass("['a::t1', 'b::t2']")].sort(), ['a::t1', 'b::t2']);
  assert.equal(parsePassToPass('').size, 0);
  assert.equal(parsePassToPass(undefined).size, 0);
});

test('computeRegressions with PASS_TO_PASS matches the grader (CH-041): 26 newly-failing → only the 4 real', () => {
  const baseline = new Set(['target']);
  // 4 real PASS_TO_PASS regressions + 22 message tests the fix legitimately changes
  const post = new Set(['p2p_1', 'p2p_2', 'p2p_3', 'p2p_4', ...Array.from({ length: 22 }, (_, i) => `msg_${i}`)]);
  const mustStayGreen = new Set(['p2p_1', 'p2p_2', 'p2p_3', 'p2p_4', 'unrelated_passing']);
  const r = computeRegressions(baseline, post, mustStayGreen);
  assert.deepEqual(r.sort(), ['p2p_1', 'p2p_2', 'p2p_3', 'p2p_4']);
});

test('computeRegressions SAFETY: id-format mismatch (no overlap) falls back to the conservative full set', () => {
  const baseline = new Set();
  const post = new Set(['repo/test_x.py::a', 'repo/test_y.py::b']);
  const mustStayGreen = new Set(['x.py::a', 'y.py::b']); // different format → no overlap
  // must NOT silently return [] (false-accept) — fall back to all newly-failing
  assert.deepEqual(computeRegressions(baseline, post, mustStayGreen).sort(), ['repo/test_x.py::a', 'repo/test_y.py::b']);
});

test('isTestFile flags test files (so the gate can strip test edits — solver may not game by editing tests)', () => {
  // real paths the solver edited to game the v3 gate
  assert.ok(isTestFile('test/unit/module/jsonschema/test_validator.py'));
  assert.ok(isTestFile('test/integration/jsonschema/test_validator_cfn.py'));
  assert.ok(isTestFile('tests/test_backends.py'));
  assert.ok(isTestFile('pkg/foo_test.go'));
  assert.ok(isTestFile('src/components/Button.test.tsx'));
  assert.ok(isTestFile('conftest.py'));
  // SOURCE files must NOT be flagged (the real fix lives here)
  assert.ok(!isTestFile('src/cfnlint/jsonschema/_keywords.py'));
  assert.ok(!isTestFile('src/cfnlint/rules/functions/_BaseFn.py'));
  assert.ok(!isTestFile('lib/latest.py'));
});

test('parsePytestFailures extracts FAILED and ERROR ids, ignores other lines', () => {
  const out = [
    '......F..',
    'FAILED test/unit/test_a.py::TestA::test_x - AssertionError: nope',
    'ERROR test/integration/test_b.py::test_y',
    'PASSED test/test_c.py::test_z',
    '5 failed, 1200 passed in 42.1s',
  ].join('\n');
  const f = parsePytestFailures(out);
  assert.deepEqual([...f].sort(), [
    'test/integration/test_b.py::test_y',
    'test/unit/test_a.py::TestA::test_x',
  ]);
});

test('parsePytestFailures keeps parametrized ids intact and handles empty input', () => {
  const f = parsePytestFailures('FAILED test/m.py::test_messages[minItems-schema56-instance56-expected56]');
  assert.ok(f.has('test/m.py::test_messages[minItems-schema56-instance56-expected56]'));
  assert.equal(parsePytestFailures('').size, 0);
  assert.equal(parsePytestFailures(undefined as unknown as string).size, 0);
});

test('computeRegressions = post-patch failures that were NOT failing pre-patch (target tests excluded)', () => {
  // baseline failures include the TARGET test (fails before the fix) + a pre-existing flaky test.
  const baseline = new Set(['repo::target_test', 'repo::preexisting_flaky']);
  // post-patch: target now passes (gone), flaky still fails, and TWO existing tests newly broke.
  const post = new Set(['repo::preexisting_flaky', 'repo::regressed_one', 'repo::regressed_two']);
  const regressions = computeRegressions(baseline, post);
  assert.deepEqual(regressions.sort(), ['repo::regressed_one', 'repo::regressed_two']);
  // the target test (fail->pass) is never a regression — no answer leak
  assert.ok(!regressions.includes('repo::target_test'));
  // a pre-existing failure that persists is not a NEW regression
  assert.ok(!regressions.includes('repo::preexisting_flaky'));
});

test('computeRegressions is empty when the patch breaks nothing new (clean accept)', () => {
  const baseline = new Set(['repo::target_test']);
  const post = new Set<string>(); // everything green after the fix
  assert.deepEqual(computeRegressions(baseline, post), []);
});

test('formatRegressionFeedback names the regressions, caps the list, and asks the solver to judge', () => {
  const many = Array.from({ length: 30 }, (_, i) => `repo::t${i}`);
  const fb = formatRegressionFeedback(many, 25);
  assert.match(fb, /BROKE these previously-passing tests/);
  assert.match(fb, /repo::t0/);
  assert.ok(!fb.includes('repo::t25'), 'capped at 25 — the 26th is not listed');
  assert.match(fb, /WITHOUT un-fixing the issue/);
  assert.match(fb, /Do NOT modify the test files/);
});
