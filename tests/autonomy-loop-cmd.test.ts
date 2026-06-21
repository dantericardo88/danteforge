import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAutonomyLoopCommand, parseRateFromReceipt } from '../src/cli/commands/autonomy-loop.ts';

test('CH-058: parseRateFromReceipt reads the continuous resolve rate from a CR receipt (not binary)', () => {
  assert.equal(parseRateFromReceipt('grading…\n{"pass_rate":0.1,"resolved":2,"total":20}'), 0.1);
  assert.equal(parseRateFromReceipt('{"pass_rate":0.3,"resolved":3,"total":10}'), 0.3);
  assert.equal(parseRateFromReceipt('no rate here'), null, 'absent → null (dim not counted), never a crash');
  assert.equal(parseRateFromReceipt(''), null);
  // continuity: a higher rate (CH-051 improving the solver) reads higher → the loop climbs
  assert.ok((parseRateFromReceipt('{"pass_rate":0.3}') ?? 0) > (parseRateFromReceipt('{"pass_rate":0.1}') ?? 0));
});

// The driver wires runAutonomousLoop to real deps; these pins exercise the wiring via the _measureGrounding /
// _runCycle seams (no matrix/Docker), confirming it climbs a moving gradient and stops+decomposes at a ceiling.

test('autonomy-loop driver: a MOVING grounding gradient → the loop keeps climbing', async () => {
  let g = 0;
  const summary = await runAutonomyLoopCommand({
    _measureGrounding: async () => (g += 0.1), // grounding rises every cycle (the solver improving)
    _runCycle: async () => {},
    maxCycles: 3, ceilingPatience: 2, json: true,
  });
  assert.equal(summary.status, 'stopped');
  assert.equal(summary.ceilingHit, false, 'a moving gradient is not a ceiling — it stops on the cycle cap');
  assert.ok(summary.groundingEnd > summary.groundingStart, 'the loop climbed a real gradient');
});

test('autonomy-loop driver: a FLAT gradient (0% grounded, dry) → honest ceiling + decomposition', async () => {
  const summary = await runAutonomyLoopCommand({
    _measureGrounding: async () => 0,   // nothing grounded, no progress (today's real state until the receipt)
    _runCycle: async () => {},          // dry build step
    maxCycles: 10, ceilingPatience: 2, json: true,
  });
  assert.equal(summary.status, 'stopped');
  assert.equal(summary.ceilingHit, true, 'no movement → honest capability ceiling');
  // The ceiling is decomposed or escalated — never a bare wall.
  assert.ok(['decomposed', 'escalated'].includes(summary.ceilingDecomposition?.resolution.kind ?? ''),
    'the ceiling becomes a worklist (or escalation), not a wall');
});
