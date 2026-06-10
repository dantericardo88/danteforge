// market-dims-cap.test.ts — the token_economy cap-leak regression (one canonical contract).
//
// The market-cap set used to live as six hand-copied literals and drifted: the conductor capped
// token_economy at 5.0 while the scoring kernel let it derive 7.0. These tests pin every consumer
// to the single canonical module so the leak is structurally unrepeatable.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_CAPPED_DIMS, MARKET_DIM_MAX_SCORE } from '../src/core/market-dims.js';
import { clampDimScore, MARKET_DIMS_SCORE_CAP } from '../src/core/compete-matrix-score.js';
import { MARKET_CAPPED_DIMS as CONDUCTOR_DIMS } from '../src/matrix/engines/capability-test-conductor.js';
import { computeDerivedScore } from '../src/core/derived-score.js';
import type { OutcomeEvidence, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';

describe('market-cap contract — one canonical set, three dims', () => {
  it('the documented three meta-dimensions are all capped', () => {
    assert.deepEqual([...MARKET_CAPPED_DIMS].sort(),
      ['community_adoption', 'enterprise_readiness', 'token_economy']);
    assert.equal(MARKET_DIM_MAX_SCORE, 5.0);
  });

  it('every consumer references the SAME set object (drift is impossible)', () => {
    assert.equal(MARKET_DIMS_SCORE_CAP, MARKET_CAPPED_DIMS);
    assert.equal(CONDUCTOR_DIMS, MARKET_CAPPED_DIMS);
  });

  it('clampDimScore caps token_economy at 5.0 regardless of raw score or ceiling', () => {
    assert.equal(clampDimScore('token_economy', 9.0), 5.0);
    assert.equal(clampDimScore('token_economy', 7.0, 8.0), 5.0);
    assert.equal(clampDimScore('token_economy', 4.5), 4.5);
  });

  it('derived score for token_economy caps at 5.0 even with passing high-tier outcomes', () => {
    const evidence: OutcomeEvidence = new Map([
      ['token_economy/o1', {
        dimensionId: 'token_economy', outcomeId: 'o1', tier: 'T5', gitSha: null,
        passed: true, exitCode: 0, durationMs: 1500,
        timestamp: new Date().toISOString(), command: 'node dist/index.js budget-status',
      } as unknown as OutcomeEvidenceEntry],
    ]);
    const result = computeDerivedScore(
      { id: 'token_economy', declared_ceiling: 'T5',
        outcomes: [{ id: 'o1', tier: 'T5', kind: 'cli-smoke', description: 'budget status smoke',
          check: { type: 'shell', command: 'node dist/index.js budget-status' } }] as never },
      evidence,
    );
    assert.ok(result <= 5.0,
      `token_economy derived ${result} — must be market-capped at 5.0`);
  });
});
