// self-healing-advisor.test.ts — Unit tests for recommendHealingAction.
// All functions are pure — no mocking needed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConvergenceState,
  recordConvergenceSnapshot,
  type ConvergenceState,
} from '../src/core/convergence-tracker.js';
import {
  recommendHealingAction,
  type HealingAction,
} from '../src/core/self-healing-advisor.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a state with N recorded snapshots of given scores. */
function buildState(
  scores: number[],
  start = 6.0,
  target = 9.0,
  dimension = 'test-dim',
): ConvergenceState {
  let state = createConvergenceState(dimension, start, target);
  for (const s of scores) {
    state = recordConvergenceSnapshot(state, s, '2026-05-14T00:00:00Z');
  }
  return state;
}

/** Build a state that has exactly `plateaus` consecutive plateau cycles ending at `score`. */
function buildPlateauState(plateaus: number, score: number, target = 9.0): ConvergenceState {
  // Use tiny deltas (< 0.1) so each cycle counts as plateau.
  const scores: number[] = [];
  for (let i = 0; i < plateaus; i++) {
    scores.push(score + i * 0.01);
  }
  // The final score — last entry in scores should equal the target score we report.
  // Reset so the final value is exactly `score`.
  const adjustedScores = Array.from({ length: plateaus }, (_, i) =>
    score + (i - plateaus + 1) * 0.01,
  );
  return buildState(adjustedScores, score - 0.02, target);
}

// ── accept-ceiling ────────────────────────────────────────────────────────────

describe('recommendHealingAction — accept-ceiling', () => {
  it('recommends accept-ceiling when plateauCount >= 5 and score >= 8.5', () => {
    // 5 plateau cycles near 9.0
    const state = buildPlateauState(5, 8.9, 9.5);
    const rec = recommendHealingAction(state);
    assert.equal(rec.action, 'accept-ceiling' satisfies HealingAction);
  });

  it('urgency is low for accept-ceiling', () => {
    const state = buildPlateauState(5, 8.9, 9.5);
    const rec = recommendHealingAction(state);
    assert.equal(rec.urgency, 'low');
  });

  it('includes competitor note when competitorMax is provided and score >= competitorMax', () => {
    const state = buildPlateauState(5, 8.9, 9.5);
    const rec = recommendHealingAction(state, { competitorMax: 8.5 });
    assert.ok(rec.rationale.includes('competitor') || rec.rationale.includes('No competitor'));
  });

  it('does NOT recommend accept-ceiling when plateauCount < 5', () => {
    const state = buildPlateauState(4, 8.9, 9.5);
    const rec = recommendHealingAction(state);
    assert.notEqual(rec.action, 'accept-ceiling');
  });
});

// ── restart-dimension ─────────────────────────────────────────────────────────

describe('recommendHealingAction — restart-dimension', () => {
  it('recommends restart-dimension when plateauCount >= 3 and score < 7.0', () => {
    // 3 plateau cycles around 6.5
    const state = buildPlateauState(3, 6.5, 9.0);
    const rec = recommendHealingAction(state);
    assert.equal(rec.action, 'restart-dimension');
  });

  it('urgency is high for restart-dimension', () => {
    const state = buildPlateauState(3, 6.5, 9.0);
    const rec = recommendHealingAction(state);
    assert.equal(rec.urgency, 'high');
  });

  it('does NOT recommend restart when score >= 7.0', () => {
    const state = buildPlateauState(3, 7.5, 9.0);
    const rec = recommendHealingAction(state);
    assert.notEqual(rec.action, 'restart-dimension');
  });
});

// ── harvest-more ──────────────────────────────────────────────────────────────

describe('recommendHealingAction — harvest-more', () => {
  it('recommends harvest-more when plateauCount >= 2 and 7.0 <= score < 8.5', () => {
    // 2 plateau cycles at 7.5
    const state = buildPlateauState(2, 7.5, 9.0);
    const rec = recommendHealingAction(state);
    assert.equal(rec.action, 'harvest-more');
  });

  it('urgency is medium for harvest-more', () => {
    const state = buildPlateauState(2, 7.5, 9.0);
    const rec = recommendHealingAction(state);
    assert.equal(rec.urgency, 'medium');
  });
});

// ── adversarial-rebase ────────────────────────────────────────────────────────

describe('recommendHealingAction — adversarial-rebase', () => {
  it('recommends adversarial-rebase when velocity is very low (< 0.05)', () => {
    // Single snapshot with minimal improvement from start → velocity near 0
    // Start 7.0, score 7.02 → delta = 0.02, velocity = 0.02/1 = 0.02
    const state = buildState([7.02], 7.0, 9.0);
    const rec = recommendHealingAction(state);
    assert.equal(rec.action, 'adversarial-rebase');
  });

  it('urgency is medium for adversarial-rebase', () => {
    const state = buildState([7.02], 7.0, 9.0);
    const rec = recommendHealingAction(state);
    assert.equal(rec.urgency, 'medium');
  });
});

// ── expand-search (default) ───────────────────────────────────────────────────

describe('recommendHealingAction — expand-search (default)', () => {
  it('recommends expand-search when no critical condition is met', () => {
    // Good velocity, no plateau, not stuck
    const state = buildState([7.5, 8.0, 8.5], 7.0, 9.0);
    const rec = recommendHealingAction(state);
    assert.equal(rec.action, 'expand-search');
  });

  it('urgency is low for expand-search', () => {
    const state = buildState([7.5, 8.0, 8.5], 7.0, 9.0);
    const rec = recommendHealingAction(state);
    assert.equal(rec.urgency, 'low');
  });

  it('rationale is a non-empty string', () => {
    const state = buildState([7.5, 8.0, 8.5], 7.0, 9.0);
    const rec = recommendHealingAction(state);
    assert.ok(typeof rec.rationale === 'string' && rec.rationale.length > 0);
  });
});
