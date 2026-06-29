// CH-022: the interrupt-before-score-write gate + the auto-resume primitive it pairs with.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { checkScoreInterrupt, INTERRUPT_ENV, INTERRUPT_SENTINEL } from '../src/core/score-interrupt.js';
import { saveMatrix, type CompeteMatrix, type MatrixDimension } from '../src/core/compete-matrix.js';
import { startWave, finishWave } from '../src/core/wave-ledger.js';
import { resolveResumeIndex } from '../src/core/wave-replay.js';

const ROOT = path.join(os.tmpdir(), `score-interrupt-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

async function freshCwd(name: string): Promise<string> {
  const cwd = path.join(ROOT, name);
  await fs.mkdir(path.join(cwd, '.danteforge', 'compete'), { recursive: true });
  return cwd;
}

function mkMatrix(self = 7): CompeteMatrix {
  const dim = {
    id: 'd', name: 'D', weight: 1, frequency: 'medium', scores: { self, Cursor: 8 },
    gap_to_leader: 8 - self, leader: 'Cursor', gap_to_closed_source_leader: 0, closed_source_leader: 'Cursor',
    gap_to_oss_leader: 0, oss_leader: 'u', status: 'in-progress', sprint_history: [], next_sprint_target: 9,
  } as MatrixDimension;
  return { project: 'p', competitors: ['Cursor'], competitors_closed_source: ['Cursor'], competitors_oss: [], lastUpdated: '', overallSelfScore: self, dimensions: [dim] };
}

describe('checkScoreInterrupt — the pause primitive (seamed, fail-open)', () => {
  test('env armed → paused', async () => {
    const r = await checkScoreInterrupt('/x', { readEnv: k => (k === INTERRUPT_ENV ? '1' : undefined), readFile: async () => null });
    assert.equal(r.paused, true);
  });
  test('sentinel file present → paused, reason = file contents', async () => {
    const r = await checkScoreInterrupt('/x', { readEnv: () => undefined, readFile: async () => 'operator paused for review' });
    assert.equal(r.paused, true);
    assert.match(r.reason, /operator paused for review/);
  });
  test('neither → not paused', async () => {
    const r = await checkScoreInterrupt('/x', { readEnv: () => undefined, readFile: async () => null });
    assert.equal(r.paused, false);
  });
  test('falsy env values (0/false/empty) are NOT a pause', async () => {
    for (const v of ['', '0', 'false', 'no']) {
      assert.equal((await checkScoreInterrupt('/x', { readEnv: () => v, readFile: async () => null })).paused, false, `"${v}" must not pause`);
    }
  });
  test('a read error fails OPEN (never wedge a normal run)', async () => {
    const r = await checkScoreInterrupt('/x', { readEnv: () => { throw new Error('boom'); }, readFile: async () => null });
    assert.equal(r.paused, false);
  });
});

describe('saveMatrix — interrupt-before-score-write gate (CH-022)', () => {
  test('BLOCKS and writes NOTHING when the interrupt is armed (env)', async () => {
    const cwd = await freshCwd('env-armed');
    let wrote = false;
    const spy = async () => { wrote = true; };
    const saved = process.env[INTERRUPT_ENV];
    process.env[INTERRUPT_ENV] = '1';
    try {
      await assert.rejects(() => saveMatrix(mkMatrix(), cwd, spy), /BLOCKED by interrupt/);
      assert.equal(wrote, false, 'no score persisted → the in-flight wave stays resumable');
    } finally {
      if (saved === undefined) delete process.env[INTERRUPT_ENV]; else process.env[INTERRUPT_ENV] = saved;
    }
  });

  test('BLOCKS when the sentinel file is present, PROCEEDS once it is cleared', async () => {
    const cwd = await freshCwd('sentinel');
    let writes = 0;
    const spy = async () => { writes++; };
    const sentinel = path.join(cwd, INTERRUPT_SENTINEL);
    await fs.writeFile(sentinel, 'paused for human audit\n');
    await assert.rejects(() => saveMatrix(mkMatrix(), cwd, spy), /BLOCKED by interrupt/);
    assert.equal(writes, 0);
    await fs.rm(sentinel, { force: true });
    await saveMatrix(mkMatrix(), cwd, spy); // cleared → proceeds
    assert.equal(writes, 1, 'clearing the interrupt lets the write proceed');
  });

  test('DANTEFORGE_ALLOW_SCORE_WRITE=1 bypasses the gate', async () => {
    const cwd = await freshCwd('bypass');
    let wrote = false;
    const spy = async () => { wrote = true; };
    const sentinel = path.join(cwd, INTERRUPT_SENTINEL);
    await fs.writeFile(sentinel, 'paused');
    const saved = process.env['DANTEFORGE_ALLOW_SCORE_WRITE'];
    process.env['DANTEFORGE_ALLOW_SCORE_WRITE'] = '1';
    try {
      await saveMatrix(mkMatrix(), cwd, spy);
      assert.equal(wrote, true, 'the explicit override forces the write');
    } finally {
      if (saved === undefined) delete process.env['DANTEFORGE_ALLOW_SCORE_WRITE']; else process.env['DANTEFORGE_ALLOW_SCORE_WRITE'] = saved;
    }
  });

  test('default-OFF: a normal save (no interrupt armed) writes exactly as before', async () => {
    const cwd = await freshCwd('default-off');
    let writes = 0;
    await saveMatrix(mkMatrix(), cwd, async () => { writes++; });
    assert.equal(writes, 1, 'the gate is a no-op until armed — smoke suite unaffected');
  });
});

describe('crash → resume → interrupt (the full CH-022 arc)', () => {
  test('resolveResumeIndex resumes after the last successful wave, and the gate fires before the score write', async () => {
    const cwd = await freshCwd('arc');
    const runId = 'run-ch022';
    // waves 0,1 completed; wave 2 started but never finished (crash mid-wave).
    const w0 = await startWave(cwd, { runId, loopName: 'harden-crusade', waveIndex: 0, dimensionId: 'd' });
    await finishWave(cwd, w0, { status: 'completed', scoreAfter: 6 });
    const w1 = await startWave(cwd, { runId, loopName: 'harden-crusade', waveIndex: 1, dimensionId: 'd' });
    await finishWave(cwd, w1, { status: 'completed', scoreAfter: 7 });
    await startWave(cwd, { runId, loopName: 'harden-crusade', waveIndex: 2, dimensionId: 'd' }); // crash — no finish

    assert.equal(await resolveResumeIndex(cwd, runId), 2, 'resume from wave 2 (after the last success), not 0');

    // Between resume and the score write, an armed interrupt blocks the persist — the crashed wave 2
    // is never frozen into the matrix.
    const sentinel = path.join(cwd, INTERRUPT_SENTINEL);
    await fs.writeFile(sentinel, 'pause before committing wave 2');
    let wrote = false;
    await assert.rejects(() => saveMatrix(mkMatrix(8), cwd, async () => { wrote = true; }), /BLOCKED by interrupt/);
    assert.equal(wrote, false);
  });
});
