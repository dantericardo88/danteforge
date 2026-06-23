import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import {
  runMergeCourt,
  type MergeCourtOptions,
} from '../src/matrix/engines/council-merge-court.js';
import type { CouncilWorktreeHandle } from '../src/matrix/engines/council-worktree.js';

const execFileAsync = promisify(execFile);

describe('runMergeCourt changed-file cache', () => {
  it('uses precomputed changed files instead of rescanning a worktree', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'df-merge-court-cache-'));
    try {
      await execFileAsync('git', ['init'], { cwd: repo });
      await fs.mkdir(path.join(repo, 'src'), { recursive: true });
      await fs.writeFile(path.join(repo, 'src', 'dirty.ts'), 'export const dirty = true;\n', 'utf8');

      const handle: CouncilWorktreeHandle = {
        memberId: 'codex',
        slotId: 'codex-0',
        worktreePath: repo,
        branchName: 'council/test/codex',
      };
      const opts: MergeCourtOptions & { changedFilesByWorktree: ReadonlyMap<string, string[]> } = {
        projectPath: repo,
        worktreeOpts: { projectPath: repo },
        handles: [handle],
        allMemberIds: ['codex'],
        goal: 'avoid redundant status scans',
        changedFilesByWorktree: new Map([[repo, []]]),
      };

      const results = await runMergeCourt(opts);

      assert.equal(results.length, 1);
      assert.deepEqual(results[0]!.changedFiles, []);
      assert.equal(results[0]!.merged, false);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});
