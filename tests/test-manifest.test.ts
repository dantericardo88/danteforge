import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTestPlan,
  classifyTestFile,
  getDefaultTestConcurrency,
} from '../scripts/test-manifest.mjs';

describe('test manifest', () => {
  it('isolates saturated CLI spawn suites in the process lane', () => {
    assert.equal(classifyTestFile('tests/cli-flags.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests/cli-release-readiness.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests/config-cli.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests/doctor.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests/verify-json-e2e.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests\\verify-json-e2e.test.ts'), 'cli-process');
  });

  it('routes orchestration-heavy suites into the heavy lane', () => {
    assert.equal(classifyTestFile('tests/ascend.test.ts'), 'orchestration-heavy');
    assert.equal(classifyTestFile('tests/autoforge.test.ts'), 'orchestration-heavy');
    assert.equal(classifyTestFile('tests\\autoforge.test.ts'), 'orchestration-heavy');
  });

  it('keeps ordinary and non-fragile suites in the default lane', () => {
    assert.equal(classifyTestFile('tests/build-isolation.test.ts'), 'default');
    assert.equal(classifyTestFile('tests/init.test.ts'), 'default');
    assert.equal(classifyTestFile('tests\\showcase.test.ts'), 'default');
  });

  it('builds a deterministic multi-lane plan with bounded default concurrency', () => {
    const plan = buildTestPlan([
      'tests/verify-json-e2e.test.ts',
      'tests/doctor.test.ts',
      'tests/autoforge.test.ts',
      'tests/build-isolation.test.ts',
    ]);

    assert.deepEqual(plan.map((lane) => lane.id), ['default', 'orchestration-heavy', 'cli-process']);
    assert.equal(plan[0]?.files[0], 'tests/build-isolation.test.ts');
    assert.equal(plan[1]?.files[0], 'tests/autoforge.test.ts');
    assert.deepEqual(plan[2]?.files, ['tests/doctor.test.ts', 'tests/verify-json-e2e.test.ts']);
    assert.ok(getDefaultTestConcurrency() >= 1);
    assert.ok(getDefaultTestConcurrency() <= 8);
  });
});
