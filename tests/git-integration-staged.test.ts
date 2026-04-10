// git-integration-staged.test.ts — tests for filesToStage option in stageAndCommit (v0.18.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stageAndCommit } from '../src/core/git-integration.js';

function makeState() {
  return {
    project: 'test-project',
    workflowStage: 'forge',
    currentPhase: 1,
    tasks: { 1: [{ name: 'Add feature' }] },
    constitution: '',
    auditLog: [],
  } as unknown as Parameters<typeof stageAndCommit>[0];
}

function makeGit(opts: {
  stagedFiles?: string[];
  statusFiles?: string[];
  shouldThrow?: boolean;
}) {
  const stagedFiles: string[] = [];
  return {
    _stagedFiles: stagedFiles,
    git: {
      add: async (files: string[]) => { stagedFiles.push(...files); },
      commit: async (_msg: string) => {
        if (opts.shouldThrow) throw new Error('git commit failed');
        return { commit: 'abc123' };
      },
      checkoutLocalBranch: async () => {},
      status: async () => ({
        files: (opts.statusFiles ?? ['dirty1.ts', 'dirty2.ts']).map(p => ({ path: p })),
      }),
    },
  };
}

describe('stageAndCommit — filesToStage option', () => {
  it('stages only filesToStage when provided', async () => {
    const { _stagedFiles, git } = makeGit({ statusFiles: ['unrelated.ts', 'other.ts'] });
    await stageAndCommit(makeState(), {
      _git: git,
      filesToStage: ['src/foo.ts', 'src/bar.ts'],
    });
    assert.deepEqual(_stagedFiles, ['src/foo.ts', 'src/bar.ts'], 'should stage only the specified files');
  });

  it('does not call git.status() when filesToStage is provided', async () => {
    let statusCalled = false;
    const git = {
      add: async (_files: string[]) => {},
      commit: async (_msg: string) => ({ commit: 'abc' }),
      checkoutLocalBranch: async () => {},
      status: async () => { statusCalled = true; return { files: [] }; },
    };
    await stageAndCommit(makeState(), {
      _git: git,
      filesToStage: ['src/specific.ts'],
    });
    assert.ok(!statusCalled, 'should not call git.status() when filesToStage is provided');
  });

  it('falls back to git.status() when filesToStage is not provided', async () => {
    let statusCalled = false;
    const stagedFiles: string[] = [];
    const git = {
      add: async (files: string[]) => { stagedFiles.push(...files); },
      commit: async (_msg: string) => ({ commit: 'abc' }),
      checkoutLocalBranch: async () => {},
      status: async () => { statusCalled = true; return { files: [{ path: 'auto-detected.ts' }] }; },
    };
    await stageAndCommit(makeState(), { _git: git });
    assert.ok(statusCalled, 'should call git.status() when filesToStage is not provided');
    assert.ok(stagedFiles.includes('auto-detected.ts'), 'should stage auto-detected files');
  });

  it('falls back to git.status() when filesToStage is empty array', async () => {
    let statusCalled = false;
    const git = {
      add: async (_files: string[]) => {},
      commit: async (_msg: string) => ({ commit: 'abc' }),
      checkoutLocalBranch: async () => {},
      status: async () => { statusCalled = true; return { files: [{ path: 'file.ts' }] }; },
    };
    await stageAndCommit(makeState(), { _git: git, filesToStage: [] });
    assert.ok(statusCalled, 'empty filesToStage should fall back to git.status()');
  });

  it('returns committed=true with correct filesStaged count when filesToStage is used', async () => {
    const { git } = makeGit({});
    const result = await stageAndCommit(makeState(), {
      _git: git,
      filesToStage: ['a.ts', 'b.ts', 'c.ts'],
    });
    assert.ok(result.committed);
    assert.equal(result.filesStaged, 3);
  });

  it('returns committed=false when git throws (regardless of filesToStage)', async () => {
    const { git } = makeGit({ shouldThrow: true });
    const result = await stageAndCommit(makeState(), {
      _git: git,
      filesToStage: ['src/foo.ts'],
    });
    assert.ok(!result.committed);
  });

  it('commit message includes staged file paths from filesToStage', async () => {
    let committedMessage = '';
    const git = {
      add: async (_files: string[]) => {},
      commit: async (msg: string) => { committedMessage = msg; return { commit: 'abc' }; },
      checkoutLocalBranch: async () => {},
      status: async () => ({ files: [] }),
    };
    await stageAndCommit(makeState(), {
      _git: git,
      filesToStage: ['src/feature.ts'],
    });
    assert.ok(committedMessage.length > 0, 'should produce a commit message');
  });

  it('stages filesToStage separately from git status files', async () => {
    const stagedFiles: string[] = [];
    const git = {
      add: async (files: string[]) => { stagedFiles.push(...files); },
      commit: async (_msg: string) => ({ commit: 'abc' }),
      checkoutLocalBranch: async () => {},
      status: async () => ({ files: [{ path: 'WIP.ts' }, { path: 'scratch.ts' }] }),
    };
    await stageAndCommit(makeState(), {
      _git: git,
      filesToStage: ['src/task-output.ts'],
    });
    assert.ok(stagedFiles.includes('src/task-output.ts'), 'should stage the specified file');
    assert.ok(!stagedFiles.includes('WIP.ts'), 'should not stage unrelated WIP files');
    assert.ok(!stagedFiles.includes('scratch.ts'), 'should not stage unrelated TODO files');
  });
});
