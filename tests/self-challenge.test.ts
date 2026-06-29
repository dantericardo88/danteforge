// Pins for the self-challenge ledger (DNA): defined problems only, never silently deleted,
// solving requires a real resolution reference.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { addChallenge, resolveChallenge, loadChallenges, renderLedger } from '../src/core/self-challenge.js';

const ROOT = path.join(os.tmpdir(), `self-challenge-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

describe('self-challenge — a defined problem is a solvable one', () => {
  test('add → list → solve lifecycle, with the markdown ledger rendered', async () => {
    const dir = path.join(ROOT, 'repo');
    await fs.mkdir(dir, { recursive: true });
    const c = await addChallenge(dir, {
      title: 'Cycle economics',
      problem: '~60 minutes of orchestration per push attempt produces 2-3 file diffs; most of the hour is overhead.',
      evidence: 'run 3e/3f ledgers: council build 40m capped, merge court minutes, for tiny payloads.',
      opportunity: 'Bigger payload per cycle = fewer cycles to a court PASS = cheaper 9.0s.',
    });
    assert.equal(c.id, 'CH-001');
    assert.equal(c.status, 'open');

    const md = await fs.readFile(path.join(dir, '.danteforge', 'challenges.md'), 'utf8');
    assert.match(md, /Open \(1\)/);
    assert.match(md, /Cycle economics/);
    assert.match(md, /minute a problem is DEFINED/i);

    const solved = await resolveChallenge(dir, 'CH-001', 'commit abc1234: court-feedback + bar-in-goal');
    assert.equal(solved.status, 'solved');
    const all = await loadChallenges(dir);
    assert.equal(all.length, 1, 'never deleted — moved to resolved');
    assert.match(renderLedger(all), /Resolved \(1\)/);
  });

  test('vague problems are rejected; double-solving is rejected; resolution must be real', async () => {
    const dir = path.join(ROOT, 'repo2');
    await fs.mkdir(dir, { recursive: true });
    await assert.rejects(() => addChallenge(dir, { title: 'fix', problem: 'meh', evidence: 'x', opportunity: 'y' }), /defined statement/);
    const c = await addChallenge(dir, { title: 'Real problem here', problem: 'A precisely observable defect statement.', evidence: 'log line 42 of run X shows it.', opportunity: 'Unblocks the fleet rollout.' });
    await assert.rejects(() => resolveChallenge(dir, c.id, 'done'), /real resolution/);
    await resolveChallenge(dir, c.id, 'commit deadbeef99');
    await assert.rejects(() => resolveChallenge(dir, c.id, 'commit other'), /already solved/);
  });
});
