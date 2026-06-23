import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFleetLanes, laneSummary } from '../src/core/frontier-queue.js';

test('build-complete dims (>=8.0) go to the FRONTIER queue; below go to the loopable BUILD lane', () => {
  const split = splitFleetLanes([
    { id: 'functionality', score: 7.0 },   // build lane (loopable)
    { id: 'security', score: 6.0 },        // build lane
    { id: 'planning', score: 8.0 },        // frontier queue (build-complete)
    { id: 'autonomy', score: 9.0 },        // frontier queue (court-validated)
  ]);
  assert.deepEqual(split.buildLane.map(b => b.dimId).sort(), ['functionality', 'security']);
  assert.deepEqual(split.frontierQueue.map(f => f.dimId).sort(), ['autonomy', 'planning']);
});

test('the FRONTIER queue is an external-anchor task list — never "build more"', () => {
  const split = splitFleetLanes([{ id: 'planning', score: 8.0 }]);
  const item = split.frontierQueue[0]!;
  assert.equal(item.anchorKind, 'benchmark-receipt');           // 8.0 -> next anchor is a dated benchmark receipt
  assert.match(item.anchorTask, /external anchor|benchmark|court/);
  assert.match(item.anchorTask, /not more code/);
});

test('an 8.5 (externally anchored) queues a court-validation task next', () => {
  const split = splitFleetLanes([{ id: 'x', score: 8.5 }]);
  assert.equal(split.frontierQueue[0]!.anchorKind, 'court-validation');
});

test('lanes are ordered for action: build lane lowest-first, frontier queue highest-first', () => {
  const split = splitFleetLanes([
    { id: 'a', score: 5.0 }, { id: 'b', score: 6.5 },
    { id: 'c', score: 8.0 }, { id: 'd', score: 9.0 },
  ]);
  assert.deepEqual(split.buildLane.map(b => b.dimId), ['a', 'b']);       // biggest tactical gap first
  assert.deepEqual(split.frontierQueue.map(f => f.dimId), ['d', 'c']);   // closest to a win first
});

test('laneSummary states both lanes', () => {
  const s = laneSummary(splitFleetLanes([{ id: 'a', score: 6 }, { id: 'b', score: 8 }]));
  assert.match(s, /BUILD lane/);
  assert.match(s, /FRONTIER queue/);
  assert.match(s, /1 dim/);
});
