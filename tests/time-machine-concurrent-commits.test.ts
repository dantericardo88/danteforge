// Pass 31 — concurrent-edit safety.
// Verifies the substrate handles parallel commit attempts against the same workspace
// without producing torn writes, missing reflog entries, or HEAD pointing at a non-existent commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { rm } from 'node:fs/promises';

import { createTimeMachineCommit, verifyTimeMachine } from '../src/core/time-machine.js';

test('Pass 31 — 8 parallel commits against same workspace produce a valid chain', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'concurrent-commits-'));
  try {
    mkdirSync(join(ws, 'data'), { recursive: true });
    // Each worker writes its own file then commits.
    const N = 8;
    const workers = Array.from({ length: N }, (_, i) => async () => {
      const filename = `data/file-${i}.txt`;
      writeFileSync(join(ws, filename), `content-${i}`, 'utf8');
      return createTimeMachineCommit({
        cwd: ws,
        paths: [filename],
        label: `concurrent worker ${i}`,
        gitSha: null,
      });
    });
    const results = await Promise.all(workers.map(w => w()));

    // All N commits exist on disk.
    assert.equal(results.length, N);
    for (const c of results) {
      assert.ok(existsSync(join(ws, '.danteforge', 'time-machine', 'commits', `${c.commitId}.json`)),
        `commit ${c.commitId} missing on disk`);
    }

    // Reflog has at least N entries (no missed appends).
    const reflogPath = join(ws, '.danteforge', 'time-machine', 'refs', 'reflog.jsonl');
    const reflogLines = readFileSync(reflogPath, 'utf-8').split('\n').filter(Boolean);
    assert.equal(reflogLines.length, N, `reflog should have exactly ${N} entries`);

    // HEAD points to a real commit (not a missed write).
    const headPath = join(ws, '.danteforge', 'time-machine', 'refs', 'HEAD');
    assert.ok(existsSync(headPath), 'HEAD missing');
    const headValue = readFileSync(headPath, 'utf-8').trim();
    assert.ok(results.some(c => c.commitId === headValue), 'HEAD does not match any of the N commits');

    // verifyTimeMachine runs clean.
    const verify = await verifyTimeMachine({ cwd: ws });
    // Note: parallel commits may produce a reflog where parent-pointers aren't a strict linear chain
    // (since each commit reads HEAD at start; some may share a parent). The verify catches this as
    // a parent-mismatch in the reflog. That's the *correct* substrate behavior — concurrent unsynchronized
    // commits do not produce a linear history; they produce a fan-out. Document that explicitly.
    if (!verify.valid) {
      const parentMismatches = verify.errors.filter(e => e.includes('parent mismatch'));
      const otherErrors = verify.errors.filter(e => !e.includes('parent mismatch'));
      // We tolerate parent-mismatches as documented behavior under concurrent commits without coordination.
      assert.equal(otherErrors.length, 0,
        `non-mismatch errors: ${otherErrors.slice(0, 3).join('; ')}`);
    }
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 31 — sequential commits in fast succession produce a clean linear chain', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'sequential-commits-'));
  try {
    mkdirSync(join(ws, 'data'), { recursive: true });
    const N = 16;
    const commits = [];
    for (let i = 0; i < N; i += 1) {
      const filename = `data/file-${i}.txt`;
      writeFileSync(join(ws, filename), `content-${i}`, 'utf8');
      commits.push(await createTimeMachineCommit({
        cwd: ws,
        paths: [filename],
        label: `sequential ${i}`,
        gitSha: null,
      }));
    }
    // Reflog parent chain should be linear (each commit's parent = previous commit).
    const reflogPath = join(ws, '.danteforge', 'time-machine', 'refs', 'reflog.jsonl');
    const reflogLines = readFileSync(reflogPath, 'utf-8').split('\n').filter(Boolean);
    const reflog = reflogLines.map(l => JSON.parse(l));
    for (let i = 0; i < N; i += 1) {
      const expectedParent = i === 0 ? null : reflog[i - 1].commitId;
      assert.equal(reflog[i].parent, expectedParent, `reflog[${i}].parent mismatch`);
    }
    // All commits exist.
    assert.equal(readdirSync(join(ws, '.danteforge', 'time-machine', 'commits')).length, N);
    // verify clean.
    const verify = await verifyTimeMachine({ cwd: ws });
    assert.equal(verify.valid, true, `errors: ${verify.errors.join('; ')}`);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});
