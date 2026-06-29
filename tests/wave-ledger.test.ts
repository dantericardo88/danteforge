import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  startWave, finishWave, readWaveLedger, reconcileReceipts, lastSuccessfulWave,
  type WaveReceipt,
} from '../src/core/wave-ledger.js';

const ROOT = path.join(os.tmpdir(), `wave-ledger-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

async function freshCwd(name: string): Promise<string> {
  const cwd = path.join(ROOT, name);
  await fs.mkdir(cwd, { recursive: true });
  return cwd;
}

describe('wave-ledger — the durable rung-8 cadence ledger (depth_doctrine)', () => {
  test('≥2 distinct loops emit BYTE-COMPARABLE receipt schemas (the bar\'s core requirement)', async () => {
    const cwd = await freshCwd('byte-comparable');
    // harden-crusade emits a depth wave; autoforge emits a breadth wave — different loops, different
    // values, but the court requires the SCHEMA to be identical across loops.
    const hc = await startWave(cwd, { runId: 'r1', loopName: 'harden-crusade', waveIndex: 1, dimensionId: 'security', scoreBefore: 7.0 });
    const af = await startWave(cwd, { runId: 'r2', loopName: 'autoforge', waveIndex: 0, dimensionId: 'testing', scoreBefore: 42 });
    const keysOf = (r: WaveReceipt) => Object.keys(r).sort();
    assert.deepEqual(keysOf(hc), keysOf(af), 'every loop must emit the identical receipt key-set');
    // Guard semantics are loop-agnostic, derived from the ONE getWaveGuard source:
    assert.equal(hc.waveType, 'depth', 'odd index → depth');
    assert.equal(hc.scoreCeiling, null, 'a depth wave is uncapped (null, since JSON has no Infinity)');
    assert.deepEqual(hc.allowedActions, { newCode: false, outcomeRun: true }, 'depth runs outcomes, writes no code');
    assert.equal(af.waveType, 'breadth', 'even index → breadth');
    assert.equal(af.scoreCeiling, 6.0, 'a breadth wave is capped at 6.0');
    assert.deepEqual(af.allowedActions, { newCode: true, outcomeRun: false }, 'breadth writes code, runs no outcomes');
  });

  test('the ledger is APPEND-ONLY JSONL — start + finish both recorded as history', async () => {
    const cwd = await freshCwd('append-only');
    const open = await startWave(cwd, { runId: 'r1', loopName: 'ascend', waveIndex: 2, dimensionId: 'planning_quality', scoreBefore: 8.0 });
    await finishWave(cwd, open, { status: 'completed', scoreAfter: 8.0, gitShaAfter: 'abc1234', decision: 'continue', commandsRun: ['validate planning_quality'] });
    const file = path.join(cwd, '.danteforge', 'waves', 'wave-ledger.jsonl');
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2, 'start and finish are BOTH appended (durable transition history)');
    const rows = await readWaveLedger(cwd);
    assert.equal(rows[0]!.status, 'running');
    assert.equal(rows[1]!.status, 'completed');
    assert.equal(rows[1]!.waveId, open.waveId, 'finish carries the same identity as start');
    // reconcile collapses to the terminal status per waveId.
    const reconciled = reconcileReceipts(rows);
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0]!.status, 'completed');
    assert.equal(reconciled[0]!.scoreAfter, 8.0);
  });

  test('lastSuccessfulWave is the recovery anchor — finds the last completed, ignores running/failed', async () => {
    const cwd = await freshCwd('recovery-anchor');
    const w1 = await startWave(cwd, { runId: 'r1', loopName: 'harden-crusade', waveIndex: 0, scoreBefore: 5 });
    await finishWave(cwd, w1, { status: 'completed', scoreAfter: 6 });
    const w2 = await startWave(cwd, { runId: 'r1', loopName: 'harden-crusade', waveIndex: 1, scoreBefore: 6 });
    await finishWave(cwd, w2, { status: 'failed', decision: 'stop' }); // crashed/outage — not a recovery point
    const w3 = await startWave(cwd, { runId: 'r1', loopName: 'harden-crusade', waveIndex: 2, scoreBefore: 6 }); // still running
    void w3;
    const rows = await readWaveLedger(cwd);
    const last = lastSuccessfulWave(rows, 'harden-crusade');
    assert.ok(last, 'a completed wave exists');
    assert.equal(last!.waveId, w1.waveId, 'recovery resumes from the last SUCCESSFUL wave, never a failed/running one');
    // Loop scoping: a different loop with no completed wave has no anchor.
    assert.equal(lastSuccessfulWave(rows, 'autoforge'), null);
  });

  test('a torn/corrupt JSONL line is skipped, never crashes the reader', async () => {
    const cwd = await freshCwd('torn-line');
    const open = await startWave(cwd, { runId: 'r1', loopName: 'autoforge', waveIndex: 0 });
    const file = path.join(cwd, '.danteforge', 'waves', 'wave-ledger.jsonl');
    await fs.appendFile(file, '{ this is a half-written line\n', 'utf8');
    await finishWave(cwd, open, { status: 'completed', scoreAfter: 3 });
    const rows = await readWaveLedger(cwd);
    assert.equal(rows.length, 2, 'the two valid rows survive; the torn line is dropped');
  });
});
