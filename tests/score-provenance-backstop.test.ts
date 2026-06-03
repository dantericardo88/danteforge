import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertScoreProvenance, writeVerifiedScore } from '../src/core/write-verified-score.js';
import { pruneRuns, RunLedger, listRuns } from '../src/core/run-ledger.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';

const ROOT = path.join('X:\\tmp', `provenance-backstop-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function mkMatrix(self: number): CompeteMatrix {
  const dim = {
    id: 'd', name: 'D', weight: 1, frequency: 'medium',
    scores: { self, Cursor: 8 }, gap_to_leader: 8 - self, leader: 'Cursor',
    gap_to_closed_source_leader: 0, closed_source_leader: 'u', gap_to_oss_leader: 0, oss_leader: 'u',
    status: 'in-progress', sprint_history: [], next_sprint_target: 9,
  } as MatrixDimension;
  return {
    project: 'p', competitors: ['Cursor'], competitors_closed_source: ['Cursor'], competitors_oss: [],
    lastUpdated: '', overallSelfScore: self, dimensions: [dim],
  };
}

describe('assertScoreProvenance — the persistence-time backstop (closes the grep blind spot)', () => {
  test('a scores.self change WITH a matching provenance entry is accepted', () => {
    const prev = mkMatrix(6);
    const next = mkMatrix(6);
    writeVerifiedScore(next, 'd', 7.0, { agent: 'merge' }); // writes provenance + sets self=7
    const violations = assertScoreProvenance(prev, next);
    assert.deepEqual(violations, []);
  });

  test('a scores.self change with NO provenance is a violation (the aliasing / hand-edit case)', () => {
    const prev = mkMatrix(6);
    const next = mkMatrix(6);
    // Simulate an out-of-band mutation the grep-guard cannot see (alias / Object.assign / disk edit).
    (next.dimensions[0]!.scores as Record<string, number>)['self'] = 9.0;
    const violations = assertScoreProvenance(prev, next);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]!.dimId, 'd');
    assert.equal(violations[0]!.before, 6);
    assert.equal(violations[0]!.after, 9.0);
  });

  test('an unchanged score needs no provenance (status-only / outcome saves pass)', () => {
    const prev = mkMatrix(7);
    const next = mkMatrix(7);
    next.dimensions[0]!.status = 'closed';
    assert.deepEqual(assertScoreProvenance(prev, next), []);
  });

  test('first write (no previous matrix) is never blocked', () => {
    const next = mkMatrix(8);
    assert.deepEqual(assertScoreProvenance(null, next), []);
  });

  test('a newly-added dimension is not blocked (no prior value to guard)', () => {
    const prev = mkMatrix(6);
    const next = mkMatrix(6);
    next.dimensions.push({ ...next.dimensions[0]!, id: 'new', scores: { self: 9, Cursor: 8 } });
    assert.deepEqual(assertScoreProvenance(prev, next), []);
  });
});

describe('pruneRuns — RunLedger bundles cannot grow unbounded', () => {
  test('keeps the newest N run dirs and removes the rest', async () => {
    const runsDir = path.join(ROOT, 'runs');
    await fs.mkdir(runsDir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await fs.mkdir(path.join(runsDir, `run-${i}`), { recursive: true });
      await fs.writeFile(path.join(runsDir, `run-${i}`, 'bundle.json'), '{}');
      await new Promise(r => setTimeout(r, 5)); // stagger mtimes
    }
    const removed = await pruneRuns(runsDir, 3);
    assert.equal(removed.length, 3, 'three oldest removed');
    const left = (await fs.readdir(runsDir, { withFileTypes: true })).filter(e => e.isDirectory());
    assert.equal(left.length, 3);
  });

  test('logCommand is crash-durable — the failing command lands on disk BEFORE finalize (DS-024)', async () => {
    const cwd = path.join(ROOT, 'durable');
    const ledger = new RunLedger('ascend-frontier', [], cwd);
    await ledger.initialize();
    ledger.logCommand('danteforge', ['harden-crusade', '--parallel', '4'], 127, 1234, undefined, 'EPIPE: broken pipe');
    // Give the fire-and-forget append a tick to flush.
    await new Promise(r => setTimeout(r, 50));
    // The run is NOT finalized — simulate a hard crash. The command history must still be on disk.
    const live = await fs.readFile(path.join(cwd, '.danteforge', 'runs', ledger.getRunId(), 'commands-live.jsonl'), 'utf8');
    const row = JSON.parse(live.trim().split('\n')[0]!);
    assert.equal(row.exitCode, 127, 'the exact failing exit code survives a crash');
    assert.deepEqual(row.args, ['harden-crusade', '--parallel', '4'], 'the exact failing argv survives a crash');
  });

  test('finalize() prunes automatically (retention enforced end-to-end)', async () => {
    const cwd = path.join(ROOT, 'auto');
    // Seed 52 stale run dirs.
    const runsDir = path.join(cwd, '.danteforge', 'runs');
    await fs.mkdir(runsDir, { recursive: true });
    for (let i = 0; i < 52; i++) await fs.mkdir(path.join(runsDir, `stale-${i}`), { recursive: true });
    const ledger = new RunLedger('test', [], cwd);
    await ledger.initialize();
    await ledger.finalize({}, {}, { status: 'success', completionOracle: true });
    const runs = await listRuns(cwd);
    assert.ok(runs.length <= 50, `retention cap enforced (got ${runs.length})`);
  });
});
