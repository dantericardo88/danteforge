import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adversarialTestCases,
  runAdversarialTests,
  type AdversarialTestCase,
} from '../src/core/adversarial-testing.js';

describe('adversarialTestCases', () => {
  it('exports at least 4 test cases', () => {
    assert.ok(adversarialTestCases.length >= 4);
  });

  it('every case has a name and description', () => {
    for (const tc of adversarialTestCases) {
      assert.ok(typeof tc.name === 'string' && tc.name.length > 0, `case ${tc.name} missing name`);
      assert.ok(typeof tc.description === 'string' && tc.description.length > 0, `case ${tc.name} missing description`);
    }
  });

  it('every case has a bundle object', () => {
    for (const tc of adversarialTestCases) {
      assert.ok(typeof tc.bundle === 'object' && tc.bundle !== null, `case ${tc.name} missing bundle`);
    }
  });

  it('every case has an expectedVerdict string', () => {
    for (const tc of adversarialTestCases) {
      assert.ok(typeof tc.expectedVerdict === 'string', `case ${tc.name} missing expectedVerdict`);
    }
  });

  it('every case has a shouldDetectFalseCompletion boolean', () => {
    for (const tc of adversarialTestCases) {
      assert.ok(typeof tc.shouldDetectFalseCompletion === 'boolean', `case ${tc.name} missing shouldDetectFalseCompletion`);
    }
  });

  it('includes a genuine-completion case that should NOT detect false completion', () => {
    const genuine = adversarialTestCases.find(tc => !tc.shouldDetectFalseCompletion);
    assert.ok(genuine !== undefined, 'should have at least one genuine-completion case');
  });

  it('includes cases that should detect false completion', () => {
    const falseCompletion = adversarialTestCases.filter(tc => tc.shouldDetectFalseCompletion);
    assert.ok(falseCompletion.length >= 1);
  });
});

describe('runAdversarialTests', () => {
  const minimalState = {
    project: 'test-project',
    currentPhase: 1,
    workflowStage: 'forge',
    tasks: {},
    auditLog: [],
    profile: '',
    lastHandoff: '',
  };

  it('returns results array with same length as test cases', async () => {
    const { results } = await runAdversarialTests(minimalState);
    assert.equal(results.length, adversarialTestCases.length);
  });

  it('each result has test, result, and passed fields', async () => {
    const { results } = await runAdversarialTests(minimalState);
    for (const r of results) {
      assert.ok('test' in r);
      assert.ok('result' in r);
      assert.ok('passed' in r);
    }
  });

  it('summary has total, passed, detectionRate fields', async () => {
    const { summary } = await runAdversarialTests(minimalState);
    assert.ok(typeof summary.total === 'number');
    assert.ok(typeof summary.passed === 'number');
    assert.ok(typeof summary.detectionRate === 'number');
  });

  it('summary.total equals number of test cases', async () => {
    const { summary } = await runAdversarialTests(minimalState);
    assert.equal(summary.total, adversarialTestCases.length);
  });

  it('detectionRate is 0-100', async () => {
    const { summary } = await runAdversarialTests(minimalState);
    assert.ok(summary.detectionRate >= 0 && summary.detectionRate <= 100);
  });

  it('passed count does not exceed total', async () => {
    const { summary } = await runAdversarialTests(minimalState);
    assert.ok(summary.passed <= summary.total);
  });
});
