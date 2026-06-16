import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDatasetRows,
  toSolverInput,
  buildPredictionLine,
  parseSwebenchReport,
  formatPassRateLine,
  datasetRowsUrl,
} from '../src/matrix/engines/swe-bench-real.ts';

const ROWS = {
  rows: [
    { row: { instance_id: 'astropy__astropy-12907', repo: 'astropy/astropy', base_commit: 'd16bfe0', problem_statement: 'separability_matrix wrong for nested', hints_text: 'h', FAIL_TO_PASS: '["t1"]', PASS_TO_PASS: '["t2"]', version: '4.3' } },
    { row: { instance_id: 'bad', repo: 'x/y' } }, // missing base_commit + problem_statement → skipped
  ],
};

test('parseDatasetRows keeps complete real instances, skips incomplete rows', () => {
  const insts = parseDatasetRows(ROWS);
  assert.equal(insts.length, 1);
  assert.equal(insts[0]!.instance_id, 'astropy__astropy-12907');
  assert.equal(insts[0]!.repo, 'astropy/astropy');
  assert.equal(insts[0]!.FAIL_TO_PASS, '["t1"]');
});

test('parseDatasetRows is null-safe on garbage', () => {
  assert.deepEqual(parseDatasetRows(null), []);
  assert.deepEqual(parseDatasetRows({}), []);
  assert.deepEqual(parseDatasetRows({ rows: [{}] }), []);
});

test('toSolverInput WITHHOLDS the tests/gold patch (no answer leak)', () => {
  const si = toSolverInput(parseDatasetRows(ROWS)[0]!);
  assert.equal(si.problem_statement, 'separability_matrix wrong for nested');
  assert.equal((si as Record<string, unknown>)['FAIL_TO_PASS'], undefined); // solver must not see tests
  assert.equal((si as Record<string, unknown>)['PASS_TO_PASS'], undefined);
});

test('buildPredictionLine emits the official harness prediction shape', () => {
  const line = JSON.parse(buildPredictionLine('astropy__astropy-12907', 'danteforge-pipeline', 'diff --git a b'));
  assert.equal(line.instance_id, 'astropy__astropy-12907');
  assert.equal(line.model_name_or_path, 'danteforge-pipeline');
  assert.equal(line.model_patch, 'diff --git a b');
});

test('parseSwebenchReport reads resolved/total across field-name variants', () => {
  const a = parseSwebenchReport({ total_instances: 5, resolved_instances: 2, resolved_ids: ['i1', 'i2'] });
  assert.equal(a.total, 5); assert.equal(a.resolved, 2); assert.equal(a.pass_rate, 0.4);
  // falls back to resolved_ids length + alt field names
  const b = parseSwebenchReport({ submitted_instances: 4, resolved_ids: ['i1'] });
  assert.equal(b.resolved, 1); assert.equal(b.total, 4); assert.equal(b.pass_rate, 0.25);
  const c = parseSwebenchReport({});
  assert.equal(c.total, 0); assert.equal(c.pass_rate, 0);
});

test('formatPassRateLine is parsePassRate-compatible (JSON pass_rate shape)', () => {
  const line = formatPassRateLine({ pass_rate: 1 / 3, resolved: 1, total: 3 });
  const o = JSON.parse(line);
  assert.equal(o.resolved, 1); assert.equal(o.total, 3);
  assert.ok(/^0\.333/.test(String(o.pass_rate)));
});

test('datasetRowsUrl targets the REAL published SWE-bench-lite dataset', () => {
  const u = datasetRowsUrl(0, 5);
  assert.match(u, /princeton-nlp%2FSWE-bench_Lite/);
  assert.match(u, /offset=0&length=5/);
  assert.match(u, /split=test/);
});
