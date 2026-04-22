import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRequirementCoverage } from '../src/core/requirement-coverage.js';

function makeBundle(overrides = {}) {
  return {
    run: { id: 'run-1', startedAt: '2026-01-01T00:00:00.000Z', command: 'forge' },
    events: [],
    inputs: {},
    plan: {},
    reads: [],
    writes: [],
    commands: [],
    tests: [],
    gates: [],
    receipts: [],
    verdict: { status: 'pass', score: 80 },
    summary: 'run summary',
    ...overrides,
  };
}

function makeState(overrides = {}) {
  return {
    project: 'TestProject',
    profile: 'standard',
    workflowStage: 'forge',
    currentPhase: 1,
    tasks: {},
    auditLog: [],
    constitution: false,
    spec: false,
    plan: false,
    tests: false,
    totalTokensUsed: 0,
    scoreHistory: [],
    ...overrides,
  };
}

describe('analyzeRequirementCoverage', () => {
  it('returns structured result with all required fields', () => {
    const result = analyzeRequirementCoverage(makeBundle(), makeState());
    assert.ok(typeof result.requirements.totalRequirements === 'number');
    assert.ok(typeof result.requirements.coveragePercent === 'number');
    assert.ok(typeof result.tests.total === 'number');
    assert.ok(Array.isArray(result.artifacts.expected));
    assert.ok(Array.isArray(result.artifacts.present));
    assert.ok(Array.isArray(result.artifacts.missing));
  });

  it('counts passing tests correctly', () => {
    const bundle = makeBundle({
      tests: [
        { status: 'pass', name: 'test1' },
        { status: 'pass', name: 'test2' },
        { status: 'fail', name: 'test3' },
      ],
    });
    const result = analyzeRequirementCoverage(bundle, makeState());
    assert.equal(result.tests.total, 3);
    assert.equal(result.tests.passing, 2);
    assert.ok(result.tests.coverage > 0);
  });

  it('reports 100 test coverage with all passing tests', () => {
    const bundle = makeBundle({
      tests: [{ status: 'pass', name: 'test1' }, { status: 'pass', name: 'test2' }],
    });
    const result = analyzeRequirementCoverage(bundle, makeState());
    assert.equal(result.tests.coverage, 100);
  });

  it('reports 0 test coverage when no tests', () => {
    const result = analyzeRequirementCoverage(makeBundle({ tests: [] }), makeState());
    assert.equal(result.tests.total, 0);
    assert.equal(result.tests.coverage, 0);
  });

  it('returns coverage map with boolean values', () => {
    const result = analyzeRequirementCoverage(makeBundle(), makeState());
    for (const value of Object.values(result.requirements.coverageMap)) {
      assert.ok(typeof value === 'boolean');
    }
  });

  it('missing artifacts = expected minus present', () => {
    const result = analyzeRequirementCoverage(makeBundle(), makeState());
    assert.equal(
      result.artifacts.missing.length,
      result.artifacts.expected.length - result.artifacts.present.length
    );
  });

  it('coverage percent is between 0 and 100', () => {
    const result = analyzeRequirementCoverage(makeBundle(), makeState());
    assert.ok(result.requirements.coveragePercent >= 0);
    assert.ok(result.requirements.coveragePercent <= 100);
  });

  it('detects written artifacts as present', () => {
    const bundle = makeBundle({ writes: [{ path: '.danteforge/state.json', size: 100 }] });
    const result = analyzeRequirementCoverage(bundle, makeState());
    assert.ok(result.artifacts.present.includes('.danteforge/state.json'));
  });

  it('covered + missing = total requirements', () => {
    const result = analyzeRequirementCoverage(makeBundle(), makeState());
    assert.equal(
      result.requirements.coveredRequirements + result.requirements.missingRequirements.length,
      result.requirements.totalRequirements
    );
  });
});
