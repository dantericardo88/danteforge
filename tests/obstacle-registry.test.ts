import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerSolver, clearSolvers, solveObstacle, deriveRadius, type ObstacleSolver, type Solution, type SolverEffect, type Obstacle } from '../src/core/obstacle-registry.js';
import { spawnFailureSolver } from '../src/core/solvers/spawn-failure-solver.js';

function sol(id: string, effect: SolverEffect, confidence: number): Solution {
  return { id, description: id, confidence, effect };
}
function solver(kind: string, sols: Solution[], canSolve?: (o: Obstacle) => boolean): ObstacleSolver {
  return { kind, canSolve: canSolve ?? ((o) => o.kind === kind), proposeSolutions: async () => sols };
}
const obstacle = (kind: string, signal = '', context: Record<string, unknown> = {}): Obstacle => ({ kind, signal, context });
const noop = (detail = 'ok'): SolverEffect => ({ kind: 'noop', detail });

beforeEach(() => clearSolvers());

describe('deriveRadius — the kernel decides the radius from the effect, never the solver', () => {
  test('noop / safe shell → local-only', () => {
    assert.equal(deriveRadius({ kind: 'noop', detail: 'x' }), 'local-only');
    assert.equal(deriveRadius({ kind: 'shell', command: 'npx tsx --test x.test.ts' }), 'local-only');
  });
  test('destructive shell → destructive (rm -rf / git reset --hard / git push --force)', () => {
    assert.equal(deriveRadius({ kind: 'shell', command: 'rm -rf /' }), 'destructive');
    assert.equal(deriveRadius({ kind: 'shell', command: 'git reset --hard origin/main && git push --force' }), 'destructive');
  });
  test('score/yardstick-surface write → shared-state', () => {
    assert.equal(deriveRadius({ kind: 'shell', command: 'echo x > .danteforge/compete/matrix.json' }), 'shared-state');
    assert.equal(deriveRadius({ kind: 'write-file', path: '.danteforge/compete/universe/x.md', content: 'easy bar' }), 'shared-state');
  });
  test('write-file escaping the project → destructive', () => {
    assert.equal(deriveRadius({ kind: 'write-file', path: '/etc/passwd', content: 'x' }), 'destructive');
    assert.equal(deriveRadius({ kind: 'write-file', path: '../../etc/x', content: 'x' }), 'destructive');
  });
});

describe('solveObstacle — never-say-cant + KERNEL-derived authority', () => {
  test('no solver → needsMetaSolver (the missing solver IS the next sub-problem)', async () => {
    const r = await solveObstacle(obstacle('novel'));
    assert.equal(r.needsMetaSolver, true);
  });

  test('enforces the >=3-solutions discipline', async () => {
    registerSolver(solver('x', [sol('a', noop(), 0.9), sol('b', noop(), 0.5)]));
    const r = await solveObstacle(obstacle('x'));
    assert.equal(r.solved, false);
    assert.match(r.ceiling!, />=3/);
  });

  test('SOLVES by executing the highest-confidence local-only effect under pre-granted authority', async () => {
    registerSolver(solver('x', [sol('low', noop(), 0.3), sol('best', noop('did it'), 0.9), sol('mid', noop(), 0.6)]));
    const r = await solveObstacle(obstacle('x'));
    assert.equal(r.solved, true);
    assert.equal(r.attempted[0]!.solution, 'best');
    assert.equal(r.attempted[0]!.blastRadius, 'local-only');
  });

  test('THE FIX: a destructive effect mislabel is impossible — kernel derives destructive, defers to a human', async () => {
    // a solver that "intends" this as a routine fix; the kernel sees the real effect.
    registerSolver(solver('x', [
      sol('sneaky', { kind: 'shell', command: 'git reset --hard origin/main && git push --force' }, 0.99),
      sol('a', noop(), 0.2), sol('b', noop(), 0.1),
    ]));
    // give it max authority short of destructive — it STILL must not auto-run.
    const r = await solveObstacle(obstacle('x'), { authority: 'shared-state', approveSharedState: async () => true });
    assert.equal(r.attempted[0]!.blastRadius, 'destructive');
    assert.equal(r.attempted[0]!.outcome, 'deferred-needs-human');
  });

  test('deny-guard: even at destructive authority, a destructive effect is BLOCKED at execution (defense in depth)', async () => {
    registerSolver(solver('x', [sol('boom', { kind: 'shell', command: 'rm -rf /' }, 0.99), sol('a', noop(), 0.1), sol('b', noop(), 0.1)]));
    let ran = false;
    const r = await solveObstacle(obstacle('x'), { authority: 'destructive', runShell: async () => { ran = true; return 0; } });
    assert.equal(r.attempted[0]!.outcome, 'blocked-destructive');
    assert.equal(ran, false, 'the destructive command must never reach the shell');
  });

  test('shared-state effect needs council consensus (not auto under local-only authority)', async () => {
    registerSolver(solver('x', [sol('surface', { kind: 'write-file', path: '.danteforge/compete/matrix.json', content: '{}' }, 0.99), sol('a', noop(), 0.2), sol('b', noop(), 0.1)]));
    const deferred = await solveObstacle(obstacle('x'));
    assert.equal(deferred.attempted[0]!.outcome, 'deferred-needs-consensus');
    const approved = await solveObstacle(obstacle('x'), { approveSharedState: async () => true, writeFile: async () => {} });
    assert.equal(approved.solved, true);
  });

  test('greedy canSolve:()=>true is refused fall-through capture (runaway defense)', async () => {
    registerSolver(solver('greedy', [sol('a', noop(), 0.9), sol('b', noop(), 0.9), sol('c', noop(), 0.9)], () => true));
    const r = await solveObstacle(obstacle('unrelated'));
    assert.equal(r.needsMetaSolver, true, 'a greedy solver must NOT capture an unrelated obstacle');
  });

  test('all fail → honest ceiling with attempts logged', async () => {
    registerSolver(solver('x', [sol('a', { kind: 'shell', command: 'false' }, 0.9), sol('b', { kind: 'shell', command: 'false' }, 0.5), sol('c', { kind: 'shell', command: 'false' }, 0.3)]));
    const r = await solveObstacle(obstacle('x'), { runShell: async () => 1 });
    assert.equal(r.solved, false);
    assert.equal(r.attempted.length, 3);
    assert.match(r.ceiling!, /Logged, not abandoned/);
  });
});

describe('spawn-failure solver — npx/ENOENT auto-solved, all effects kernel-derived local-only', () => {
  test('proposes 3 shell effects, shell-route resolves (exit != 127 = launches)', async () => {
    registerSolver(spawnFailureSolver);
    const r = await solveObstacle(
      obstacle('spawn-failure', 'spawn npx ENOENT', { command: 'npx tsx --test tests/x.test.ts', cwd: '/x' }),
      { runShell: async () => 1 }, // launches now (exit 1, not 127)
    );
    assert.equal(r.solved, true);
    assert.equal(r.attempted[0]!.blastRadius, 'local-only', 'all spawn-fix effects are kernel-derived local-only');
  });
});
