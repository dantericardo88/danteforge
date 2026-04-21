import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRequirementCoverage } from '../src/core/requirement-coverage.js';
import type { EvidenceBundle } from '../src/core/run-ledger.js';
import type { DanteState } from '../src/core/state.js';

function makeBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    run: {
      runId: 'test-run',
      command: 'forge',
      args: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      exitCode: 0,
      correlationId: 'corr-1',
    },
    verdict: { status: 'success', completionOracle: true, evidenceHash: 'a'.repeat(64) },
    events: [],
    inputs: {},
    plan: null,
    reads: [],
    writes: [],
    commands: [],
    tests: [],
    gates: [],
    receipts: [],
    summary: '',
    ...overrides,
  };
}

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    currentPhase: 1,
    workflowStage: 'forge',
    tasks: {},
    auditLog: [],
    profile: '',
    lastHandoff: '',
    ...overrides,
  } as DanteState;
}

describe('analyzeRequirementCoverage', () => {
  it('always has at least 4 default requirements', () => {
    const analysis = analyzeRequirementCoverage(makeBundle(), makeState());
    assert.ok(analysis.requirements.totalRequirements >= 4, 'should have default requirements');
    assert.ok(analysis.requirements.coveragePercent >= 0);
    assert.ok(Array.isArray(analysis.requirements.missingRequirements));
  });

  it('extracts requirements from constitution lines', () => {
    const state = makeState({ constitution: 'Zero ambiguity\nTest everything\nFast feedback' } as any);
    const analysis = analyzeRequirementCoverage(makeBundle(), state);
    assert.ok(analysis.requirements.totalRequirements >= 3);
  });

  it('counts passing tests', () => {
    const bundle = makeBundle({
      tests: [
        { testName: 'a', status: 'pass', duration: 10, timestamp: '' },
        { testName: 'b', status: 'fail', duration: 5, timestamp: '' },
        { testName: 'c', status: 'pass', duration: 8, timestamp: '' },
      ],
    });
    const analysis = analyzeRequirementCoverage(bundle, makeState());
    assert.equal(analysis.tests.total, 3);
    assert.equal(analysis.tests.passing, 2);
    assert.ok(Math.abs(analysis.tests.coverage - 66.67) < 1);
  });

  it('returns 0 test coverage when no tests', () => {
    const analysis = analyzeRequirementCoverage(makeBundle({ tests: [] }), makeState());
    assert.equal(analysis.tests.coverage, 0);
  });

  it('includes specification requirement when specify stage completed', () => {
    const state = makeState({
      auditLog: ['2026-01-01T00:00:00.000Z | specify: created spec'],
    });
    const analysis = analyzeRequirementCoverage(makeBundle(), state);
    assert.ok(analysis.requirements.totalRequirements >= 1);
  });

  it('tracks artifact coverage from writes', () => {
    const bundle = makeBundle({
      writes: [
        { path: '.danteforge/SPEC.md', operation: 'write', timestamp: '' },
        { path: 'src/index.ts', operation: 'write', timestamp: '' },
      ],
    });
    const state = makeState({
      auditLog: ['2026-01-01T00:00:00.000Z | specify: created spec'],
    });
    const analysis = analyzeRequirementCoverage(bundle, state);
    assert.ok(Array.isArray(analysis.artifacts.expected));
    assert.ok(Array.isArray(analysis.artifacts.present));
    assert.ok(Array.isArray(analysis.artifacts.missing));
  });

  it('coverage percent is 0-100', () => {
    const state = makeState({ constitution: 'Line 1\nLine 2' } as any);
    const analysis = analyzeRequirementCoverage(makeBundle(), state);
    assert.ok(analysis.requirements.coveragePercent >= 0);
    assert.ok(analysis.requirements.coveragePercent <= 100);
  });
});
