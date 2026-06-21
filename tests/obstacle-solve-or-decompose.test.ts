import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveOrDecompose } from '../src/core/obstacle-solve-or-decompose.ts';
import { WallError } from '../src/core/obstacle-decomposition.ts';
import type { Obstacle } from '../src/core/obstacle-registry.ts';

const o: Obstacle = { kind: 'x', signal: 's' };

test('solveOrDecompose: a solvable obstacle → solved receipt, records nothing', async () => {
  let recorded = 0;
  const r = await solveOrDecompose(o, {
    _solve: async () => ({ solved: true, obstacle: o, attempted: [] }),
    _record: async () => { recorded++; return []; },
    cwd: '/tmp',
  });
  assert.equal(r.resolution.kind, 'solved');
  assert.equal(recorded, 0, 'a solved obstacle produces no ledger noise');
});

test('solveOrDecompose: an unsolved obstacle decomposes AND records children to the ledger', async () => {
  let recordedKinds: string[] = [];
  const r = await solveOrDecompose({ kind: 'wall', signal: 'stuck' }, {
    _solve: async () => ({ solved: false, obstacle: { kind: 'wall', signal: 'stuck' }, attempted: [], ceiling: 'hard' }),
    proposeChildren: () => [
      { kind: 'sub-a', signal: 'do a precisely', rationale: 'because a is a real sub-problem' },
      { kind: 'sub-b', signal: 'do b precisely', rationale: 'because b is a real sub-problem' },
    ],
    _record: async (rec) => {
      recordedKinds = rec.resolution.kind === 'decomposed' ? rec.resolution.children.map(c => c.kind) : [];
      return ['CH-100', 'CH-101'];
    },
    cwd: '/tmp',
  });
  assert.equal(r.resolution.kind, 'decomposed');
  assert.deepEqual(recordedKinds, ['sub-a', 'sub-b'], 'the child sub-problems were handed to the ledger');
});

test('solveOrDecompose: unsolved with NO children and NO escalation → WallError (a loop may not give up)', async () => {
  await assert.rejects(
    () => solveOrDecompose(o, { _solve: async () => ({ solved: false, obstacle: o, attempted: [], ceiling: 'stuck' }) }),
    WallError,
  );
});

test('solveOrDecompose: record:false skips the ledger even when decomposed (dry runs)', async () => {
  let recorded = 0;
  const r = await solveOrDecompose(o, {
    _solve: async () => ({ solved: false, obstacle: o, attempted: [], ceiling: 'hard' }),
    proposeChildren: () => [
      { kind: 'a', signal: 'do a precisely', rationale: 'real sub-problem a' },
      { kind: 'b', signal: 'do b precisely', rationale: 'real sub-problem b' },
    ],
    _record: async () => { recorded++; return []; },
    record: false, cwd: '/tmp',
  });
  assert.equal(r.resolution.kind, 'decomposed');
  assert.equal(recorded, 0);
});
