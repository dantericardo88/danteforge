import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runMeasurement, type ExecFileFn, type AutoResearchConfig } from '../src/core/autoresearch-engine.js';
import { clearSolvers } from '../src/core/obstacle-registry.js';
import { _resetCoreSolvers } from '../src/core/solvers/register-core.js';

function config(measurementCommand: string): AutoResearchConfig {
  return { goal: 'g', metric: 'm', measurementCommand, cwd: '/x', timeBudgetMinutes: 1 } as unknown as AutoResearchConfig;
}

describe('autoresearch measurement — a spawn failure is auto-solved by the DNA, not a dead stop', () => {
  test('ENOENT on a direct launch is recovered via the obstacle registry (shell-route), metric captured', async () => {
    clearSolvers(); _resetCoreSolvers();
    // `sometool measure` is not a .cmd wrapper, so runMeasurement token-splits it → execFn('sometool', …)
    // ENOENTs. The registry's spawn-failure solver re-runs it through the shell, which succeeds.
    const execFn: ExecFileFn = async (file) => {
      if (file === 'sometool') { const e = new Error('spawn sometool ENOENT') as Error & { code?: string }; e.code = 'ENOENT'; throw e; }
      return { stdout: 'metric 42' }; // the shell route (cmd.exe / sh) works
    };
    const v = await runMeasurement(config('sometool measure'), execFn);
    assert.equal(v, 42, 'the loop self-healed the spawn failure and still produced the metric — no human, no abort');
  });

  test('a genuinely unrecoverable command still throws honestly (shell route also fails to launch)', async () => {
    clearSolvers(); _resetCoreSolvers();
    const execFn: ExecFileFn = async () => { const e = new Error('ENOENT') as Error & { code?: string }; e.code = 'ENOENT'; throw e; };
    await assert.rejects(() => runMeasurement(config('ghosttool run'), execFn), /could not run.*could not recover/);
  });
});
