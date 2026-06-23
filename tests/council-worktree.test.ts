import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import {
  collectChangedFilesForHandles,
  type CouncilWorktreeHandle,
} from '../src/matrix/engines/council-worktree.js';

const execFileAsync = promisify(execFile);

async function makeDirtyGitRepo(root: string, name: string, filePath: string): Promise<CouncilWorktreeHandle> {
  const repoPath = path.join(root, name);
  await fs.mkdir(path.dirname(path.join(repoPath, filePath)), { recursive: true });
  await execFileAsync('git', ['init'], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, filePath), `content for ${name}\n`, 'utf8');
  return {
    memberId: name,
    slotId: `${name}-0`,
    worktreePath: repoPath,
    branchName: `council/test/${name}`,
  };
}

describe('collectChangedFilesForHandles', () => {
  it('collects changed files for every worktree handle using real git status', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-council-worktrees-'));
    try {
      const handles = [
        await makeDirtyGitRepo(root, 'codex', 'src/codex-change.ts'),
        await makeDirtyGitRepo(root, 'claude-code', 'tests/claude change.test.ts'),
        {
          memberId: 'missing',
          slotId: 'missing-0',
          worktreePath: path.join(root, 'does-not-exist'),
          branchName: 'council/test/missing',
        },
      ];

      const changedByWorktree = await collectChangedFilesForHandles(handles);

      assert.deepEqual(changedByWorktree.get(handles[0]!.worktreePath), ['src/codex-change.ts']);
      assert.deepEqual(changedByWorktree.get(handles[1]!.worktreePath), ['tests/claude change.test.ts']);
      assert.deepEqual(changedByWorktree.get(handles[2]!.worktreePath), []);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
