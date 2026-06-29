import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startWave, finishWave, readWaveLedger } from '../src/core/wave-ledger.js';
import { planReplay, summarizeRuns, resolveResumeIndex } from '../src/core/wave-replay.js';

const ROOT = path.join(os.tmpdir(), `wave-replay-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

async function fresh(name: string): Promise<string> {
  const cwd = path.join(ROOT, name);
  await fs.mkdir(cwd, { recursive: true });
  return cwd;
}

describe('wave-replay — resume from the last successful wave (depth_doctrine CH-022)', () => {
  test('a CRASHED run resumes from the wave AFTER the last successful one — never wave 0', async () => {
    const cwd = await fresh('crashed');
    // run r1: waves 0 and 1 completed; wave 2 started then crashed (running, never finished).
    const w0 = await startWave(cwd, { runId: 'r1', loopName: 'harden-crusade', waveIndex: 0, dimensionId: 'security', scoreBefore: 5 });
    await finishWave(cwd, w0, { status: 'completed', scoreAfter: 6 });
    const w1 = await startWave(cwd, { runId: 'r1', loopName: 'harden-crusade', waveIndex: 1, dimensionId: 'security', scoreBefore: 6 });
    await finishWave(cwd, w1, { status: 'completed', scoreAfter: 7 });
    await startWave(cwd, { runId: 'r1', loopName: 'harden-crusade', waveIndex: 2, dimensionId: 'security', scoreBefore: 7 }); // crashed mid-wave

    const plan = planReplay(await readWaveLedger(cwd), 'r1');
    assert.equal(plan.unknown, false);
    assert.equal(plan.loopName, 'harden-crusade');
    assert.equal(plan.completedWaves, 2);
    assert.equal(plan.runningWaves, 1);
    assert.equal(plan.lastSuccessful?.waveIndex, 1, 'last successful is wave 1');
    assert.equal(plan.resumeFromIndex, 2, 'resume at wave 2 (the crashed one) — NOT 0 (the whole point of replay)');
    assert.equal(plan.alreadyComplete, false);
    assert.equal(plan.pending.length, 1);
  });

  test('an ALL-COMPLETED run has nothing to resume', async () => {
    const cwd = await fresh('done');
    const w0 = await startWave(cwd, { runId: 'r1', loopName: 'autoforge', waveIndex: 0, scoreBefore: 1 });
    await finishWave(cwd, w0, { status: 'completed', scoreAfter: 2 });
    const plan = planReplay(await readWaveLedger(cwd), 'r1');
    assert.equal(plan.alreadyComplete, true);
    assert.equal(plan.pending.length, 0);
    assert.equal(plan.resumeFromIndex, 1);
  });

  test('a run with NO completed wave resumes from 0 (genuine cold start)', async () => {
    const cwd = await fresh('cold');
    await startWave(cwd, { runId: 'r1', loopName: 'ascend', waveIndex: 0, scoreBefore: 5 }); // crashed before any finish
    const plan = planReplay(await readWaveLedger(cwd), 'r1');
    assert.equal(plan.lastSuccessful, null);
    assert.equal(plan.resumeFromIndex, 0);
    assert.equal(plan.alreadyComplete, false);
  });

  test('an UNKNOWN run id → unknown plan, no resume', async () => {
    const cwd = await fresh('unknown');
    const plan = planReplay(await readWaveLedger(cwd), 'does-not-exist');
    assert.equal(plan.unknown, true);
    assert.equal(plan.resumeFromIndex, 0);
    assert.equal(plan.lastSuccessful, null);
  });

  test('resolveResumeIndex returns the resume point (the auto re-entry primitive)', async () => {
    const cwd = await fresh('resume-index');
    const w0 = await startWave(cwd, { runId: 'r1', loopName: 'harden-crusade', waveIndex: 0, scoreBefore: 5 });
    await finishWave(cwd, w0, { status: 'completed', scoreAfter: 6 });
    assert.equal(await resolveResumeIndex(cwd, 'r1'), 1, 'resume after the one completed wave (index 0)');
    assert.equal(await resolveResumeIndex(cwd, 'never-ran'), 0, 'unknown run → cold start at 0');
  });

  test('summarizeRuns groups distinct runs with their completion counts', async () => {
    const cwd = await fresh('summary');
    const a = await startWave(cwd, { runId: 'rA', loopName: 'autoforge', waveIndex: 0 });
    await finishWave(cwd, a, { status: 'completed' });
    const b = await startWave(cwd, { runId: 'rB', loopName: 'ascend', waveIndex: 0 });
    await finishWave(cwd, b, { status: 'failed' });
    const runs = summarizeRuns(await readWaveLedger(cwd));
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map(r => r.runId).sort(), ['rA', 'rB']);
    assert.equal(runs.find(r => r.runId === 'rA')!.completedWaves, 1);
    assert.equal(runs.find(r => r.runId === 'rB')!.lastStatus, 'failed');
  });
});
