import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeInstanceResult, summarizeResults, type SwebenchReport } from '../src/matrix/engines/swebench-failure-analysis.ts';

const rep = (o: Partial<SwebenchReport> & { f?: [number, number]; p?: [number, number] }): SwebenchReport => ({
  instance_id: o.instance_id ?? 'x',
  resolved: o.resolved ?? false,
  FAIL_TO_PASS: { success: Array(o.f?.[0] ?? 0).fill('t'), failure: Array(o.f?.[1] ?? 0).fill('t') },
  PASS_TO_PASS: { success: Array(o.p?.[0] ?? 0).fill('t'), failure: Array(o.p?.[1] ?? 0).fill('t') },
});

test('resolved report → resolved', () => {
  assert.equal(categorizeInstanceResult(rep({ resolved: true, f: [26, 0], p: [1220, 0] })).category, 'resolved');
});

test('the cfn-lint-3798 shape (26/26 target fixed, 4 regressions) → fixed-but-regressed', () => {
  const a = categorizeInstanceResult(rep({ f: [26, 0], p: [1216, 4] }));
  assert.equal(a.category, 'fixed-but-regressed');
  assert.equal(a.targetFixed, 26);
  assert.equal(a.targetTotal, 26);
  assert.equal(a.regressions, 4);
});

test('some target tests still failing → partial-fix', () => {
  assert.equal(categorizeInstanceResult(rep({ f: [1, 2], p: [100, 0] })).category, 'partial-fix');
});

test('no target test passes → no-fix', () => {
  assert.equal(categorizeInstanceResult(rep({ f: [0, 3], p: [100, 0] })).category, 'no-fix');
});

test('the pvlib shape (0/0 target tests) → no-target-tests', () => {
  assert.equal(categorizeInstanceResult(rep({ f: [0, 0], p: [1211, 2] })).category, 'no-target-tests');
});

test('summarizeResults computes pass rate + the regression share of unresolved (the climb signal)', () => {
  // the real n=5 Live shape: 0 resolved, all 4-with-targets fixed-but-regressed, 1 no-target-tests
  const reports = [
    rep({ f: [26, 0], p: [1216, 4] }),  // cfn-3798 fixed-but-regressed
    rep({ f: [1, 0], p: [1241, 4] }),   // cfn-3856 fixed-but-regressed
    rep({ f: [1, 0], p: [6199, 11] }),  // xarray fixed-but-regressed
    rep({ f: [1, 0], p: [1900, 5] }),   // pylint fixed-but-regressed
    rep({ f: [0, 0], p: [1211, 2] }),   // pvlib no-target-tests
  ];
  const s = summarizeResults(reports);
  assert.equal(s.total, 5);
  assert.equal(s.resolved, 0);
  assert.equal(s.passRate, 0);
  assert.equal(s.byCategory['fixed-but-regressed'], 4);
  assert.equal(s.byCategory['no-target-tests'], 1);
  // 4 of 5 unresolved are the tractable fixed-but-regressed mode → the climb is regression-discipline
  assert.equal(s.regressionShareOfUnresolved, 0.8);
});
