import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gitCommit, gitBranch, gitPR } from '../src/cli/commands/git-helpers.js';

const mockState = {
  project: 'test-project',
  currentPhase: 1,
  workflowStage: 'forge' as const,
  tasks: {},
  auditLog: [],
  profile: '',
  lastHandoff: '',
};

describe('gitCommit', () => {
  it('reports successful commit', async () => {
    const lines: string[] = [];
    await gitCommit({
      _stageAndCommit: async () => ({ committed: true, filesStaged: 3, message: 'feat: test commit' }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('Committed') || l.includes('3')));
  });

  it('reports failed commit', async () => {
    const lines: string[] = [];
    await gitCommit({
      _stageAndCommit: async () => ({ committed: false, filesStaged: 0, message: 'nothing to commit' }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('failed') || l.includes('nothing')));
  });

  it('does not throw when _stageAndCommit succeeds', async () => {
    await assert.doesNotReject(() =>
      gitCommit({
        _stageAndCommit: async () => ({ committed: true, filesStaged: 1, message: 'test' }),
        _stdout: () => {},
      })
    );
  });

  it('throws when _stageAndCommit throws (no internal catch)', async () => {
    await assert.rejects(
      () => gitCommit({
        _stageAndCommit: async () => { throw new Error('git error'); },
        _stdout: () => {},
      }),
      /git error/
    );
  });
});

describe('gitBranch', () => {
  it('reports successful branch creation', async () => {
    const lines: string[] = [];
    await gitBranch({
      _createBranch: async () => ({ created: true, branchName: 'feat/new-feature' }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('Created') || l.includes('feat/new-feature')));
  });

  it('reports failed branch creation', async () => {
    const lines: string[] = [];
    await gitBranch({
      _createBranch: async () => ({ created: false, branchName: 'existing-branch' }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('failed') || l.includes('existing-branch')));
  });

  it('throws when _createBranch throws (no internal catch)', async () => {
    await assert.rejects(
      () => gitBranch({
        _createBranch: async () => { throw new Error('branch error'); },
        _stdout: () => {},
      }),
      /branch error/
    );
  });
});

describe('gitPR', () => {
  it('reports successful PR creation', async () => {
    const lines: string[] = [];
    await gitPR({
      _openPR: async () => ({ url: 'https://github.com/org/repo/pull/42', prNumber: 42 }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('PR created') || l.includes('42')));
  });

  it('reports PR creation failure', async () => {
    const lines: string[] = [];
    await gitPR({
      _openPR: async () => ({ url: 'not-created', prNumber: 0 }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('failed') || l.includes('not-created')));
  });

  it('throws when _openPR throws (no internal catch)', async () => {
    await assert.rejects(
      () => gitPR({
        _openPR: async () => { throw new Error('gh not found'); },
        _stdout: () => {},
      }),
      /gh not found/
    );
  });
});
