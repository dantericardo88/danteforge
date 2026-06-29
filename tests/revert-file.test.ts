// Pins for the shared adapter revert (run-3i regression): the old per-adapter copy unlinked
// the file whenever `git checkout --` failed for ANY reason — designed for untracked files,
// but a transient failure DELETED the committed src/core/frontier-plan.ts from the working
// tree. Deletion is now allowed ONLY for provably untracked files.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultRevertFile } from '../src/matrix/adapters/revert-file.js';

const execFileAsync = promisify(execFile);
const ROOT = path.join(os.tmpdir(), `revert-file-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

async function makeGitRepo(): Promise<string> {
  const dir = path.join(ROOT, `repo-${Math.floor(performance.now() * 1000)}`);
  await fs.mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 't'], { cwd: dir });
  await fs.writeFile(path.join(dir, 'tracked.ts'), 'export const a = 1;\n', 'utf8');
  await execFileAsync('git', ['add', 'tracked.ts'], { cwd: dir });
  await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('defaultRevertFile — tracked files are restored or reported, NEVER deleted', () => {
  test('a modified tracked file is restored to HEAD', async () => {
    const dir = await makeGitRepo();
    await fs.writeFile(path.join(dir, 'tracked.ts'), 'export const a = 999;\n', 'utf8');
    await defaultRevertFile(dir, 'tracked.ts');
    assert.equal(await fs.readFile(path.join(dir, 'tracked.ts'), 'utf8'), 'export const a = 1;\n');
  });

  test('an untracked file is deleted (the legitimate fallback)', async () => {
    const dir = await makeGitRepo();
    await fs.writeFile(path.join(dir, 'new-file.ts'), 'export const b = 2;\n', 'utf8');
    await defaultRevertFile(dir, 'new-file.ts');
    await assert.rejects(fs.access(path.join(dir, 'new-file.ts')), 'untracked file should be removed');
  });

  test('run-3i regression: checkout failure on a TRACKED file throws — the file survives', async () => {
    const dir = await makeGitRepo();
    // A tracked file DELETED from the worktree: `git checkout --` would normally restore it,
    // so simulate the transient-failure shape by corrupting checkout's ability to run — an
    // index.lock makes checkout fail exactly like a concurrent-writer collision does.
    await fs.writeFile(path.join(dir, 'tracked.ts'), 'export const a = 5;\n', 'utf8');
    await fs.writeFile(path.join(dir, '.git', 'index.lock'), '', 'utf8');
    await assert.rejects(
      () => defaultRevertFile(dir, 'tracked.ts'),
      /TRACKED file .* refusing to delete/,
      'a tracked file that cannot be checked out must throw, not be unlinked',
    );
    await fs.rm(path.join(dir, '.git', 'index.lock'), { force: true });
    assert.equal(await fs.readFile(path.join(dir, 'tracked.ts'), 'utf8'), 'export const a = 5;\n', 'the file content must be untouched');
  });
});
