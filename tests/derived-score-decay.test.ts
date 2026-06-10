// Tests for score decay in computeDerivedScoreWithBreakdown.
// Score decay: when `now` is passed, evidence older than TIER_FRESHNESS_MS[tier]
// is treated as not-passing. This prevents stale claims from contributing to
// the derived score without requiring a re-run.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDerivedScore,
  computeDerivedScoreWithBreakdown,
  type DimensionForScoring,
} from '../src/core/derived-score.js';
import { TIER_SCORE_CAPS, TIER_FRESHNESS_MS } from '../src/matrix/types/capability-test.js';
import {
  makeEvidenceKey,
  type Outcome,
  type OutcomeEvidence,
  type OutcomeEvidenceEntry,
} from '../src/matrix/types/outcome.js';

function makeOutcome(id: string, tier: Outcome['tier'], opts: Partial<Outcome> = {}): Outcome {
  return { id, tier, description: `outcome ${id}`, command: `echo ${id}`, ...opts } as Outcome;
}

function makeDim(outcomes: Outcome[]): DimensionForScoring {
  return { id: 'test', outcomes };
}

function makeEntry(outcomeId: string, tier: Outcome['tier'], passed: boolean, ranAt: string): OutcomeEvidenceEntry {
  return {
    dimensionId: 'test', outcomeId, tier, gitSha: 'abc',
    passed, exitCode: passed ? 0 : 1, durationMs: 100,
    stdoutTail: '', stderrTail: '', ranAt, evidencePath: '/fake',
  };
}

function makeEvidenceMap(entries: OutcomeEvidenceEntry[]): OutcomeEvidence {
  const map: OutcomeEvidence = new Map();
  for (const e of entries) map.set(makeEvidenceKey(e.dimensionId, e.outcomeId), e);
  return map;
}

function agoMs(base: Date, ms: number): string {
  return new Date(base.getTime() - ms).toISOString();
}

describe('score decay — now=undefined disables staleness (backward compat)', () => {
  it('old T5 evidence counts as passing when now is not passed', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const veryOldRanAt = agoMs(now, 30 * 24 * 60 * 60 * 1000);
    const dim = makeDim([makeOutcome('a', 'T5')]);
    const evidence = makeEvidenceMap([makeEntry('a', 'T5', true, veryOldRanAt)]);
    const score = computeDerivedScore(dim, evidence);
    assert.equal(score, TIER_SCORE_CAPS.T5, 'stale check disabled without now param');
  });
});

describe('score decay — fresh evidence always passes', () => {
  it('evidence 1 hour old at T5 (7d window) is not stale', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const dim = makeDim([makeOutcome('a', 'T5')]);
    const evidence = makeEvidenceMap([makeEntry('a', 'T5', true, agoMs(now, 60 * 60 * 1000))]);
    assert.equal(computeDerivedScore(dim, evidence, now), TIER_SCORE_CAPS.T5);
  });

  it('evidence 6 days old at T5 (7d window) is not stale', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const dim = makeDim([makeOutcome('a', 'T5')]);
    const evidence = makeEvidenceMap([makeEntry('a', 'T5', true, agoMs(now, 6 * 24 * 60 * 60 * 1000))]);
    assert.equal(computeDerivedScore(dim, evidence, now), TIER_SCORE_CAPS.T5);
  });
});

describe('score decay — stale evidence treated as not-passing', () => {
  it('T5 evidence 8 days old drops score to T4 cap', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const dim = makeDim([makeOutcome('t4', 'T4'), makeOutcome('t5', 'T5')]);
    const evidence = makeEvidenceMap([
      makeEntry('t4', 'T4', true, agoMs(now, 60 * 60 * 1000)),
      makeEntry('t5', 'T5', true, agoMs(now, 8 * 24 * 60 * 60 * 1000)),
    ]);
    assert.equal(computeDerivedScore(dim, evidence, now), TIER_SCORE_CAPS.T4);
  });

  it('T7 evidence 8 days old drops score to T5 cap', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const fresh = agoMs(now, 60 * 60 * 1000);
    // The T7 fixture must be genuinely T7-capable (runtime-exec + real-user-path,
    // quality maxScore 9.0). A generic shell command (maxScore 8.0) would now be
    // DEMOTED into the T5 bucket and staleness-checked there, which is not what
    // this test exercises — it isolates decay of a real T7 receipt.
    const dim = makeDim([
      makeOutcome('t5a', 'T5'), makeOutcome('t5b', 'T5'), makeOutcome('t5c', 'T5'),
      makeOutcome('t7', 'T7', {
        kind: 'runtime-exec',
        command: 'node dist/index.js e2e fixtures/sample',
        input_source: { type: 'real-user-path', description: 'genuine t7 run' },
      } as Partial<Outcome>),
    ]);
    const evidence = makeEvidenceMap([
      makeEntry('t5a', 'T5', true, fresh), makeEntry('t5b', 'T5', true, fresh),
      makeEntry('t5c', 'T5', true, fresh),
      makeEntry('t7', 'T7', true, agoMs(now, 8 * 24 * 60 * 60 * 1000)),
    ]);
    assert.equal(computeDerivedScore(dim, evidence, now), TIER_SCORE_CAPS.T5);
  });

  it('all evidence stale → score = 0', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const stale = agoMs(now, 30 * 24 * 60 * 60 * 1000);
    const dim = makeDim([makeOutcome('a', 'T5'), makeOutcome('b', 'T5')]);
    const evidence = makeEvidenceMap([
      makeEntry('a', 'T5', true, stale), makeEntry('b', 'T5', true, stale),
    ]);
    assert.equal(computeDerivedScore(dim, evidence, now), 0);
  });
});

describe('score decay — breakdown includes stale counts', () => {
  it('perTier.stale counts stale outcomes accurately', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const dim = makeDim([makeOutcome('t5a', 'T5'), makeOutcome('t5b', 'T5'), makeOutcome('t5c', 'T5')]);
    const evidence = makeEvidenceMap([
      makeEntry('t5a', 'T5', true, agoMs(now, 60 * 60 * 1000)),
      makeEntry('t5b', 'T5', true, agoMs(now, 8 * 24 * 60 * 60 * 1000)),
      makeEntry('t5c', 'T5', true, agoMs(now, 8 * 24 * 60 * 60 * 1000)),
    ]);
    const breakdown = computeDerivedScoreWithBreakdown(dim, evidence, now);
    const t5row = breakdown.perTier.find(r => r.tier === 'T5');
    assert.ok(t5row, 'T5 row should exist');
    assert.equal(t5row!.declared, 3);
    assert.equal(t5row!.passing, 1);
    assert.equal(t5row!.stale, 2);
    assert.equal(t5row!.allPassing, false);
  });

  it('perTier.stale is 0 when now is not passed', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const dim = makeDim([makeOutcome('a', 'T5')]);
    const evidence = makeEvidenceMap([makeEntry('a', 'T5', true, agoMs(now, 8 * 24 * 60 * 60 * 1000))]);
    const breakdown = computeDerivedScoreWithBreakdown(dim, evidence);
    const t5row = breakdown.perTier.find(r => r.tier === 'T5');
    assert.equal(t5row?.stale ?? 0, 0, 'stale should be 0 when now not provided');
  });
});

describe('score decay — T0 evidence never expires', () => {
  it('T0 evidence 1000 days old is not stale (POSITIVE_INFINITY window)', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    assert.equal(Number.isFinite(TIER_FRESHNESS_MS.T0), false);
    const dim = makeDim([makeOutcome('a', 'T0')]);
    const evidence = makeEvidenceMap([makeEntry('a', 'T0', true, agoMs(now, 1000 * 24 * 60 * 60 * 1000))]);
    assert.equal(computeDerivedScore(dim, evidence, now), TIER_SCORE_CAPS.T0);
  });
});
