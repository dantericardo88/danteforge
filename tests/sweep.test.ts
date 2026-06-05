// sweep.test.ts — the `danteforge sweep` command: dry-run plan + live orchestration (seamed).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sweep } from '../src/cli/commands/sweep.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { SweepDeps } from '../src/core/sweep-orchestrator.js';

const mtx = (scores: number[]): CompeteMatrix => ({
  project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0,
  dimensions: scores.map((s, i) => ({ id: `d${i}`, label: `d${i}`, weight: 1, scores: { self: s } })),
} as unknown as CompeteMatrix);

const originalExit = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExit; });

describe('sweep command', () => {
  it('--dry-run prints the plan and executes nothing', async () => {
    const log: string[] = [];
    const deps: SweepDeps = {
      loadMatrix: async () => mtx([2]),
      runDispatch: async () => { log.push('dispatch'); },
      runDepthWave: async () => { log.push('depthwave'); return { promoted: true }; },
      runAscendFrontier: async () => { log.push('ascend'); },
    };
    await sweep({ dryRun: true, _loadMatrix: async () => mtx([2, 6, 8]), _deps: deps });
    assert.deepEqual(log, [], 'dry-run runs no executors');
  });

  it('clamps the target to the 9.0 ceiling, runs the phases, and writes a ledger', async () => {
    const log: string[] = [];
    const writes: string[] = [];
    const deps: SweepDeps = {
      loadMatrix: async () => mtx([2, 6, 8]),
      runDispatch: async (_c, t) => { log.push(`dispatch:${t}`); },
      runDepthWave: async () => { log.push('depthwave'); return { promoted: true }; },
      runAscendFrontier: async () => { log.push('ascend'); },
    };
    await sweep({ target: 10, _loadMatrix: async () => mtx([2, 6, 8]), _deps: deps, _writeFile: async (p) => { writes.push(p); }, _mkdir: async () => {}, _nodeModulesExists: async () => true });
    assert.ok(log.includes('dispatch:5'), 'Phase 1 dispatched to 5');
    assert.ok(log.includes('ascend'), 'Phase 4 delegated 7→9 (target was clamped to 9, still > 7)');
    assert.ok(writes.some(p => p.includes('SWEEP_SUMMARY')), 'a campaign ledger was written');
  });

  it('bootstrap gate: refuses a live run when node_modules is missing (unrunnable checkout)', async () => {
    let ran = false;
    const deps: SweepDeps = {
      loadMatrix: async () => mtx([2]), runDispatch: async () => { ran = true; },
      runDepthWave: async () => ({ promoted: false }), runAscendFrontier: async () => {},
    };
    await sweep({ _loadMatrix: async () => mtx([2, 6]), _deps: deps, _nodeModulesExists: async () => false });
    assert.equal(ran, false, 'no executor ran on an unrunnable checkout');
    assert.equal(process.exitCode, 1);
  });

  it('errors cleanly when there is no matrix', async () => {
    await sweep({ _loadMatrix: async () => null });
    assert.equal(process.exitCode, 1);
  });
});
