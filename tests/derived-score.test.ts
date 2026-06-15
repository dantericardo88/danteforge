import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDerivedScore,
  computeDerivedScoreWithBreakdown,
  hasOutcomes,
  type DimensionForScoring,
} from '../src/core/derived-score.js';
import { TIER_SCORE_CAPS } from '../src/matrix/types/capability-test.js';
import {
  isOutcomePassing,
  makeEvidenceKey,
  type Outcome,
  type OutcomeEvidence,
  type OutcomeEvidenceEntry,
} from '../src/matrix/types/outcome.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeOutcome(id: string, tier: Outcome['tier'], opts: Partial<Outcome> = {}): Outcome {
  // A fixture standing in for a GENUINE runtime/e2e receipt declares real-user-path
  // provenance — the scoring contract now structurally requires it for the 9.0 (T7) tier.
  // Tests exercising the synthetic/undeclared path override input_source via opts.
  const kind = (opts as { kind?: string }).kind;
  const needsProvenance = kind === 'runtime-exec' || kind === 'e2e-workflow';
  return {
    id, tier,
    description: `outcome ${id}`,
    command: `echo ${id}`,
    ...(needsProvenance ? { input_source: { type: 'real-user-path', description: `genuine ${id}` } } : {}),
    ...opts,
  } as Outcome;
}

function makeDim(outcomes: Outcome[], opts: Partial<DimensionForScoring> = {}): DimensionForScoring {
  return { id: 'test', outcomes, ...opts };
}

function makeEvidence(records: Array<{ dim: string; outcomeId: string; passed: boolean; exitCode?: number; pattern?: string; sessionId?: string; evidenceQuality?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' }>): OutcomeEvidence {
  const map: OutcomeEvidence = new Map();
  for (const r of records) {
    const entry: OutcomeEvidenceEntry = {
      dimensionId: r.dim,
      outcomeId: r.outcomeId,
      tier: 'T1',
      gitSha: 'abc',
      passed: r.passed,
      exitCode: r.exitCode ?? (r.passed ? 0 : 1),
      durationMs: 100,
      stdoutTail: r.pattern ?? '',
      stderrTail: '',
      ranAt: '2026-05-18T15:00:00Z',
      evidencePath: '/fake',
      session_id: r.sessionId,
      evidenceQuality: r.evidenceQuality,
    };
    map.set(makeEvidenceKey(r.dim, r.outcomeId), entry);
  }
  return map;
}

// ── isOutcomePassing helper ──────────────────────────────────────────────────

describe('isOutcomePassing', () => {
  it('returns false when no evidence provided', () => {
    const outcome = makeOutcome('a', 'T1');
    assert.equal(isOutcomePassing(outcome, undefined), false);
  });

  it('returns true on clean exit-0 evidence', () => {
    const outcome = makeOutcome('a', 'T1');
    const entry: OutcomeEvidenceEntry = {
      dimensionId: 'test', outcomeId: 'a', tier: 'T1', gitSha: 'x',
      passed: true, exitCode: 0, durationMs: 0,
      stdoutTail: '', stderrTail: '', ranAt: '', evidencePath: '',
    };
    assert.equal(isOutcomePassing(outcome, entry), true);
  });

  it('honors expected_exit (non-zero expected)', () => {
    const outcome = makeOutcome('a', 'T1', { expected_exit: 1 });
    const entry: OutcomeEvidenceEntry = {
      dimensionId: 'test', outcomeId: 'a', tier: 'T1', gitSha: 'x',
      passed: true, exitCode: 1, durationMs: 0,
      stdoutTail: '', stderrTail: '', ranAt: '', evidencePath: '',
    };
    assert.equal(isOutcomePassing(outcome, entry), true);
  });

  it('requires the output pattern to match when set', () => {
    const outcome = makeOutcome('a', 'T1', { expected_output_pattern: '\\bsuccess\\b' });
    const failingPattern: OutcomeEvidenceEntry = {
      dimensionId: 'test', outcomeId: 'a', tier: 'T1', gitSha: 'x',
      passed: true, exitCode: 0, durationMs: 0,
      stdoutTail: 'no relevant output here', stderrTail: '', ranAt: '', evidencePath: '',
    };
    const matchingPattern: OutcomeEvidenceEntry = { ...failingPattern, stdoutTail: 'operation: success' };
    assert.equal(isOutcomePassing(outcome, failingPattern), false);
    assert.equal(isOutcomePassing(outcome, matchingPattern), true);
  });

  it('returns false on a malformed regex (defensive)', () => {
    const outcome = makeOutcome('a', 'T1', { expected_output_pattern: '[unclosed' });
    const entry: OutcomeEvidenceEntry = {
      dimensionId: 'test', outcomeId: 'a', tier: 'T1', gitSha: 'x',
      passed: true, exitCode: 0, durationMs: 0,
      stdoutTail: '', stderrTail: '', ranAt: '', evidencePath: '',
    };
    assert.equal(isOutcomePassing(outcome, entry), false);
  });
});

// ── Pure-function properties ─────────────────────────────────────────────────

describe('computeDerivedScore — pure function properties', () => {
  it('returns 0 for a dim with one T1 outcome failing', () => {
    const dim = makeDim([makeOutcome('compiles', 'T1')]);
    const evidence = makeEvidence([{ dim: 'test', outcomeId: 'compiles', passed: false }]);
    assert.equal(computeDerivedScore(dim, evidence), 0);
  });

  it('returns T1 cap (4.0) when the single T1 outcome passes', () => {
    const dim = makeDim([makeOutcome('compiles', 'T1')]);
    const evidence = makeEvidence([{ dim: 'test', outcomeId: 'compiles', passed: true }]);
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T1);
  });

  it('walks tiers low to high: T1 passes + T2 fails → T1 cap', () => {
    const dim = makeDim([
      makeOutcome('compiles', 'T1'),
      makeOutcome('tests', 'T2'),
    ]);
    const evidence = makeEvidence([
      { dim: 'test', outcomeId: 'compiles', passed: true },
      { dim: 'test', outcomeId: 'tests', passed: false },
    ]);
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T1);
  });

  it('walks tiers: T1+T2 pass + T3 fails → T2 cap', () => {
    const dim = makeDim([
      makeOutcome('compiles', 'T1'),
      makeOutcome('tests', 'T2'),
      makeOutcome('mutation', 'T3'),
    ]);
    const evidence = makeEvidence([
      { dim: 'test', outcomeId: 'compiles', passed: true },
      { dim: 'test', outcomeId: 'tests', passed: true },
      { dim: 'test', outcomeId: 'mutation', passed: false },
    ]);
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T2);
  });

  it('continuous tier-internal progress: 2/4 T2 outcomes pass → between T1 and T2 caps', () => {
    const dim = makeDim([
      makeOutcome('compiles', 'T1'),
      makeOutcome('test-a', 'T2'),
      makeOutcome('test-b', 'T2'),
      makeOutcome('test-c', 'T2'),
      makeOutcome('test-d', 'T2'),
    ]);
    const evidence = makeEvidence([
      { dim: 'test', outcomeId: 'compiles', passed: true },
      { dim: 'test', outcomeId: 'test-a', passed: true },
      { dim: 'test', outcomeId: 'test-b', passed: true },
      { dim: 'test', outcomeId: 'test-c', passed: false },
      { dim: 'test', outcomeId: 'test-d', passed: false },
    ]);
    const score = computeDerivedScore(dim, evidence);
    // T1 cap 4.0 + (T2 cap 5.0 - 4.0) * 0.5 = 4.5
    assert.equal(score, 4.5);
  });

  it('declared_ceiling caps the score even when more outcomes pass', () => {
    const dim = makeDim([
      makeOutcome('compiles', 'T1'),
      makeOutcome('tests', 'T2'),
      makeOutcome('mutation', 'T3'),
      makeOutcome('integration', 'T4'),
      makeOutcome('e2e', 'T5'),
    ], { declared_ceiling: 'T3' });
    const evidence = makeEvidence([
      { dim: 'test', outcomeId: 'compiles', passed: true },
      { dim: 'test', outcomeId: 'tests', passed: true },
      { dim: 'test', outcomeId: 'mutation', passed: true },
      { dim: 'test', outcomeId: 'integration', passed: true },
      { dim: 'test', outcomeId: 'e2e', passed: true },
    ]);
    // All pass, but ceiling is T3 → cap at 6.0
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T3);
  });

  it('legacy fallback: no outcomes declared → returns legacy_score', () => {
    const dim: DimensionForScoring = { id: 'test', legacy_score: 7.5 };
    assert.equal(computeDerivedScore(dim, new Map()), 7.5);
  });

  it('legacy fallback: no outcomes + no legacy → falls back to scores.self', () => {
    const dim: DimensionForScoring = { id: 'test', scores: { self: 6.5 } };
    assert.equal(computeDerivedScore(dim, new Map()), 6.5);
  });

  it('legacy fallback: no outcomes + no legacy + no scores.self → 0', () => {
    assert.equal(computeDerivedScore({ id: 'test' }, new Map()), 0);
  });

  it('pure: same inputs produce same outputs across calls', () => {
    const dim = makeDim([makeOutcome('a', 'T2'), makeOutcome('b', 'T2')]);
    const evidence = makeEvidence([
      { dim: 'test', outcomeId: 'a', passed: true },
      { dim: 'test', outcomeId: 'b', passed: false },
    ]);
    const first = computeDerivedScore(dim, evidence);
    const second = computeDerivedScore(dim, evidence);
    const third = computeDerivedScore(dim, evidence);
    assert.equal(first, second);
    assert.equal(second, third);
  });

  it('monotonic: more outcomes passing never lowers the score', () => {
    const dim = makeDim([
      makeOutcome('compiles', 'T1'),
      makeOutcome('test-a', 'T2'),
      makeOutcome('test-b', 'T2'),
    ]);
    const empty = makeEvidence([]);
    const partial = makeEvidence([
      { dim: 'test', outcomeId: 'compiles', passed: true },
    ]);
    const more = makeEvidence([
      { dim: 'test', outcomeId: 'compiles', passed: true },
      { dim: 'test', outcomeId: 'test-a', passed: true },
    ]);
    const all = makeEvidence([
      { dim: 'test', outcomeId: 'compiles', passed: true },
      { dim: 'test', outcomeId: 'test-a', passed: true },
      { dim: 'test', outcomeId: 'test-b', passed: true },
    ]);
    const sEmpty = computeDerivedScore(dim, empty);
    const sPartial = computeDerivedScore(dim, partial);
    const sMore = computeDerivedScore(dim, more);
    const sAll = computeDerivedScore(dim, all);
    assert.ok(sEmpty <= sPartial, `${sEmpty} <= ${sPartial}`);
    assert.ok(sPartial <= sMore, `${sPartial} <= ${sMore}`);
    assert.ok(sMore <= sAll, `${sMore} <= ${sAll}`);
    assert.equal(sAll, TIER_SCORE_CAPS.T2);
  });
});

// ── Diagnostics ──────────────────────────────────────────────────────────────

describe('computeDerivedScoreWithBreakdown', () => {
  it('returns the per-tier breakdown', () => {
    const dim = makeDim([
      makeOutcome('a', 'T1'),
      makeOutcome('b', 'T2'),
      makeOutcome('c', 'T2'),
    ]);
    const evidence = makeEvidence([
      { dim: 'test', outcomeId: 'a', passed: true },
      { dim: 'test', outcomeId: 'b', passed: true },
      { dim: 'test', outcomeId: 'c', passed: false },
    ]);
    const breakdown = computeDerivedScoreWithBreakdown(dim, evidence);
    assert.equal(breakdown.highestFullPassedTier, 'T1');
    assert.equal(breakdown.perTier.length, 2);
    assert.equal(breakdown.perTier[0]!.allPassing, true);
    assert.equal(breakdown.perTier[1]!.passing, 1);
    assert.equal(breakdown.perTier[1]!.declared, 2);
    assert.equal(breakdown.perTier[1]!.allPassing, false);
    assert.equal(breakdown.usedLegacyFallback, false);
  });

  it('flags legacy fallback when no outcomes declared', () => {
    const dim: DimensionForScoring = { id: 'test', legacy_score: 8.0 };
    const breakdown = computeDerivedScoreWithBreakdown(dim, new Map());
    assert.equal(breakdown.usedLegacyFallback, true);
    assert.equal(breakdown.legacyScoreUsed, 8.0);
    assert.equal(breakdown.score, 8.0);
  });
});

// ── hasOutcomes ──────────────────────────────────────────────────────────────

describe('hasOutcomes', () => {
  it('false when outcomes undefined', () => {
    assert.equal(hasOutcomes({ id: 'x' }), false);
  });
  it('false when outcomes empty array', () => {
    assert.equal(hasOutcomes({ id: 'x', outcomes: [] }), false);
  });
  it('true when outcomes has entries', () => {
    assert.equal(hasOutcomes({ id: 'x', outcomes: [makeOutcome('a', 'T1')] }), true);
  });
});

// ── The structural-proof test ────────────────────────────────────────────────
// This is the test that proves inflation is impossible. We construct a dim,
// imagine an agent claiming score 9.0 (would have been the inflation pattern),
// and assert that the derived score completely ignores that claim because the
// score is computed, not written.

describe('STRUCTURAL: inflation is impossible by construction', () => {
  it('an agent claim of 9.0 is silently ignored when only T1 outcome passes', () => {
    const dim: DimensionForScoring = {
      id: 'security',
      outcomes: [
        makeOutcome('compiles', 'T1'),
        makeOutcome('tests', 'T2'),
      ],
      // An agent SET this trying to inflate. The score-derivation IGNORES it.
      scores: { self: 9.0 },
      legacy_score: 9.0,
    };
    const evidence = makeEvidence([
      { dim: 'security', outcomeId: 'compiles', passed: true },
      { dim: 'security', outcomeId: 'tests', passed: false },
    ]);

    const derived = computeDerivedScore(dim, evidence);

    // Truth: only T1 passes, so the score is T1's cap regardless of what the agent wrote.
    assert.equal(derived, TIER_SCORE_CAPS.T1, 'derived score IGNORES the agent-written 9.0');
    assert.notEqual(derived, 9.0);
  });

  it('an agent attempt to "raise the score" without adding evidence does nothing', () => {
    const dim: DimensionForScoring = {
      id: 'security',
      outcomes: [makeOutcome('compiles', 'T1'), makeOutcome('tests', 'T2')],
      scores: { self: 5.0 },
    };
    const evidence = makeEvidence([
      { dim: 'security', outcomeId: 'compiles', passed: false },
      { dim: 'security', outcomeId: 'tests', passed: false },
    ]);

    // The agent "writes" 5.0 hoping it sticks. But evidence is all-failing.
    // Derived score: 0 (no outcome passes).
    assert.equal(computeDerivedScore(dim, evidence), 0);
  });

  it('the only way to raise the score is to make outcomes pass', () => {
    const dim: DimensionForScoring = {
      id: 'security',
      outcomes: [makeOutcome('compiles', 'T1'), makeOutcome('tests', 'T2')],
    };

    // Run 1: nothing passes
    let score = computeDerivedScore(dim, makeEvidence([
      { dim: 'security', outcomeId: 'compiles', passed: false },
      { dim: 'security', outcomeId: 'tests', passed: false },
    ]));
    assert.equal(score, 0, 'starts at 0');

    // Run 2: make compiles pass
    score = computeDerivedScore(dim, makeEvidence([
      { dim: 'security', outcomeId: 'compiles', passed: true },
      { dim: 'security', outcomeId: 'tests', passed: false },
    ]));
    assert.equal(score, TIER_SCORE_CAPS.T1, 'compiles passing unlocks T1 cap');

    // Run 3: make tests pass too
    score = computeDerivedScore(dim, makeEvidence([
      { dim: 'security', outcomeId: 'compiles', passed: true },
      { dim: 'security', outcomeId: 'tests', passed: true },
    ]));
    assert.equal(score, TIER_SCORE_CAPS.T2, 'tests passing unlocks T2 cap');

    // To go higher, the dim must DECLARE a T3+ outcome AND make it pass.
    // The agent cannot just claim a higher number.
  });

  it('T7 with 3 outcomes all pointing to the same test file cannot reach 9.0', () => {
    // Regression: extractPrimaryTestFiles regex must correctly detect shared receipts.
    // Three outcomes referencing shared.test.ts = one receipt, not three.
    // Use cli-smoke kind (maxScore=8.5 ≥ T5 cap 8.0) so T5 outcomes pass quality gate.
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js run tests/shared.test.ts' }),
        makeOutcome('o2', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js validate tests/shared.test.ts' }),
        makeOutcome('o7', 'T7', { kind: 'runtime-exec', command: 'node dist/index.js e2e tests/shared.test.ts' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true },
      { dim: 'testing', outcomeId: 'o2', passed: true },
      { dim: 'testing', outcomeId: 'o7', passed: true },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.ok(score < 9.0, `Expected < 9.0 for shared-receipt T7, got ${score}`);
  });

  it('T7 with 2 distinct test files can reach 9.0', () => {
    // Complement to above: genuine multi-receipt (distinct files) must unlock T7.
    // a.test.ts and b.test.ts are distinct → uniqueFiles.size=2 ≥ 2.
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js run tests/a.test.ts' }),
        makeOutcome('o2', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js validate tests/b.test.ts' }),
        makeOutcome('o7', 'T7', { kind: 'runtime-exec', command: 'node dist/index.js e2e tests/a.test.ts tests/b.test.ts' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true },
      { dim: 'testing', outcomeId: 'o2', passed: true },
      { dim: 'testing', outcomeId: 'o7', passed: true },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.equal(score, TIER_SCORE_CAPS.T7, `Expected T7 cap (${TIER_SCORE_CAPS.T7}) for genuine multi-receipt, got ${score}`);
  });

  it('T7 with 3 outcomes all from the same validate session cannot reach 9.0', () => {
    // Session-ID temporal separation: even with 3 distinct test files, if all
    // evidence shares the same session_id, T7 structural veto fires.
    // This proves a single `danteforge validate` run cannot self-certify at T7.
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js run tests/a.test.ts' }),
        makeOutcome('o2', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js validate tests/b.test.ts' }),
        makeOutcome('o7', 'T7', { kind: 'runtime-exec', command: 'node dist/index.js e2e tests/c.test.ts' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true, sessionId: 'session-A' },
      { dim: 'testing', outcomeId: 'o2', passed: true, sessionId: 'session-A' },
      { dim: 'testing', outcomeId: 'o7', passed: true, sessionId: 'session-A' },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.ok(score < 9.0, `Expected < 9.0 for single-session T7, got ${score}`);
  });

  it('T7 with outcomes spanning 2 validate sessions can reach 9.0', () => {
    // Complement: when evidence spans two different sessions the temporal
    // separation check passes, unlocking T7. The builder and verifier are
    // structurally different processes.
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js run tests/a.test.ts' }),
        makeOutcome('o2', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js validate tests/b.test.ts' }),
        makeOutcome('o7', 'T7', { kind: 'runtime-exec', command: 'node dist/index.js e2e tests/c.test.ts' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true, sessionId: 'session-A' },
      { dim: 'testing', outcomeId: 'o2', passed: true, sessionId: 'session-A' },
      { dim: 'testing', outcomeId: 'o7', passed: true, sessionId: 'session-B' },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.equal(score, TIER_SCORE_CAPS.T7, `Expected T7 cap for multi-session evidence, got ${score}`);
  });

  it('T7 with 3 byte-identical CLONED commands cannot reach 9.0 (grading-integrity #2)', () => {
    // The product-run command carries no test file, so extractTestFiles returns [] → the file-diversity
    // veto is SKIPPED; distinct sessions defeat the session veto. ONLY the distinct-command veto can
    // catch this — and it must: one command cloned N times is not multi-receipt consensus.
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'runtime-exec', command: 'node dist/index.js teach' }),
        makeOutcome('o2', 'T5', { kind: 'runtime-exec', command: 'node dist/index.js teach' }),
        makeOutcome('o7', 'T7', { kind: 'runtime-exec', command: 'node dist/index.js teach' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true, sessionId: 'session-A' },
      { dim: 'testing', outcomeId: 'o2', passed: true, sessionId: 'session-B' },
      { dim: 'testing', outcomeId: 'o7', passed: true, sessionId: 'session-C' },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.ok(score < 9.0, `one command cloned 3× must not reach T7; got ${score}`);
  });

  it('T7 with 3 DISTINCT product-run commands reaches 9.0 (genuine breadth of capability)', () => {
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'runtime-exec', command: 'node dist/index.js teach alpha' }),
        makeOutcome('o2', 'T5', { kind: 'runtime-exec', command: 'node dist/index.js reflect beta' }),
        makeOutcome('o7', 'T7', { kind: 'runtime-exec', command: 'node dist/index.js compact gamma' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true, sessionId: 'session-A' },
      { dim: 'testing', outcomeId: 'o2', passed: true, sessionId: 'session-B' },
      { dim: 'testing', outcomeId: 'o7', passed: true, sessionId: 'session-C' },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.equal(score, TIER_SCORE_CAPS.T7, `3 distinct commands = genuine consensus; got ${score}`);
  });

  it('community_adoption is hard-capped at 5.0 regardless of passing outcomes', () => {
    const dim: DimensionForScoring = {
      id: 'community_adoption',
      outcomes: [
        makeOutcome('install', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js --version' }),
      ],
    };
    const evidence = makeEvidence([{ dim: 'community_adoption', outcomeId: 'install', passed: true }]);
    const score = computeDerivedScore(dim, evidence);
    assert.ok(score <= 5.0, `Expected ≤ 5.0 for market dim, got ${score}`);
  });

  it('T7 with INFERRED-only evidence pool cannot reach 9.0', () => {
    // All three outcomes tagged INFERRED → anyInferred=true for every T5+ tier.
    // No EXTRACTED tier can satisfy the T7 highTierPassCount minimum → structural veto.
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js run tests/a.test.ts' }),
        makeOutcome('o2', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js validate tests/b.test.ts' }),
        makeOutcome('o7', 'T7', { kind: 'runtime-exec', command: 'node dist/index.js e2e tests/c.test.ts' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true, sessionId: 'A', evidenceQuality: 'INFERRED' },
      { dim: 'testing', outcomeId: 'o2', passed: true, sessionId: 'A', evidenceQuality: 'INFERRED' },
      { dim: 'testing', outcomeId: 'o7', passed: true, sessionId: 'B', evidenceQuality: 'INFERRED' },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.ok(score < 9.0, `Expected < 9.0 for INFERRED-only T7 pool, got ${score}`);
  });

  it('T7 with all EXTRACTED evidence can reach 9.0 (INFERRED gate does not block clean evidence)', () => {
    // Two EXTRACTED T5 + one EXTRACTED T7, two sessions → T7 consensus met → 9.0.
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js run tests/a.test.ts' }),
        makeOutcome('o2', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js validate tests/b.test.ts' }),
        makeOutcome('o7', 'T7', { kind: 'runtime-exec', command: 'node dist/index.js e2e tests/c.test.ts' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true, sessionId: 'A', evidenceQuality: 'EXTRACTED' },
      { dim: 'testing', outcomeId: 'o2', passed: true, sessionId: 'A', evidenceQuality: 'EXTRACTED' },
      { dim: 'testing', outcomeId: 'o7', passed: true, sessionId: 'B', evidenceQuality: 'EXTRACTED' },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.equal(score, TIER_SCORE_CAPS.T7, `Expected T7 cap for EXTRACTED evidence pool, got ${score}`);
  });

  it('INFERRED T5 evidence still earns T5 partial credit (INFERRED does not zero lower tiers)', () => {
    // Two T5 outcomes passing with INFERRED quality: no T7 declared → score is T5 cap, not 0.
    // INFERRED only blocks T7 consensus counting; it does not block T5 allPassing.
    const dim: DimensionForScoring = {
      id: 'testing',
      outcomes: [
        makeOutcome('o1', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js run tests/a.test.ts' }),
        makeOutcome('o2', 'T5', { kind: 'cli-smoke', command: 'node dist/index.js validate tests/b.test.ts' }),
      ],
    };
    const evidence = makeEvidence([
      { dim: 'testing', outcomeId: 'o1', passed: true, sessionId: 'A', evidenceQuality: 'INFERRED' },
      { dim: 'testing', outcomeId: 'o2', passed: true, sessionId: 'A', evidenceQuality: 'INFERRED' },
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.equal(score, TIER_SCORE_CAPS.T5, `Expected T5 cap for INFERRED T5 evidence, got ${score}`);
  });
});
