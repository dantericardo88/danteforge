// Pass 24 T3.2 — restore --to-working-tree --confirm.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { rm } from 'node:fs/promises';

import { createTimeMachineCommit, restoreTimeMachineCommit } from '../src/core/time-machine.js';

async function setupChain(workspace: string): Promise<string> {
  mkdirSync(join(workspace, 'data'), { recursive: true });
  writeFileSync(join(workspace, 'data', 'doc.json'), JSON.stringify({ version: 1, content: 'original' }, null, 2), 'utf8');
  const commit = await createTimeMachineCommit({
    cwd: workspace,
    paths: ['data/doc.json'],
    label: 't3.2 baseline',
    runId: 'restore_to_working_tree',
    gitSha: null,
    now: () => new Date(2026, 3, 29, 22, 0, 0).toISOString(),
  });
  return commit.commitId;
}

test('restore --to-working-tree without confirm refuses', async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 't32-no-confirm-'));
  try {
    const commitId = await setupChain(workspace);
    await assert.rejects(
      () => restoreTimeMachineCommit({ cwd: workspace, commitId, toWorkingTree: true }),
      /refusing to restore to working tree without confirm/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('restore --to-working-tree with confirm overwrites cwd', async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 't32-confirm-'));
  try {
    const commitId = await setupChain(workspace);
    // Mutate the working tree file.
    writeFileSync(join(workspace, 'data', 'doc.json'), JSON.stringify({ corrupted: true }), 'utf8');
    const result = await restoreTimeMachineCommit({ cwd: workspace, commitId, toWorkingTree: true, confirm: true });
    assert.equal(result.restoredToWorkingTree, true);
    assert.equal(result.outDir, resolve(workspace));
    const restored = JSON.parse(readFileSync(join(workspace, 'data', 'doc.json'), 'utf8'));
    assert.equal(restored.version, 1);
    assert.equal(restored.content, 'original');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('restore --to-working-tree and --out are mutually exclusive', async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 't32-mutex-'));
  try {
    const commitId = await setupChain(workspace);
    await assert.rejects(
      () => restoreTimeMachineCommit({ cwd: workspace, commitId, toWorkingTree: true, confirm: true, outDir: join(workspace, 'somewhere') }),
      /mutually exclusive/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('restore default (no working-tree flag) still goes to isolated outDir', async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 't32-default-'));
  try {
    const commitId = await setupChain(workspace);
    const dest = join(workspace, 'restore-target');
    const result = await restoreTimeMachineCommit({ cwd: workspace, commitId, outDir: dest });
    assert.equal(result.restoredToWorkingTree, false);
    assert.equal(existsSync(join(dest, 'data', 'doc.json')), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
