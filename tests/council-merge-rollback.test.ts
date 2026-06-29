// Pin for the council-merge conflict rollback (live fleet-run-3e finding): a conflicted
// `git apply --3way` left conflict markers + unmerged index entries in the MAIN tree (no
// MERGE_HEAD — nothing to abort), breaking typecheck/builds for every later phase of the run.
// applyDiffToMain must (1) refuse to patch over local modifications, and (2) on conflict,
// restore the touched files to their pre-apply state — candidate work stays on its branch.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyDiffToMain } from '../src/matrix/engines/council-merge-court.js';

const execFileAsync = promisify(execFile);
const ROOT = path.join(os.tmpdir(), `council-merge-rollback-${process.pid}`);

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await execFileAsync('git', args, { cwd });
  return r.stdout;
}

async function initRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'user.email', 't@t']);
  await git(dir, ['config', 'user.name', 't']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
}

/** A patch that 3-way-CONFLICTS with HEAD: branch edits line 2 one way, main another. */
async function conflictingPatch(dir: string): Promise<string> {
  await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nbase\nline3\n', 'utf8');
  await git(dir, ['add', 'a.txt']);
  await git(dir, ['commit', '-q', '-m', 'base']);
  await git(dir, ['checkout', '-q', '-b', 'builder']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nbuilder-version\nline3\n', 'utf8');
  await fs.writeFile(path.join(dir, 'new-file.txt'), 'created by builder\n', 'utf8');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-q', '-m', 'builder work']);
  const diff = await git(dir, ['diff', 'main...builder']);
  await git(dir, ['checkout', '-q', 'main']);
  // Main diverges on the SAME line → the 3-way apply must conflict.
  await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nmain-version\nline3\n', 'utf8');
  await git(dir, ['add', 'a.txt']);
  await git(dir, ['commit', '-q', '-m', 'main divergence']);
  return diff;
}

before(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

describe('council merge-court — conflicted 3-way apply never wrecks the main tree', () => {
  test('on conflict: markers cleaned, index has no unmerged entries, patch-created files removed, error surfaces', async () => {
    const dir = path.join(ROOT, 'conflict');
    await initRepo(dir);
    await git(dir, ['branch', '-m', 'main']);
    const diff = await conflictingPatch(dir);

    await assert.rejects(() => applyDiffToMain(diff, dir), /apply|conflict|error/i, 'the merge failure must surface');

    const content = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
    assert.ok(!content.includes('<<<<<<<'), 'no conflict markers left in the main tree');
    assert.equal(content, 'line1\nmain-version\nline3\n', 'main tree restored to its pre-apply state');
    const status = (await git(dir, ['status', '--porcelain'])).trim();
    assert.equal(status, '', `tree fully clean after rollback (got: ${status})`);
    await assert.rejects(() => fs.access(path.join(dir, 'new-file.txt')), 'patch-created file removed');
    // The builder's work is NOT lost — it lives on its branch.
    const branchFile = await git(dir, ['show', 'builder:new-file.txt']);
    assert.match(branchFile, /created by builder/);
  });

  test('PRECONDITION: refuses to patch over local modifications (never destroys uncommitted work)', async () => {
    const dir = path.join(ROOT, 'dirty');
    await initRepo(dir);
    await git(dir, ['branch', '-m', 'main']);
    const diff = await conflictingPatch(dir);
    // The operator has uncommitted work in the target file.
    await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nOPERATOR UNCOMMITTED WORK\nline3\n', 'utf8');

    await assert.rejects(() => applyDiffToMain(diff, dir), /local modifications/);
    const content = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
    assert.equal(content, 'line1\nOPERATOR UNCOMMITTED WORK\nline3\n', 'uncommitted work untouched');
  });

  test('a CLEAN apply still works (the happy path is unchanged)', async () => {
    const dir = path.join(ROOT, 'clean');
    await initRepo(dir);
    await git(dir, ['branch', '-m', 'main']);
    await fs.writeFile(path.join(dir, 'b.txt'), 'one\ntwo\n', 'utf8');
    await git(dir, ['add', 'b.txt']);
    await git(dir, ['commit', '-q', '-m', 'base']);
    await git(dir, ['checkout', '-q', '-b', 'builder2']);
    await fs.writeFile(path.join(dir, 'b.txt'), 'one\ntwo\nthree\n', 'utf8');
    await git(dir, ['add', 'b.txt']);
    await git(dir, ['commit', '-q', '-m', 'extend']);
    const diff = await git(dir, ['diff', 'main...builder2']);
    await git(dir, ['checkout', '-q', 'main']);

    await applyDiffToMain(diff, dir);
    const content = await fs.readFile(path.join(dir, 'b.txt'), 'utf8');
    assert.equal(content, 'one\ntwo\nthree\n', 'non-conflicting council work merges normally');
  });
});
