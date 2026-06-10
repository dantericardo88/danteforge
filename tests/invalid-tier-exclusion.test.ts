// invalid-tier-exclusion.test.ts — adversarial-review finding 2 regression.
//
// The demote-not-annihilate path must never PROMOTE: an outcome with a missing/invalid tier has
// no honest claim level, and routing it through demotion would bucket it at the highest tier its
// kind supports (bare shell → T5/8.0) — i.e. omitting `tier` would out-earn declaring one.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDerivedScoreWithBreakdown } from '../src/core/derived-score.js';
import type { OutcomeEvidence, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';

function passingEvidence(dim: string, id: string): [string, OutcomeEvidenceEntry] {
  return [`${dim}/${id}`, {
    dimensionId: dim, outcomeId: id, tier: 'T5', gitSha: null,
    passed: true, exitCode: 0, durationMs: 1500,
    timestamp: new Date().toISOString(), command: 'node src/index.mjs run',
  } as unknown as OutcomeEvidenceEntry];
}

describe('invalid/missing tier → EXCLUDED, never promoted', () => {
  for (const badTier of [undefined, 'T99', 't5', '']) {
    test(`tier=${JSON.stringify(badTier)} earns NOTHING (and is surfaced in demotions)`, () => {
      const evidence: OutcomeEvidence = new Map([passingEvidence('d', 'o1')]);
      const r = computeDerivedScoreWithBreakdown(
        { id: 'd', declared_ceiling: 'T5',
          outcomes: [{ id: 'o1', tier: badTier, kind: 'shell', description: 'x',
            check: { type: 'shell', command: 'node src/index.mjs run' } }] as never },
        evidence,
      );
      assert.ok(r.score <= 1.0, `invalid tier must not earn credit, derived ${r.score}`);
      assert.equal(r.demotions.length, 1, 'the exclusion is surfaced for diagnostics');
      assert.match(r.demotions[0]!.reason, /invalid or missing tier/);
    });
  }

  test('a VALID tier with the same evidence still earns (the guard is tier-validity, not a new cap)', () => {
    const evidence: OutcomeEvidence = new Map([passingEvidence('d', 'o1')]);
    const r = computeDerivedScoreWithBreakdown(
      { id: 'd', declared_ceiling: 'T5',
        outcomes: [{ id: 'o1', tier: 'T4', kind: 'shell', description: 'x',
          check: { type: 'shell', command: 'node src/index.mjs run' } }] as never },
      evidence,
    );
    assert.ok(r.score >= 6.9, `valid T4 with passing evidence should earn ~7.0, got ${r.score}`);
  });
});
