import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateCompletion, type CompletionVerdict } from '../src/core/completion-oracle.js';
import {
  adversarialTestCases,
  runAdversarialTests,
} from '../src/core/adversarial-testing.js';
import type { EvidenceBundle } from '../src/core/run-ledger.js';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    run: {} as EvidenceBundle['run'],
    events: [],
    inputs: {},
    plan: { tasks: ['task1'] },
    reads: [{ path: '/file1' } as EvidenceBundle['reads'][0]],
    writes: [{ path: '/file2' } as EvidenceBundle['writes'][0]],
    commands: [{ exitCode: 0 } as EvidenceBundle['commands'][0]],
    tests: [{ status: 'pass' } as EvidenceBundle['tests'][0]],
    gates: [{ status: 'pass' } as EvidenceBundle['gates'][0]],
    receipts: [],
    verdict: 'complete' as EvidenceBundle['verdict'],
    summary: '',
    ...overrides,
  };
}

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test',
    lastHandoff: '',
    workflowStage: 'verify',
    currentPhase: 1,
    tasks: {},
    auditLog: [],
    profile: 'default',
    ...overrides,
  } as unknown as DanteState;
}

// ── validateCompletion ────────────────────────────────────────────────────────

describe('validateCompletion', () => {
  it('returns object with required fields', () => {
    const result = validateCompletion(makeBundle(), makeState());
    assert.ok(typeof result.verdict === 'string');
    assert.ok(typeof result.isComplete === 'boolean');
    assert.ok(typeof result.score === 'number');
    assert.ok(Array.isArray(result.reasons));
    assert.ok(Array.isArray(result.recommendations));
  });

  it('complete verdict when all criteria met', () => {
    const bundle = makeBundle();
    const result = validateCompletion(bundle, makeState());
    // With all evidence present and passing, should be complete or partially_complete
    assert.ok(['complete', 'partially_complete'].includes(result.verdict));
  });

  it('regressed when no evidence at all', () => {
    const bundle = makeBundle({
      reads: [],
      writes: [],
      commands: [],
      tests: [],
      gates: [],
      plan: {},
    });
    const result = validateCompletion(bundle, makeState());
    assert.equal(result.verdict, 'regressed');
    assert.equal(result.isComplete, false);
  });

  it('misleadingly_complete when writes but no commands (but other evidence present)', () => {
    // Need score >= 50 (so not 'regressed') but commands=0 with writes present.
    // Include tests+gates+plan to build up score, but no reads or commands.
    const bundle = makeBundle({
      reads: [],        // no reads (reason added, no +15)
      commands: [],     // no commands (reason added, no +10) — this is the key signal
      // writes, tests, gates, plan kept from makeBundle defaults
    });
    const result = validateCompletion(bundle, makeState());
    // score = 15 (writes) + 15 (tests pass) + 15 (gates pass) + 10 (plan) = 55 → not regressed
    // reasons = ['no reads', 'no commands'] (length 2, score 55 < 60 → not partially_complete)
    // commands.length === 0 && writes.length > 0 → misleadingly_complete
    assert.equal(result.verdict, 'misleadingly_complete');
  });

  it('score is a number between 0 and 100', () => {
    const result = validateCompletion(makeBundle(), makeState());
    assert.ok(result.score >= 0);
    assert.ok(result.score <= 100);
  });

  it('failing tests reduce score', () => {
    const goodBundle = makeBundle();
    const badBundle = makeBundle({
      tests: [{ status: 'fail' } as EvidenceBundle['tests'][0], { status: 'fail' } as EvidenceBundle['tests'][0]],
    });
    const goodResult = validateCompletion(goodBundle, makeState());
    const badResult = validateCompletion(badBundle, makeState());
    assert.ok(badResult.score < goodResult.score);
  });

  it('isComplete is true only for complete verdict', () => {
    const regressedBundle = makeBundle({ reads: [], writes: [], commands: [], tests: [], gates: [], plan: {} });
    const result = validateCompletion(regressedBundle, makeState());
    assert.equal(result.isComplete, false);
  });

  it('coverageAnalysis is included in result', () => {
    const result = validateCompletion(makeBundle(), makeState());
    assert.ok(result.coverageAnalysis !== undefined);
  });
});

// ── adversarialTestCases data ─────────────────────────────────────────────────

describe('adversarialTestCases', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(adversarialTestCases));
    assert.ok(adversarialTestCases.length >= 3);
  });

  it('each case has required fields', () => {
    for (const tc of adversarialTestCases) {
      assert.ok(typeof tc.name === 'string', `${tc.name}.name missing`);
      assert.ok(typeof tc.description === 'string', `${tc.name}.description missing`);
      assert.ok(typeof tc.expectedVerdict === 'string', `${tc.name}.expectedVerdict missing`);
      assert.ok(typeof tc.shouldDetectFalseCompletion === 'boolean', `${tc.name}.shouldDetectFalseCompletion missing`);
    }
  });

  it('includes a genuine-completion case', () => {
    const genuine = adversarialTestCases.find(tc => !tc.shouldDetectFalseCompletion);
    assert.ok(genuine !== undefined, 'should have at least one genuine completion case');
    assert.equal(genuine.expectedVerdict, 'complete');
  });

  it('includes a no-evidence case', () => {
    const noEvidence = adversarialTestCases.find(tc => tc.name === 'no-evidence-whatsoever');
    assert.ok(noEvidence !== undefined);
    assert.equal(noEvidence.shouldDetectFalseCompletion, true);
  });
});

// ── runAdversarialTests ───────────────────────────────────────────────────────

describe('runAdversarialTests', () => {
  it('returns results and summary', async () => {
    const output = await runAdversarialTests(makeState());
    assert.ok(Array.isArray(output.results));
    assert.ok(typeof output.summary.total === 'number');
    assert.ok(typeof output.summary.passed === 'number');
    assert.ok(typeof output.summary.detectionRate === 'number');
  });

  it('result count matches test case count', async () => {
    const output = await runAdversarialTests(makeState());
    assert.equal(output.results.length, adversarialTestCases.length);
  });

  it('detectionRate is between 0 and 100', async () => {
    const output = await runAdversarialTests(makeState());
    assert.ok(output.summary.detectionRate >= 0);
    assert.ok(output.summary.detectionRate <= 100);
  });

  it('each result has test, result, and passed fields', async () => {
    const output = await runAdversarialTests(makeState());
    for (const r of output.results) {
      assert.ok(r.test !== undefined);
      assert.ok(r.result !== undefined);
      assert.ok(typeof r.passed === 'boolean');
    }
  });
});
