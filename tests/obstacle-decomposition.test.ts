import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeOrEscalate, solveProblemTree, WallError, type ChildObstacle } from '../src/core/obstacle-decomposition.ts';
import type { SolveResult, Obstacle } from '../src/core/obstacle-registry.ts';

const obstacle = (kind: string, signal = 's'): Obstacle => ({ kind, signal });
const unsolved = (kind: string, ceiling = 'stuck'): SolveResult => ({ solved: false, obstacle: obstacle(kind), attempted: [], ceiling });
const solved = (kind: string): SolveResult => ({
  solved: true, obstacle: obstacle(kind),
  attempted: [{ solution: 'x', blastRadius: 'local-only', outcome: 'applied', detail: 'ok' }],
});
const kids = (...names: string[]): ChildObstacle[] => names.map(n => ({ kind: n, signal: `do ${n}`, rationale: `sub-problem ${n}` }));

test('solved obstacle → a solved receipt', async () => {
  const r = await decomposeOrEscalate(solved('x'));
  assert.equal(r.resolution.kind, 'solved');
});

test('unsolved + >=2 children → DECOMPOSED (the doctrine: break it smaller)', async () => {
  const r = await decomposeOrEscalate(unsolved('x'), { proposeChildren: () => kids('a', 'b') });
  assert.equal(r.resolution.kind, 'decomposed');
  if (r.resolution.kind === 'decomposed') assert.equal(r.resolution.children.length, 2);
});

test('unsolved + only 1 child (< min 2) but an escalation → ESCALATED', async () => {
  const r = await decomposeOrEscalate(unsolved('x'), {
    proposeChildren: () => kids('a'),                 // one child is a rename, not a break-down
    escalate: () => ({ to: 'human', reason: 'decomposition exhausted' }),
  });
  assert.equal(r.resolution.kind, 'escalated');
});

test('unsolved + NEITHER children NOR escalation → WallError (no walls allowed)', async () => {
  await assert.rejects(() => decomposeOrEscalate(unsolved('x', 'the model just cannot')), WallError);
});

test('minChildren is clamped to >=2 (a single child never counts as a decomposition)', async () => {
  await assert.rejects(
    () => decomposeOrEscalate(unsolved('x'), { proposeChildren: () => kids('a'), minChildren: 1 }),
    WallError,
  );
});

test('solveProblemTree breaks a big problem into small ones until every leaf resolves', async () => {
  const summary = await solveProblemTree(obstacle('big'), {
    solve: async (o) => (o.kind === 'big' ? unsolved('big') : solved(o.kind)),
    proposeChildren: (r) => (r.obstacle.kind === 'big' ? kids('small-a', 'small-b') : []),
    maxDepth: 4, maxNodes: 32,
  });
  assert.equal(summary.nodes, 3, 'big + small-a + small-b');
  assert.equal(summary.solvedLeaves, 2);
  assert.equal(summary.escalatedLeaves, 0);
  assert.equal(summary.fullyResolved, true);
});

test('solveProblemTree escalates at the depth bound instead of decomposing forever', async () => {
  const summary = await solveProblemTree(obstacle('x'), {
    solve: async () => unsolved('x'),       // nothing ever solves
    proposeChildren: () => kids('a', 'b'),  // and everything proposes 2 children
    escalate: () => ({ to: 'human', reason: 'manual' }),
    maxDepth: 2, maxNodes: 100,
  });
  assert.ok(summary.escalatedLeaves > 0, 'bounded recursion escalates rather than spinning');
  assert.equal(summary.fullyResolved, false);
});

test('solveProblemTree respects the per-run node cap (anti-spam, always converges)', async () => {
  const summary = await solveProblemTree(obstacle('x'), {
    solve: async () => unsolved('x'),
    proposeChildren: () => kids('a', 'b', 'c'),
    escalate: () => ({ to: 'human', reason: 'cap' }),
    maxDepth: 50, maxNodes: 6,
  });
  assert.ok(summary.nodes <= 10, `converged near the cap, got ${summary.nodes} nodes`);
});
