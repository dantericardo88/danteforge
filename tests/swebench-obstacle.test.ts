import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graderEnvMismatchObstacle, graderEnvMismatchChildren } from '../src/matrix/engines/swebench-obstacle.ts';
import { decomposeOrEscalate } from '../src/core/obstacle-decomposition.ts';

test('graderEnvMismatchObstacle carries the instance + regressions in context', () => {
  const o = graderEnvMismatchObstacle('cfn-lint-3798', ['t1', 't2']);
  assert.equal(o.kind, 'grader-env-mismatch');
  assert.deepEqual((o.context as { regressions: string[] }).regressions, ['t1', 't2']);
});

test('the decomposition is >=2 DEFINED children, ranked with test-in-grader-image first', () => {
  const kids = graderEnvMismatchChildren();
  assert.ok(kids.length >= 2);
  assert.equal(kids[0]!.kind, 'test-in-grader-image', 'the executable env-matched oracle is the highest-leverage child');
  for (const k of kids) {
    assert.ok(k.signal.length >= 20 && k.rationale.length >= 20, 'each child is a real DEFINED problem, not a label');
  }
});

test('the obstacle decomposes (never a wall) through decomposeOrEscalate', async () => {
  const receipt = await decomposeOrEscalate(
    { solved: false, obstacle: graderEnvMismatchObstacle('x'), attempted: [], ceiling: 'env mismatch' },
    { proposeChildren: graderEnvMismatchChildren },
  );
  assert.equal(receipt.resolution.kind, 'decomposed');
});
