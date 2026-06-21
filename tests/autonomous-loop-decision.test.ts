import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideLoopAction, type LoopCycleState } from '../src/core/autonomous-loop-decision.ts';

// A healthy mid-run cycle: panel convened, some budget left, under the cap, no movement yet, not stale.
const base = (): LoopCycleState => ({
  quorumMet: true,
  groundingBefore: 0.2, groundingAfter: 0.2,
  staleCycles: 1,
  tokensSpent: 100_000, tokenBudget: 1_000_000,
  cycle: 3, maxCycles: 20,
});

test('quorum not met → PAUSE (recoverable; never act on a degraded panel) — highest precedence', () => {
  // Even with budget gone AND ceiling hit, a degraded panel pauses rather than stops.
  const d = decideLoopAction({ ...base(), quorumMet: false, tokensSpent: 2_000_000, staleCycles: 99 });
  assert.equal(d.action, 'pause');
  assert.match(d.reason, /quorum/i);
});

test('budget exhausted → STOP (hard ceiling, even mid-progress)', () => {
  const d = decideLoopAction({ ...base(), tokensSpent: 1_000_000, groundingAfter: 0.9 /* would be progress */ });
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /budget/i);
  assert.notEqual(d.ceilingHit, true); // budget stop is NOT a capability ceiling
});

test('no budget set (null) never triggers the budget stop', () => {
  const d = decideLoopAction({ ...base(), tokenBudget: null, tokensSpent: 9_999_999, groundingAfter: 0.3 });
  assert.equal(d.action, 'continue');
});

test('cycle cap → STOP', () => {
  const d = decideLoopAction({ ...base(), cycle: 20, maxCycles: 20 });
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /max cycles/i);
});

test('grounding moved → CONTINUE (real external progress beats a stale counter)', () => {
  const d = decideLoopAction({ ...base(), groundingBefore: 0.2, groundingAfter: 0.25, staleCycles: 5 });
  assert.equal(d.action, 'continue');
  assert.match(d.reason, /moved|progress/i);
});

test('capability ceiling: staleCycles >= patience and no movement → STOP with ceilingHit', () => {
  const d = decideLoopAction({ ...base(), staleCycles: 3 }, { ceilingPatience: 3 });
  assert.equal(d.action, 'stop');
  assert.equal(d.ceilingHit, true);
  assert.match(d.reason, /capability ceiling/i);
});

test('within the patience window (stale < patience, no movement) → CONTINUE', () => {
  const d = decideLoopAction({ ...base(), staleCycles: 2 }, { ceilingPatience: 3 });
  assert.equal(d.action, 'continue');
  assert.match(d.reason, /retry|window/i);
});

test('budget precedence over capability ceiling (budget stop is not mislabeled a ceiling)', () => {
  const d = decideLoopAction({ ...base(), tokensSpent: 1_000_000, staleCycles: 10 });
  assert.equal(d.action, 'stop');
  assert.match(d.reason, /budget/i);
  assert.notEqual(d.ceilingHit, true);
});

test('ceilingPatience is configurable and floored at 1', () => {
  assert.equal(decideLoopAction({ ...base(), staleCycles: 1 }, { ceilingPatience: 1 }).action, 'stop');
  // a 0 / negative patience is clamped to 1 (a stale cycle still stops, never an infinite loop)
  assert.equal(decideLoopAction({ ...base(), staleCycles: 1 }, { ceilingPatience: 0 }).action, 'stop');
});
