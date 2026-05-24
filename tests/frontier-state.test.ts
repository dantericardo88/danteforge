import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDimensionFrontierStatus,
  computeProjectFrontierState,
} from '../src/core/frontier-state.js';
import { validateOutcomeForTier } from '../src/matrix/types/outcome.js';
import type { CapabilityTier } from '../src/matrix/types/capability-test.js';
import type { Outcome, OutcomeEvidence, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';
import { makeEvidenceKey } from '../src/matrix/types/outcome.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeOutcome(id: string, tier: CapabilityTier, opts: Partial<Outcome> = {}): Outcome {
  return {
    id, tier,
    description: `outcome ${id}`,
    command: `echo ${id}`,
    ...opts,
  } as Outcome;
}

function makeFreshOutcome(id: string, callsite: string, opts: { freshnessDays?: number } = {}): Outcome {
  return {
    id, tier: 'T3', kind: 'production-usage-fresh',
    description: `production-usage-fresh for ${callsite}`,
    required_callsite: callsite,
    freshnessDays: opts.freshnessDays ?? 30,
  };
}

function makeEvidence(records: Array<{ dim: string; outcomeId: string; passed: boolean }>): OutcomeEvidence {
  const map: OutcomeEvidence = new Map();
  for (const r of records) {
    const entry: OutcomeEvidenceEntry = {
      dimensionId: r.dim, outcomeId: r.outcomeId, tier: 'T1', gitSha: 'abc',
      passed: r.passed, exitCode: r.passed ? 0 : 1, durationMs: 100,
      stdoutTail: '', stderrTail: '', ranAt: '', evidencePath: '',
    };
    map.set(makeEvidenceKey(r.dim, r.outcomeId), entry);
  }
  return map;
}

// ── validateOutcomeForTier ────────────────────────────────────────────────────

describe('validateOutcomeForTier', () => {
  it('T0/T1 outcomes do not require required_callsite', () => {
    assert.equal(validateOutcomeForTier(makeOutcome('a', 'T0')).length, 0);
    assert.equal(validateOutcomeForTier(makeOutcome('b', 'T1')).length, 0);
  });

  it('T2 outcome without required_callsite is rejected', () => {
    const errors = validateOutcomeForTier(makeOutcome('a', 'T2'));
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.reason, /required_callsite/);
  });

  it('T2 outcome with required_callsite passes', () => {
    const errors = validateOutcomeForTier(makeOutcome('a', 'T2', { required_callsite: 'src/foo.ts' }));
    assert.equal(errors.length, 0);
  });

  it('T4 outcome requires sibling snapshot-test outcome', () => {
    // T4 outcome whose own command is unrelated to snapshots
    const t4 = makeOutcome('e2e-call', 'T4', { required_callsite: 'src/foo.ts', command: 'node dist/foo.js --check' });
    const errorsAlone = validateOutcomeForTier(t4, { siblingOutcomes: [t4] });
    assert.ok(errorsAlone.some(e => /snapshot/.test(e.reason)));

    // Add a sibling snapshot-style outcome to satisfy the T4 requirement
    const snap = makeOutcome('snap', 'T2', { required_callsite: 'src/foo.ts', command: 'pnpm snapshot test' });
    const errorsWith = validateOutcomeForTier(t4, { siblingOutcomes: [t4, snap] });
    assert.equal(errorsWith.length, 0, `expected 0 errors, got: ${JSON.stringify(errorsWith)}`);
  });

  it('T5 outcome without benchmark reference is rejected', () => {
    const errors = validateOutcomeForTier(makeOutcome('b', 'T5', { required_callsite: 'src/foo.ts' }));
    assert.ok(errors.some(e => /benchmark/.test(e.reason)));
  });

  it('T5 outcome with swe-bench command passes', () => {
    const errors = validateOutcomeForTier(makeOutcome('b', 'T5', {
      required_callsite: 'src/foo.ts',
      command: 'pnpm test:swe-bench',
    }));
    assert.equal(errors.filter(e => /benchmark/.test(e.reason)).length, 0);
  });

  it('T6 outcome must be kind=telemetry', () => {
    const errors = validateOutcomeForTier(makeOutcome('c', 'T6', { required_callsite: 'src/foo.ts' }));
    assert.ok(errors.some(e => /telemetry/.test(e.reason)));
  });
});

// ── computeDimensionFrontierStatus ────────────────────────────────────────────

describe('computeDimensionFrontierStatus', () => {
  it('returns no-outcomes-declared when dim has no outcomes', () => {
    const result = computeDimensionFrontierStatus(
      { id: 'x', scores: { self: 8 } },
      new Map(),
    );
    assert.equal(result.status, 'no-outcomes-declared');
  });

  it('returns at-frontier when all ceiling outcomes pass and ceiling < T3 (no fresh check)', () => {
    const dim = {
      id: 'x',
      outcomes: [makeOutcome('a', 'T1'), makeOutcome('b', 'T2', { required_callsite: 'src/x.ts' })],
      declared_ceiling: 'T2' as const,
    };
    const evidence = makeEvidence([
      { dim: 'x', outcomeId: 'a', passed: true },
      { dim: 'x', outcomeId: 'b', passed: true },
    ]);
    const result = computeDimensionFrontierStatus(dim, evidence);
    assert.equal(result.status, 'at-frontier');
    assert.equal(result.conditions.productionUsageFreshOrLowTier, true);
  });

  it('returns progressing when T3 ceiling has no production-usage-fresh outcome', () => {
    const dim = {
      id: 'x',
      outcomes: [
        makeOutcome('a', 'T1'),
        makeOutcome('b', 'T2', { required_callsite: 'src/x.ts' }),
        makeOutcome('c', 'T3', { required_callsite: 'src/x.ts' }),
      ],
      declared_ceiling: 'T3' as const,
    };
    const evidence = makeEvidence([
      { dim: 'x', outcomeId: 'a', passed: true },
      { dim: 'x', outcomeId: 'b', passed: true },
      { dim: 'x', outcomeId: 'c', passed: true },
    ]);
    const result = computeDimensionFrontierStatus(dim, evidence);
    assert.equal(result.status, 'progressing');
    assert.equal(result.conditions.productionUsageFreshOrLowTier, false);
    assert.match(result.reason, /production-usage-fresh/);
  });

  it('returns at-frontier when T3 dim has passing production-usage-fresh', () => {
    const dim = {
      id: 'x',
      outcomes: [
        makeOutcome('a', 'T1'),
        makeOutcome('b', 'T2', { required_callsite: 'src/x.ts' }),
        makeOutcome('c', 'T3', { required_callsite: 'src/x.ts' }),
        makeFreshOutcome('reach', 'src/x.ts'),
      ],
      declared_ceiling: 'T3' as const,
    };
    const evidence = makeEvidence([
      { dim: 'x', outcomeId: 'a', passed: true },
      { dim: 'x', outcomeId: 'b', passed: true },
      { dim: 'x', outcomeId: 'c', passed: true },
      { dim: 'x', outcomeId: 'reach', passed: true },
    ]);
    const result = computeDimensionFrontierStatus(dim, evidence);
    assert.equal(result.status, 'at-frontier');
  });

  it('returns blocked-by-dispensation when a dispensation is outstanding', () => {
    const dim = {
      id: 'x',
      outcomes: [makeOutcome('a', 'T1')],
      declared_ceiling: 'T1' as const,
    };
    const evidence = makeEvidence([{ dim: 'x', outcomeId: 'a', passed: true }]);
    const result = computeDimensionFrontierStatus(dim, evidence, {
      dispensations: ['receipt-001'],
    });
    assert.equal(result.status, 'blocked-by-dispensation');
    assert.match(result.reason, /receipt-001/);
  });

  it('returns stuck when wavesSinceProgress >= threshold and not at frontier', () => {
    const dim = {
      id: 'x',
      outcomes: [makeOutcome('a', 'T1'), makeOutcome('b', 'T2', { required_callsite: 'src/x.ts' })],
      declared_ceiling: 'T2' as const,
    };
    const evidence = makeEvidence([
      { dim: 'x', outcomeId: 'a', passed: true },
      { dim: 'x', outcomeId: 'b', passed: false }, // not yet at frontier
    ]);
    const result = computeDimensionFrontierStatus(dim, evidence, {
      wavesSinceProgress: 4,
      stuckThreshold: 3,
    });
    assert.equal(result.status, 'stuck');
    assert.match(result.reason, /4 crusade waves/);
  });
});

// ── computeProjectFrontierState ───────────────────────────────────────────────

describe('computeProjectFrontierState — terminal verdicts', () => {
  it('frontier-reached when every declared dim is at frontier', () => {
    const state = computeProjectFrontierState({
      dimensions: [
        {
          id: 'a',
          outcomes: [makeOutcome('o1', 'T1')],
          declared_ceiling: 'T1',
        },
        {
          id: 'b',
          outcomes: [makeOutcome('o2', 'T2', { required_callsite: 'src/b.ts' })],
          declared_ceiling: 'T2',
        },
      ],
      evidence: makeEvidence([
        { dim: 'a', outcomeId: 'o1', passed: true },
        { dim: 'b', outcomeId: 'o2', passed: true },
      ]),
    });
    assert.equal(state.terminal, 'frontier-reached');
  });

  it('stuck-on-dims when at least one dim hit stuck threshold', () => {
    const state = computeProjectFrontierState({
      dimensions: [
        {
          id: 'a',
          outcomes: [makeOutcome('o1', 'T1'), makeOutcome('o2', 'T2', { required_callsite: 'src/a.ts' })],
          declared_ceiling: 'T2',
        },
      ],
      evidence: makeEvidence([
        { dim: 'a', outcomeId: 'o1', passed: true },
        { dim: 'a', outcomeId: 'o2', passed: false },
      ]),
      wavesSinceProgress: { a: 5 },
      stuckThreshold: 3,
    });
    assert.equal(state.terminal, 'stuck-on-dims');
    assert.deepEqual(state.stuckDims, ['a']);
  });

  it('blocked-by-dispensations supersedes everything else', () => {
    const state = computeProjectFrontierState({
      dimensions: [
        {
          id: 'a',
          outcomes: [makeOutcome('o1', 'T1')],
          declared_ceiling: 'T1',
        },
      ],
      evidence: makeEvidence([{ dim: 'a', outcomeId: 'o1', passed: true }]),
      dispensations: { a: ['receipt-1'] },
    });
    assert.equal(state.terminal, 'blocked-by-dispensations');
    assert.deepEqual(state.blockingDispensations, ['receipt-1']);
  });

  it('progressing when neither at frontier nor stuck nor blocked', () => {
    const state = computeProjectFrontierState({
      dimensions: [
        {
          id: 'a',
          outcomes: [makeOutcome('o1', 'T1'), makeOutcome('o2', 'T2', { required_callsite: 'src/a.ts' })],
          declared_ceiling: 'T2',
        },
      ],
      evidence: makeEvidence([
        { dim: 'a', outcomeId: 'o1', passed: true },
        { dim: 'a', outcomeId: 'o2', passed: false },
      ]),
      wavesSinceProgress: { a: 1 }, // not stuck yet
    });
    assert.equal(state.terminal, 'progressing');
  });
});
