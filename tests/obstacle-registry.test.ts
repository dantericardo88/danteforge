import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerSolver, clearSolvers, findSolver, solveObstacle, type ObstacleSolver, type Solution, type Obstacle } from '../src/core/obstacle-registry.js';
import { makeSpawnFailureSolver } from '../src/core/solvers/spawn-failure-solver.js';

function sol(id: string, blastRadius: Solution['blastRadius'], confidence: number, ok: boolean): Solution {
  return { id, description: id, blastRadius, confidence, apply: async () => ({ ok, detail: id }) };
}
function solver(kind: string, sols: Solution[]): ObstacleSolver {
  return { kind, canSolve: (o) => o.kind === kind, proposeSolutions: async () => sols };
}
const obstacle = (kind: string, signal = ''): Obstacle => ({ kind, signal });

beforeEach(() => clearSolvers());

describe('obstacle-registry — the never-say-cant DNA', () => {
  test('no solver → needsMetaSolver (the missing solver IS the next sub-problem, not a dead stop)', async () => {
    const r = await solveObstacle(obstacle('novel'));
    assert.equal(r.solved, false);
    assert.equal(r.needsMetaSolver, true);
    assert.match(r.ceiling!, /META-SOLVE/);
  });

  test('enforces the >=3-solutions discipline', async () => {
    registerSolver(solver('x', [sol('a', 'local-only', 0.9, true), sol('b', 'local-only', 0.5, true)]));
    const r = await solveObstacle(obstacle('x'));
    assert.equal(r.solved, false);
    assert.match(r.ceiling!, />=3/);
  });

  test('SOLVES by executing the highest-confidence local-only solution under pre-granted authority', async () => {
    registerSolver(solver('x', [sol('low', 'local-only', 0.3, true), sol('best', 'local-only', 0.9, true), sol('mid', 'local-only', 0.6, false)]));
    const r = await solveObstacle(obstacle('x'));
    assert.equal(r.solved, true);
    assert.equal(r.attempted[0]!.solution, 'best', 'ranked by confidence; best tried first');
    assert.equal(r.attempted[0]!.outcome, 'applied');
  });

  test('BLAST RADIUS: a shared-state solution does NOT auto-execute under local-only authority (needs consensus)', async () => {
    registerSolver(solver('x', [sol('shared', 'shared-state', 0.99, true), sol('local', 'local-only', 0.2, true), sol('z', 'local-only', 0.1, false)]));
    const r = await solveObstacle(obstacle('x')); // default authority = local-only, no approveSharedState
    // shared (highest confidence) is deferred for consensus; falls through to the local one which applies.
    assert.equal(r.attempted[0]!.outcome, 'deferred-needs-consensus');
    assert.equal(r.solved, true, 'the local-only fallback still resolves it autonomously');
  });

  test('BLAST RADIUS: shared-state executes only WITH council consensus', async () => {
    registerSolver(solver('x', [sol('shared', 'shared-state', 0.99, true), sol('a', 'local-only', 0.1, false), sol('b', 'local-only', 0.1, false)]));
    const r = await solveObstacle(obstacle('x'), { approveSharedState: async () => true });
    assert.equal(r.solved, true);
    assert.equal(r.attempted[0]!.outcome, 'applied');
  });

  test('BLAST RADIUS: destructive ALWAYS defers to a human, even at higher authority', async () => {
    registerSolver(solver('x', [sol('boom', 'destructive', 0.99, true), sol('a', 'local-only', 0.1, false), sol('b', 'local-only', 0.1, false)]));
    const r = await solveObstacle(obstacle('x'), { authority: 'shared-state', approveSharedState: async () => true });
    assert.equal(r.attempted[0]!.outcome, 'deferred-needs-human');
    assert.equal(r.solved, false);
  });

  test('all in-authority solutions fail → an HONEST ceiling with attempts logged (never silent)', async () => {
    registerSolver(solver('x', [sol('a', 'local-only', 0.9, false), sol('b', 'local-only', 0.5, false), sol('c', 'local-only', 0.3, false)]));
    const r = await solveObstacle(obstacle('x'));
    assert.equal(r.solved, false);
    assert.equal(r.attempted.length, 3);
    assert.match(r.ceiling!, /Logged, not abandoned/);
  });
});

describe('spawn-failure solver — the npx-ENOENT class auto-solved (no human)', () => {
  test('canSolve matches ENOENT / 127 / not-recognized signals', () => {
    const s = makeSpawnFailureSolver(async () => 0);
    assert.equal(s.canSolve(obstacle('spawn-failure', "spawn npx ENOENT")), true);
    assert.equal(s.canSolve(obstacle('spawn-failure', "'tsx' is not recognized")), true);
    assert.equal(s.canSolve(obstacle('spawn-failure', 'all good')), false);
  });

  test('proposes 3 local-only fixes; shell-route (highest confidence) resolves an npx command', async () => {
    // mock runner: direct launch 127 (fails), shell launch 0 (works) — the real npx-on-Windows behavior.
    const run = async (_cmd: string, _cwd: string, viaShell: boolean) => (viaShell ? 1 : 127);
    registerSolver(makeSpawnFailureSolver(run));
    const r = await solveObstacle({ kind: 'spawn-failure', signal: 'spawn npx ENOENT', context: { command: 'npx tsx --test tests/x.test.ts', cwd: '/x' } });
    assert.equal(r.solved, true, 'auto-solved with no human');
    assert.equal(r.attempted[0]!.solution.length > 0 && r.attempted.every(a => a.blastRadius === 'local-only'), true);
    assert.match(r.attempted[0]!.detail, /launches now/);
  });
});
