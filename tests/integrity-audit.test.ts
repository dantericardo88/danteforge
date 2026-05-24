import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScoreCap,
  buildAuditRecord,
  isInCriticalPath,
  classifyStatus,
  STUB_PATTERNS,
} from '../src/core/integrity-audit.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';

function makeDim(overrides: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id: 'autonomy',
    label: 'Autonomy & Self-Direction',
    weight: 1.2,
    category: 'features',
    frequency: 'high',
    scores: { self: 9.0, 'Devin (Cognition AI)': 9.5 },
    gap_to_leader: 0.5,
    leader: 'Devin (Cognition AI)',
    gap_to_closed_source_leader: 0.5,
    closed_source_leader: 'Devin (Cognition AI)',
    gap_to_oss_leader: 0,
    oss_leader: 'OpenHands',
    harvest_source: 'OpenHands',
    status: 'in-progress',
    ...overrides,
  } as MatrixDimension;
}

// ── computeScoreCap ───────────────────────────────────────────────────────────

describe('computeScoreCap — no implementation', () => {
  it('caps at 1 when hasSrcImplementation is false', () => {
    const result = computeScoreCap({
      capabilityTestResult: null,
      outcomeCount: 0,
      passingOutcomes: 0,
      criticalPathStubCount: 0,
      anyStubInPath: false,
      hasSrcImplementation: false,
    });
    assert.equal(result.cap, 1);
    assert.equal(result.evidenceLevel, 'missing');
  });
});

describe('computeScoreCap — code exists, no capability_test', () => {
  it('caps at 4 when no capability_test declared', () => {
    const result = computeScoreCap({
      capabilityTestResult: null,
      outcomeCount: 0,
      passingOutcomes: 0,
      criticalPathStubCount: 0,
      anyStubInPath: false,
      hasSrcImplementation: true,
    });
    assert.equal(result.cap, 4);
    assert.equal(result.evidenceLevel, 'code-exists');
  });

  it('caps at 4 when capability_test fails', () => {
    const result = computeScoreCap({
      capabilityTestResult: { command: 'node dist/index.js foo', exitCode: 1, passed: false, durationMs: 100, stdout: '', stderr: '' },
      outcomeCount: 5,
      passingOutcomes: 5,
      criticalPathStubCount: 0,
      anyStubInPath: false,
      hasSrcImplementation: true,
    });
    assert.equal(result.cap, 4);
  });
});

describe('computeScoreCap — capability_test passes, no outcomes', () => {
  it('caps at 5 when no outcomes declared', () => {
    const result = computeScoreCap({
      capabilityTestResult: { command: 'node dist/index.js foo --dry-run', exitCode: 0, passed: true, durationMs: 200, stdout: 'ok', stderr: '' },
      outcomeCount: 0,
      passingOutcomes: 0,
      criticalPathStubCount: 0,
      anyStubInPath: false,
      hasSrcImplementation: true,
    });
    assert.equal(result.cap, 5);
    assert.equal(result.evidenceLevel, 'unit-tests');
  });
});

describe('computeScoreCap — stubs in critical path', () => {
  it('caps at 6 when stubs found in critical path', () => {
    const result = computeScoreCap({
      capabilityTestResult: { command: 'node dist/index.js foo', exitCode: 0, passed: true, durationMs: 100, stdout: 'ok', stderr: '' },
      outcomeCount: 6,
      passingOutcomes: 6,
      criticalPathStubCount: 2,
      anyStubInPath: true,
      hasSrcImplementation: true,
    });
    assert.equal(result.cap, 6);
    assert.equal(result.evidenceLevel, 'mocks-only');
  });
});

describe('computeScoreCap — partial outcomes', () => {
  it('caps at 7 when fewer than 70% of outcomes pass', () => {
    const result = computeScoreCap({
      capabilityTestResult: { command: 'cmd', exitCode: 0, passed: true, durationMs: 100, stdout: 'ok', stderr: '' },
      outcomeCount: 10,
      passingOutcomes: 5,
      criticalPathStubCount: 0,
      anyStubInPath: false,
      hasSrcImplementation: true,
    });
    assert.equal(result.cap, 7);
    assert.equal(result.evidenceLevel, 'e2e-with-caveats');
  });

  it('caps at 8 when 70-99% of outcomes pass', () => {
    const result = computeScoreCap({
      capabilityTestResult: { command: 'cmd', exitCode: 0, passed: true, durationMs: 100, stdout: 'ok', stderr: '' },
      outcomeCount: 10,
      passingOutcomes: 8,
      criticalPathStubCount: 0,
      anyStubInPath: false,
      hasSrcImplementation: true,
    });
    assert.equal(result.cap, 8);
    assert.equal(result.evidenceLevel, 'e2e-realistic');
  });
});

describe('computeScoreCap — full evidence', () => {
  it('returns cap 9 when all outcomes pass and no critical stubs', () => {
    const result = computeScoreCap({
      capabilityTestResult: { command: 'cmd', exitCode: 0, passed: true, durationMs: 100, stdout: 'ok', stderr: '' },
      outcomeCount: 6,
      passingOutcomes: 6,
      criticalPathStubCount: 0,
      anyStubInPath: false,
      hasSrcImplementation: true,
    });
    assert.equal(result.cap, 9);
    assert.equal(result.evidenceLevel, 'production-real');
  });
});

// ── isInCriticalPath ──────────────────────────────────────────────────────────

describe('isInCriticalPath', () => {
  it('matches file containing dimension id', () => {
    const dim = makeDim({ id: 'autonomy', label: 'Autonomy & Self-Direction' });
    assert.equal(isInCriticalPath('src/cli/commands/autonomy.ts', dim), true);
  });

  it('matches file containing label keyword', () => {
    const dim = makeDim({ id: 'token_economy', label: 'Token Economy & Cost Control' });
    assert.equal(isInCriticalPath('src/core/token-estimator.ts', dim), true);
  });

  it('does not match unrelated file', () => {
    const dim = makeDim({ id: 'autonomy', label: 'Autonomy & Self-Direction' });
    assert.equal(isInCriticalPath('src/core/oss-registry.ts', dim), false);
  });
});

// ── classifyStatus ────────────────────────────────────────────────────────────

describe('classifyStatus', () => {
  it('maps missing → missing', () => {
    assert.equal(classifyStatus({ cap: 1, reason: '', evidenceLevel: 'missing' }), 'missing');
  });
  it('maps docs-only → claimed', () => {
    assert.equal(classifyStatus({ cap: 3, reason: '', evidenceLevel: 'docs-only' }), 'claimed');
  });
  it('maps code-exists → structural', () => {
    assert.equal(classifyStatus({ cap: 4, reason: '', evidenceLevel: 'code-exists' }), 'structural');
  });
  it('maps unit-tests → partially-verified', () => {
    assert.equal(classifyStatus({ cap: 5, reason: '', evidenceLevel: 'unit-tests' }), 'partially-verified');
  });
  it('maps production-real → verified', () => {
    assert.equal(classifyStatus({ cap: 9, reason: '', evidenceLevel: 'production-real' }), 'verified');
  });
});

// ── buildAuditRecord ──────────────────────────────────────────────────────────

describe('buildAuditRecord — cap applied', () => {
  it('sets capApplied when prior score exceeds cap', () => {
    const dim = makeDim({ scores: { self: 9.0, 'Devin (Cognition AI)': 9.5 } });
    const capResult = { cap: 4, reason: 'no capability_test', evidenceLevel: 'code-exists' as const };
    const record = buildAuditRecord({
      dim, capTestResult: null, capResult, stubFindings: [],
      outcomeCount: 0, passingOutcomes: 0, hasSrcImplementation: true,
    });
    assert.equal(record.ourScore, 4);
    assert.equal(record.ourScorePre, 9);
    assert.notEqual(record.capApplied, null);
    assert.equal(record.status, 'structural');
  });

  it('does not cap when prior score is already at or below cap', () => {
    const dim = makeDim({ scores: { self: 5.0, 'Devin (Cognition AI)': 9.5 } });
    const capResult = { cap: 9, reason: 'all outcomes pass', evidenceLevel: 'production-real' as const };
    const record = buildAuditRecord({
      dim, capTestResult: { command: 'cmd', exitCode: 0, passed: true, durationMs: 100, stdout: '', stderr: '' },
      capResult, stubFindings: [],
      outcomeCount: 6, passingOutcomes: 6, hasSrcImplementation: true,
    });
    assert.equal(record.ourScore, 5);
    assert.equal(record.capApplied, null);
  });
});

// ── STUB_PATTERNS completeness ────────────────────────────────────────────────

describe('STUB_PATTERNS', () => {
  it('includes all required patterns from the integrity protocol', () => {
    const required = ['TODO', 'FIXME', 'stub', 'placeholder', 'not implemented',
      'fake', 'dummy', 'hardcoded', 'jest.mock(', 'vi.mock(', 'test.skip', 'describe.skip'];
    const names = STUB_PATTERNS.map(p => p.pattern.toLowerCase());
    for (const r of required) {
      assert.ok(names.some(n => n.includes(r.toLowerCase())), `Missing pattern: ${r}`);
    }
  });
});
