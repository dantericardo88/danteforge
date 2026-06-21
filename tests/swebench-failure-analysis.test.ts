import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeInstanceResult, summarizeResults, wilsonInterval, regressionsFromGradeReport, type SwebenchReport } from '../src/matrix/engines/swebench-failure-analysis.ts';

test('wilsonInterval reports the honest small-n uncertainty band (2/14 spans a wide range)', () => {
  const ci = wilsonInterval(2, 14);
  assert.ok(ci.low < 0.143 && ci.high > 0.143, 'the point estimate 14.3% sits inside the band');
  assert.ok(ci.low < 0.05 && ci.high > 0.35, `2/14 is consistent with ~4%..~40% — wide (got ${(ci.low*100).toFixed(0)}-${(ci.high*100).toFixed(0)}%)`);
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 0 });
});

test('a small-n delta is exposed as noise: 2/6 and 1/6 CIs overlap heavily', () => {
  const a = wilsonInterval(2, 6), b = wilsonInterval(1, 6);
  assert.ok(a.low < b.high, '"+100% lift" on n=6 has overlapping CIs — not a real difference');
});

const rep = (o: Partial<SwebenchReport> & { f?: [number, number]; p?: [number, number] }): SwebenchReport => ({
  instance_id: o.instance_id ?? 'x',
  resolved: o.resolved ?? false,
  FAIL_TO_PASS: { success: Array(o.f?.[0] ?? 0).fill('t'), failure: Array(o.f?.[1] ?? 0).fill('t') },
  PASS_TO_PASS: { success: Array(o.p?.[0] ?? 0).fill('t'), failure: Array(o.p?.[1] ?? 0).fill('t') },
});

test('resolved report → resolved', () => {
  assert.equal(categorizeInstanceResult(rep({ resolved: true, f: [26, 0], p: [1220, 0] })).category, 'resolved');
});

test('CH-047: regressionsFromGradeReport returns the grader PASS_TO_PASS failures for a fixed-but-regressed instance', () => {
  const report: SwebenchReport = {
    instance_id: 'aws-cloudformation__cfn-lint-3798', resolved: false,
    FAIL_TO_PASS: { success: Array(26).fill('t'), failure: [] }, // target fully fixed
    PASS_TO_PASS: { success: Array(1216).fill('t'), failure: ['test_a::x', 'test_b::y', 'test_c::z', 'test_d::w'] },
  };
  const out = regressionsFromGradeReport(report);
  assert.ok(out, 'a fixed-but-regressed report yields actionable feedback');
  assert.deepEqual(out!.regressions, ['test_a::x', 'test_b::y', 'test_c::z', 'test_d::w']);
  assert.equal(out!.targetFixed, 26);
});

test('CH-047: regressionsFromGradeReport returns null when regressions are NOT the blocker', () => {
  // resolved → nothing to feed back
  assert.equal(regressionsFromGradeReport(rep({ resolved: true, f: [26, 0], p: [1220, 0] })), null);
  // partial-fix (target not fully fixed) → the FIX is the blocker, not regressions
  assert.equal(regressionsFromGradeReport(rep({ f: [1, 1], p: [10, 2] })), null);
  // no-fix → the fix is the blocker
  assert.equal(regressionsFromGradeReport(rep({ f: [0, 3], p: [10, 0] })), null);
  // fixed but zero regressions recorded → nothing actionable
  assert.equal(regressionsFromGradeReport(rep({ f: [2, 0], p: [10, 0] })), null);
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
