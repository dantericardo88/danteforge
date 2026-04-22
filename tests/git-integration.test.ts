import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCommitMessage,
  generateBranchName,
  generatePRBody,
  stageAndCommit,
  createTaskBranch,
} from '../src/core/git-integration.js';
import type { DanteState } from '../src/core/state.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'my-cool-project',
    workflowStage: 'forge',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'default',
    lastHandoff: new Date().toISOString(),
    ...overrides,
  };
}

describe('generateCommitMessage', () => {
  it('uses feat type for forge stage', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'forge' }) });
    assert.ok(msg.startsWith('feat('));
  });

  it('uses test type for verify stage', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'verify' }) });
    assert.ok(msg.startsWith('test('));
  });

  it('uses docs type for plan stage', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'plan' }) });
    assert.ok(msg.startsWith('docs('));
  });

  it('uses chore type for unknown stage', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'initialized' }) });
    assert.ok(msg.startsWith('chore('));
  });

  it('respects explicit prefix override', () => {
    const msg = generateCommitMessage({ state: makeState(), prefix: 'fix' });
    assert.ok(msg.startsWith('fix('));
  });

  it('slugifies project name into scope', () => {
    const msg = generateCommitMessage({ state: makeState({ project: 'My Cool Project!' }) });
    assert.ok(msg.includes('my-cool-project'));
  });

  it('truncates long project names to 20 chars in scope', () => {
    const msg = generateCommitMessage({ state: makeState({ project: 'a'.repeat(50) }) });
    const scope = msg.match(/\(([^)]+)\)/)?.[1] ?? '';
    assert.ok(scope.length <= 20);
  });
});

describe('generateBranchName', () => {
  it('starts with danteforge/ prefix', () => {
    const branch = generateBranchName(makeState());
    assert.ok(branch.startsWith('danteforge/'));
  });

  it('includes slugified project name', () => {
    const branch = generateBranchName(makeState({ project: 'My Project' }));
    assert.ok(branch.includes('my-project'));
  });

  it('includes phase number', () => {
    const branch = generateBranchName(makeState({ currentPhase: 3 }));
    assert.ok(branch.includes('3'));
  });

  it('produces URL-safe characters only', () => {
    const branch = generateBranchName(makeState({ project: 'Project With Spaces & Stuff!' }));
    assert.ok(/^[a-z0-9\-/]+$/.test(branch), `branch not URL-safe: ${branch}`);
  });
});

describe('generatePRBody', () => {
  it('includes spec content', async () => {
    const body = await generatePRBody({ project: 'test', phase: 1, spec: 'The spec content' });
    assert.ok(body.includes('The spec content'));
  });

  it('includes plan content', async () => {
    const body = await generatePRBody({ project: 'test', phase: 1, plan: 'The plan content' });
    assert.ok(body.includes('The plan content'));
  });

  it('includes project name and phase', async () => {
    const body = await generatePRBody({ project: 'my-app', phase: 2 });
    assert.ok(body.includes('my-app'));
    assert.ok(body.includes('2'));
  });

  it('uses fallback text when spec is missing', async () => {
    const body = await generatePRBody({ project: 'test', phase: 0 });
    assert.ok(body.includes('No spec available'));
  });

  it('truncates long spec to 500 chars', async () => {
    const longSpec = 'x'.repeat(1000);
    const body = await generatePRBody({ project: 'test', phase: 0, spec: longSpec });
    assert.ok(body.includes('x'.repeat(500)));
    assert.ok(!body.includes('x'.repeat(501)));
  });
});

describe('stageAndCommit', () => {
  it('returns committed=true when git succeeds', async () => {
    const mockGit = {
      status: async () => ({ files: [{ path: 'src/foo.ts' }] }),
      add: async () => {},
      commit: async () => ({ commit: 'abc123' }),
      checkoutLocalBranch: async () => {},
    };
    const result = await stageAndCommit(makeState(), { _git: mockGit });
    assert.equal(result.committed, true);
    assert.ok(result.filesStaged > 0);
  });

  it('returns committed=false when git throws', async () => {
    const mockGit = {
      status: async () => { throw new Error('not a git repo'); },
      add: async () => {},
      commit: async () => ({ commit: '' }),
      checkoutLocalBranch: async () => {},
    };
    const result = await stageAndCommit(makeState(), { _git: mockGit });
    assert.equal(result.committed, false);
  });

  it('uses filesToStage when provided', async () => {
    let stagedFiles: string[] = [];
    const mockGit = {
      status: async () => ({ files: [] }),
      add: async (files: string[]) => { stagedFiles = files; },
      commit: async () => ({ commit: 'abc' }),
      checkoutLocalBranch: async () => {},
    };
    await stageAndCommit(makeState(), { _git: mockGit, filesToStage: ['a.ts', 'b.ts'] });
    assert.deepEqual(stagedFiles, ['a.ts', 'b.ts']);
  });
});

describe('createTaskBranch', () => {
  it('returns created=true with branch name on success', async () => {
    const mockGit = {
      status: async () => ({ files: [] }),
      add: async () => {},
      commit: async () => ({ commit: '' }),
      checkoutLocalBranch: async () => {},
    };
    const result = await createTaskBranch(makeState(), { _git: mockGit });
    assert.equal(result.created, true);
    assert.ok(result.branchName.startsWith('danteforge/'));
  });

  it('returns created=false when checkout fails', async () => {
    const mockGit = {
      status: async () => ({ files: [] }),
      add: async () => {},
      commit: async () => ({ commit: '' }),
      checkoutLocalBranch: async () => { throw new Error('branch exists'); },
    };
    const result = await createTaskBranch(makeState(), { _git: mockGit });
    assert.equal(result.created, false);
  });
});
