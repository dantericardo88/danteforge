import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';

describe('Adversarial Tests', () => {
  it('should detect false completion claims', async () => {
    const { runAdversarialTests } = await import('../src/core/adversarial-testing.js');

    const results = await runAdversarialTests({});

    assert(results.summary.total > 0, 'Should run adversarial tests');
    assert(results.summary.passed >= 0, 'Should track passed tests');

    // Check that false completion is detected
    const falseCompletionTest = results.results.find(r => r.test.name === 'false-completion');
    assert(falseCompletionTest, 'Should have false completion test');
    // The test should detect that missing tests indicate false completion
    assert(!falseCompletionTest.result.isComplete, 'Should detect false completion');
  });

  it('should validate genuine completion', async () => {
    const { runAdversarialTests } = await import('../src/core/adversarial-testing.js');

    const results = await runAdversarialTests({});

    const genuineCompletionTest = results.results.find(r => r.test.name === 'genuine-completion');
    assert(genuineCompletionTest, 'Should have genuine completion test');
    assert(genuineCompletionTest.result.isComplete, 'Should validate genuine completion');
  });

  it('should detect missing evidence', async () => {
    const { runAdversarialTests } = await import('../src/core/adversarial-testing.js');

    const results = await runAdversarialTests({});

    const noEvidenceTest = results.results.find(r => r.test.name === 'no-evidence-whatsoever');
    assert(noEvidenceTest, 'Should have no evidence test');
    assert(!noEvidenceTest.result.isComplete, 'Should detect missing evidence');
  });
});