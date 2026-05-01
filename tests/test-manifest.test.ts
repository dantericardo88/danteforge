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
    assert.equal(classifyTestFile('tests/canonical-score-determinism.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests/config-cli.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests/doctor.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests/init.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests/verify-json-e2e.test.ts'), 'cli-process');
    assert.equal(classifyTestFile('tests\\verify-json-e2e.test.ts'), 'cli-process');
  });

  it('routes orchestration-heavy suites into the heavy lane', () => {
    assert.equal(classifyTestFile('tests/ascend.test.ts'), 'orchestration-heavy');
    assert.equal(classifyTestFile('tests/autoforge.test.ts'), 'orchestration-heavy');
    assert.equal(classifyTestFile('tests\\autoforge.test.ts'), 'orchestration-heavy');
  });

  it('isolates PRD-scale Time Machine validation in its own lane', () => {
    assert.equal(classifyTestFile('tests/time-machine-validation-prd-real.test.ts'), 'time-machine-prd-real');
  });

  it('isolates e2e orchestration pipeline suites in a single-process lane', () => {
    assert.equal(classifyTestFile('tests/e2e-autoforge-pipeline.test.ts'), 'orchestration-e2e');
    assert.equal(classifyTestFile('tests/e2e-spec-pipeline.test.ts'), 'orchestration-e2e');
    assert.equal(classifyTestFile('tests\\e2e-autoforge-pipeline.test.ts'), 'orchestration-e2e');
  });

  it('keeps ordinary and non-fragile suites in the default lane', () => {
    assert.equal(classifyTestFile('tests/build-isolation.test.ts'), 'default');
    assert.equal(classifyTestFile('tests\\showcase.test.ts'), 'default');
  });

  it('builds a deterministic multi-lane plan with bounded default concurrency', () => {
    const plan = buildTestPlan([
      'tests/verify-json-e2e.test.ts',
      'tests/doctor.test.ts',
      'tests/autoforge.test.ts',
      'tests/time-machine-validation-prd-real.test.ts',
      'tests/e2e-autoforge-pipeline.test.ts',
      'tests/build-isolation.test.ts',
      'tests/init.test.ts',
      'tests/canonical-score-determinism.test.ts',
    ]);

    assert.deepEqual(plan.map((lane) => lane.id), ['default', 'orchestration-heavy', 'time-machine-prd-real', 'orchestration-e2e', 'cli-process']);
    assert.equal(plan[0]?.files[0], 'tests/build-isolation.test.ts');
    assert.deepEqual(plan[1]?.files, ['tests/autoforge.test.ts']);
    assert.deepEqual(plan[2]?.files, ['tests/time-machine-validation-prd-real.test.ts']);
    assert.equal(plan[3]?.files[0], 'tests/e2e-autoforge-pipeline.test.ts');
    assert.deepEqual(plan[4]?.files, [
      'tests/canonical-score-determinism.test.ts',
      'tests/doctor.test.ts',
      'tests/init.test.ts',
      'tests/verify-json-e2e.test.ts',
    ]);
    assert.ok(getDefaultTestConcurrency() >= 1);
    assert.ok(getDefaultTestConcurrency() <= 8);
  });
});
