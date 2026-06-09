import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { metaSolve, type MetaSolveOptions } from '../src/core/meta-solver.js';
import type { Obstacle } from '../src/core/obstacle-registry.js';

const obstacle: Obstacle = { kind: 'rust-scaffold', signal: 'auto-authoring not supported for .rs', context: {} };

function opts(over: Partial<MetaSolveOptions> = {}): MetaSolveOptions {
  return {
    cwd: '/x',
    dispatchSolverAuthor: async () => ({ ranOk: true }),
    scanForStubs: async () => [],                 // clean by default
    runReplayTest: async () => ({ passed: true, detail: 'resolves the .rs obstacle' }),
    registerNewSolver: async () => ({ ok: true }),
    alreadyAttempted: () => false,
    _exists: async () => true,                    // agent produced the solver file
    _removeFile: async () => {},
    ...over,
  };
}

describe('metaSolve — self-extension, gated so it cannot register a cheating solver', () => {
  test('registers a clean, replay-verified solver (the loop grows a new capability)', async () => {
    const r = await metaSolve(obstacle, opts());
    assert.equal(r.registered, true, r.reason);
    assert.match(r.solverPath!, /rust-scaffold-solver\.ts/);
  });

  test('GATE no-stub: rejects + reverts a solver that swallows errors / stubs', async () => {
    let reverted = 0;
    const r = await metaSolve(obstacle, opts({ scanForStubs: async () => ['empty catch (swallows errors)'], _removeFile: async () => { reverted++; } }));
    assert.equal(r.registered, false);
    assert.equal(r.rejectedBy, 'no-stub');
    assert.ok(reverted >= 1, 'a cheating solver must be reverted');
  });

  test('GATE replay: rejects + reverts a solver that does not resolve its own triggering obstacle', async () => {
    const r = await metaSolve(obstacle, opts({ runReplayTest: async () => ({ passed: false, detail: 'still unsolved' }) }));
    assert.equal(r.registered, false);
    assert.equal(r.rejectedBy, 'replay');
  });

  test('no meta-regress: one solver per class per pass', async () => {
    let dispatched = false;
    const r = await metaSolve(obstacle, opts({ alreadyAttempted: () => true, dispatchSolverAuthor: async () => { dispatched = true; return { ranOk: true }; } }));
    assert.equal(r.registered, false);
    assert.equal(r.rejectedBy, 'already-attempted');
    assert.equal(dispatched, false, 'must not even dispatch a second time for the same class');
  });

  test('honest reject when the agent produces no solver file', async () => {
    const r = await metaSolve(obstacle, opts({ _exists: async () => false }));
    assert.equal(r.registered, false);
    assert.equal(r.rejectedBy, 'dispatch');
  });

  test('the default stub scanner flags real lie-patterns', async () => {
    // exercise defaultScanForStubs by NOT injecting scanForStubs; point at a temp file.
    const os = await import('node:os'); const fsp = await import('node:fs/promises'); const p = await import('node:path');
    const dir = await fsp.mkdtemp(p.join(os.tmpdir(), 'meta-'));
    const solver = p.join(dir, 'src/core/solvers/rust-scaffold-solver.ts');
    await fsp.mkdir(p.dirname(solver), { recursive: true });
    await fsp.writeFile(solver, 'export const x = () => { try { risky(); } catch (e) {} return { ok: true }; }; // TODO real impl', 'utf8');
    const r = await metaSolve(obstacle, { ...opts(), cwd: dir, scanForStubs: undefined, _exists: undefined });
    assert.equal(r.registered, false);
    assert.equal(r.rejectedBy, 'no-stub');
    await fsp.rm(dir, { recursive: true, force: true });
  });
});
