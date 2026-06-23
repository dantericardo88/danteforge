// The AIDE-style climb loop: dispatch a builder toward the gap, re-evaluate the continuous score, keep only if
// it improved, climb until target. These pin the selection/termination logic with seams (no real agents).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runGradedClimb } from '../src/core/graded-climb.js';
import type { EvaluationResult } from '../src/core/graded-evaluator.js';

/** A seam eval that returns the next score in the sequence each call (the last value repeats). */
function evalSeq(scores: number[]): (c: string, cwd: string) => Promise<EvaluationResult> {
  let i = 0;
  return async () => ({ combinedScore: scores[Math.min(i++, scores.length - 1)]!, metrics: {}, artifacts: { detail: 'gap detail' }, ran: true });
}

describe('runGradedClimb — climb until target, keep only improving cycles (AIDE/OpenEvolve selection)', () => {
  test('improving each cycle reaches the target and records the trajectory', async () => {
    let dispatches = 0;
    const r = await runGradedClimb({
      dimId: 'mao', evaluatorCommand: 'x', cwd: '/tmp', target: 0.9, maxCycles: 5,
      _eval: evalSeq([0.5, 0.7, 0.9]), _dispatch: async () => { dispatches++; },
    });
    assert.equal(r.reachedTarget, true);
    assert.equal(r.startScore, 0.5);
    assert.equal(r.finalScore, 0.9);
    assert.equal(r.stoppedReason, 'reached-target');
    assert.equal(dispatches, 2, 'two builder dispatches lifted 0.5 → 0.7 → 0.9');
    assert.equal(r.trajectory.every(s => s.kept), true);
  });

  test('a dim ALREADY at target does not dispatch a builder', async () => {
    let dispatches = 0;
    const r = await runGradedClimb({
      dimId: 'mao', evaluatorCommand: 'x', cwd: '/tmp', target: 0.9,
      _eval: evalSeq([0.95]), _dispatch: async () => { dispatches++; },
    });
    assert.equal(dispatches, 0);
    assert.equal(r.reachedTarget, true);
    assert.equal(r.stoppedReason, 'reached-target');
  });

  test('NO gain in a cycle stops honestly (no budget grind) — the score is never silently lost', async () => {
    const r = await runGradedClimb({
      dimId: 'mao', evaluatorCommand: 'x', cwd: '/tmp', target: 0.9, maxCycles: 5,
      _eval: evalSeq([0.5, 0.5]), _dispatch: async () => {},
    });
    assert.equal(r.reachedTarget, false);
    assert.equal(r.finalScore, 0.5);
    assert.equal(r.stoppedReason, 'no-gain');
    assert.equal(r.trajectory.length, 1, 'one attempt, no gain → stop (DGM-archive is the future escape)');
  });

  test('a WORSE attempt is not kept — best score is preserved (keep-if-better)', async () => {
    const r = await runGradedClimb({
      dimId: 'mao', evaluatorCommand: 'x', cwd: '/tmp', target: 0.9, maxCycles: 5,
      _eval: evalSeq([0.6, 0.4]), _dispatch: async () => {},
    });
    assert.equal(r.finalScore, 0.6, 'a regression is discarded; the best stands');
    assert.equal(r.stoppedReason, 'no-gain');
  });

  test('a dispatch failure stops with dispatch-failed (never a fabricated gain)', async () => {
    const r = await runGradedClimb({
      dimId: 'mao', evaluatorCommand: 'x', cwd: '/tmp', target: 0.9, maxCycles: 5,
      _eval: evalSeq([0.5]), _dispatch: async () => { throw new Error('agents unavailable'); },
    });
    assert.equal(r.stoppedReason, 'dispatch-failed');
    assert.equal(r.reachedTarget, false);
    assert.equal(r.trajectory[0]!.dispatched, false);
  });

  test('max-cycles bounds the climb even if still improving', async () => {
    const r = await runGradedClimb({
      dimId: 'mao', evaluatorCommand: 'x', cwd: '/tmp', target: 0.99, maxCycles: 2,
      _eval: evalSeq([0.5, 0.6, 0.7, 0.8]), _dispatch: async () => {},
    });
    assert.equal(r.trajectory.length, 2);
    assert.equal(r.reachedTarget, false);
    assert.equal(r.stoppedReason, 'max-cycles');
  });
});
