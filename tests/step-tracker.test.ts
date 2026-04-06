import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStepTracker } from '../src/core/progress.js';

describe('StepTracker', () => {
  it('starts at step 0', () => {
    const tracker = createStepTracker(5, { _isTTY: false });
    assert.equal(tracker.current(), 0);
    assert.equal(tracker.total(), 5);
  });

  it('increments on each step call', () => {
    const tracker = createStepTracker(3, { _isTTY: false });
    tracker.step('First');
    assert.equal(tracker.current(), 1);
    tracker.step('Second');
    assert.equal(tracker.current(), 2);
  });

  it('does not exceed total', () => {
    const tracker = createStepTracker(2, { _isTTY: false });
    tracker.step('One');
    tracker.step('Two');
    tracker.step('Three');
    assert.equal(tracker.current(), 2);
  });

  it('updates active spinner when present', () => {
    // This test just verifies no error — spinner interaction tested via progress.test.ts
    const tracker = createStepTracker(3, { _isTTY: true });
    tracker.step('Test');
    assert.equal(tracker.current(), 1);
  });
});
