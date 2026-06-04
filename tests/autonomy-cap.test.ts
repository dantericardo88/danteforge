// autonomy-cap.test.ts — autonomous loops top out at 9.0; 10.0 is human-certified only.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampAutonomousTarget, resolveAutonomousTarget, MAX_AUTONOMOUS_TARGET } from '../src/core/autonomy-cap.js';

describe('clampAutonomousTarget', () => {
  it('caps any target above 9.0 to 9.0', () => {
    assert.equal(clampAutonomousTarget(10), 9.0);
    assert.equal(clampAutonomousTarget(9.5), 9.0);
    assert.equal(clampAutonomousTarget(100), 9.0);
  });
  it('leaves targets at or below 9.0 unchanged', () => {
    assert.equal(clampAutonomousTarget(9.0), 9.0);
    assert.equal(clampAutonomousTarget(7.0), 7.0);
    assert.equal(clampAutonomousTarget(5.0), 5.0);
  });
  it('treats a non-finite target as the ceiling', () => {
    assert.equal(clampAutonomousTarget(NaN), MAX_AUTONOMOUS_TARGET);
    assert.equal(clampAutonomousTarget(Infinity), MAX_AUTONOMOUS_TARGET);
  });
});

describe('resolveAutonomousTarget', () => {
  it('applies the fallback when no target is given', () => {
    assert.equal(resolveAutonomousTarget(undefined, 7.0), 7.0);
  });
  it('clamps a requested 10 down to the autonomous ceiling', () => {
    assert.equal(resolveAutonomousTarget(10, 9.0), 9.0);
  });
  it('clamps even a clamp-exceeding fallback (no loop can chase 10)', () => {
    assert.equal(resolveAutonomousTarget(undefined, 10), 9.0);
  });
});
