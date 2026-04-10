// tests/git-integration.test.ts — Unit tests for git-integration module
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
import type { SimpleGitLike } from '../src/core/git-integration.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'my-project',
    lastHandoff: '',
    workflowStage: 'forge',
    currentPhase: 1,
    tasks: { 1: [{ name: 'build login page' }] },
    auditLog: [],
    profile: 'balanced',
    ...overrides,
  };
}

function makeMockGit(overrides?: Partial<SimpleGitLike>): SimpleGitLike {
  return {
    add: async () => {},
    commit: async (_msg: string) => ({ commit: 'abc1234' }),
    checkoutLocalBranch: async () => {},
    status: async () => ({ files: [{ path: 'src/foo.ts' }, { path: 'src/bar.ts' }] }),
    ...overrides,
  };
}

// ─── generateCommitMessage ─────────────────────────────────────────────────────

describe('generateCommitMessage', () => {
  it('forge stage → starts with feat(', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'forge' }) });
    assert.ok(msg.startsWith('feat('), `Expected feat( but got: ${msg}`);
  });

  it('verify stage → starts with test(', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'verify' }) });
    assert.ok(msg.startsWith('test('), `Expected test( but got: ${msg}`);
  });

  it('plan stage → starts with docs(', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'plan' }) });
    assert.ok(msg.startsWith('docs('), `Expected docs( but got: ${msg}`);
  });

  it('prefix override → starts with fix(', () => {
    const msg = generateCommitMessage({ state: makeState(), prefix: 'fix' });
    assert.ok(msg.startsWith('fix('), `Expected fix( but got: ${msg}`);
  });

  it('scope is slugified project name', () => {
    const msg = generateCommitMessage({ state: makeState({ project: 'My Cool Project' }) });
    assert.ok(msg.includes('my-cool-project'), `Expected slugified scope in: ${msg}`);
  });

  it('task name is included in message', () => {
    const msg = generateCommitMessage({
      state: makeState({ tasks: { 1: [{ name: 'implement oauth flow' }] }, currentPhase: 1 }),
    });
    assert.ok(msg.includes('implement-oauth-flow'), `Expected task slug in: ${msg}`);
  });

  it('no tasks → uses workflowStage as task description', () => {
    const msg = generateCommitMessage({
      state: makeState({ tasks: {}, workflowStage: 'forge' }),
    });
    assert.ok(msg.includes('forge'), `Expected workflowStage in: ${msg}`);
  });

  it('special chars in project name → slugified', () => {
    const msg = generateCommitMessage({
      state: makeState({ project: 'Hello World!! 2.0' }),
    });
    // scope should only contain alphanumeric and hyphens
    const scopeMatch = msg.match(/\(([^)]+)\)/);
    assert.ok(scopeMatch, 'Expected scope in parentheses');
    assert.match(scopeMatch![1], /^[a-z0-9-]+$/);
  });
});

// ─── generateBranchName ───────────────────────────────────────────────────────

describe('generateBranchName', () => {
  it('returns string matching pattern danteforge/*/', () => {
    const branch = generateBranchName(makeState());
    assert.ok(branch.startsWith('danteforge/'), `Expected danteforge/ prefix: ${branch}`);
    assert.ok(branch.split('/').length >= 3, `Expected at least 3 segments: ${branch}`);
  });

  it('includes phase number', () => {
    const branch = generateBranchName(makeState({ currentPhase: 5 }));
    assert.ok(branch.includes('5'), `Expected phase 5 in branch name: ${branch}`);
  });

  it('special chars in project/task → sanitized', () => {
    const branch = generateBranchName(
      makeState({ project: 'My App!!', tasks: { 1: [{ name: 'Add OAuth 2.0 Login' }] } }),
    );
    // Should not contain exclamation marks or dots
    assert.ok(!/[!.]/.test(branch), `Found unsanitized chars in: ${branch}`);
  });

  it('long project name → capped at reasonable length', () => {
    const longProject = 'a'.repeat(100);
    const branch = generateBranchName(makeState({ project: longProject }));
    const segments = branch.split('/');
    assert.ok(segments[1].length <= 30, `Project slug too long: ${segments[1]}`);
  });
});

// ─── generatePRBody ───────────────────────────────────────────────────────────

describe('generatePRBody', () => {
  it('output contains ## Summary', async () => {
    const body = await generatePRBody({ project: 'my-app', phase: 1 });
    assert.ok(body.includes('## Summary'));
  });

  it('output contains ## Changes', async () => {
    const body = await generatePRBody({ project: 'my-app', phase: 1 });
    assert.ok(body.includes('## Changes'));
  });

  it('output contains DanteForge', async () => {
    const body = await generatePRBody({ project: 'my-app', phase: 1 });
    assert.ok(body.includes('DanteForge'));
  });

  it('includes spec content when provided', async () => {
    const body = await generatePRBody({
      project: 'my-app',
      phase: 1,
      spec: 'This app handles authentication.',
    });
    assert.ok(body.includes('This app handles authentication.'));
  });
});

// ─── stageAndCommit ───────────────────────────────────────────────────────────

describe('stageAndCommit', () => {
  it('calls _git.add() with files from _git.status()', async () => {
    const addedFiles: string[][] = [];
    const mockGit = makeMockGit({
      add: async (files: string[]) => { addedFiles.push(files); },
    });
    await stageAndCommit(makeState(), { _git: mockGit });
    assert.equal(addedFiles.length, 1);
    assert.deepEqual(addedFiles[0], ['src/foo.ts', 'src/bar.ts']);
  });

  it('calls _git.commit() with generated message', async () => {
    const committed: string[] = [];
    const mockGit = makeMockGit({
      commit: async (msg: string) => { committed.push(msg); return { commit: 'abc' }; },
    });
    await stageAndCommit(makeState(), { _git: mockGit });
    assert.equal(committed.length, 1);
    assert.ok(committed[0].startsWith('feat('), `Expected feat( commit: ${committed[0]}`);
  });

  it('returns committed: true on success', async () => {
    const result = await stageAndCommit(makeState(), { _git: makeMockGit() });
    assert.equal(result.committed, true);
    assert.equal(result.filesStaged, 2);
  });

  it('returns committed: false when git throws', async () => {
    const mockGit = makeMockGit({
      status: async () => { throw new Error('not a git repo'); },
    });
    const result = await stageAndCommit(makeState(), { _git: mockGit });
    assert.equal(result.committed, false);
    assert.ok(result.message.length > 0);
    assert.equal(result.filesStaged, 0);
  });
});

// ─── createTaskBranch ─────────────────────────────────────────────────────────

describe('createTaskBranch', () => {
  it('calls _git.checkoutLocalBranch() with generated name', async () => {
    const checked: string[] = [];
    const mockGit = makeMockGit({
      checkoutLocalBranch: async (name: string) => { checked.push(name); },
    });
    await createTaskBranch(makeState(), { _git: mockGit });
    assert.equal(checked.length, 1);
    assert.ok(checked[0].startsWith('danteforge/'), `Expected danteforge/ prefix: ${checked[0]}`);
  });

  it('returns { created: true, branchName } on success', async () => {
    const result = await createTaskBranch(makeState(), { _git: makeMockGit() });
    assert.equal(result.created, true);
    assert.ok(result.branchName.startsWith('danteforge/'));
  });

  it('returns { created: false } when git throws', async () => {
    const mockGit = makeMockGit({
      checkoutLocalBranch: async () => { throw new Error('branch already exists'); },
    });
    const result = await createTaskBranch(makeState(), { _git: mockGit });
    assert.equal(result.created, false);
    assert.ok(result.branchName.length > 0);
  });
});

// ─── git-integration edge cases ───────────────────────────────────────────────

describe('git-integration edge cases', () => {
  it('generateCommitMessage with workflowStage "specify" → starts with "docs("', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'specify' }) });
    assert.ok(msg.startsWith('docs('), `Expected docs( but got: ${msg}`);
  });

  it('generateCommitMessage with workflowStage "initialized" → starts with "chore("', () => {
    const msg = generateCommitMessage({ state: makeState({ workflowStage: 'initialized' }) });
    assert.ok(msg.startsWith('chore('), `Expected chore( but got: ${msg}`);
  });

  it('generateBranchName has no double dashes in output', () => {
    const branch = generateBranchName(makeState({ project: 'My--App', tasks: { 1: [{ name: 'do--thing' }] } }));
    assert.ok(!branch.includes('--'), `Expected no double dashes in branch: ${branch}`);
  });

  it('generateBranchName slug has lowercase only (no uppercase)', () => {
    const branch = generateBranchName(makeState({ project: 'MyApp', tasks: { 1: [{ name: 'AddFeature' }] } }));
    assert.equal(branch, branch.toLowerCase(), `Expected lowercase branch name: ${branch}`);
  });

  it('generatePRBody with no spec/plan/tasks → still returns string with DanteForge footer', async () => {
    const body = await generatePRBody({ project: 'my-app', phase: 1 });
    assert.equal(typeof body, 'string');
    assert.ok(body.includes('DanteForge'), `Expected DanteForge footer in body`);
  });

  it('generatePRBody output contains project name', async () => {
    const body = await generatePRBody({ project: 'my-cool-project', phase: 1 });
    assert.ok(body.includes('my-cool-project'), `Expected project name in PR body`);
  });

  it('stageAndCommit with empty status (no changed files) → filesStaged is 0', async () => {
    const mockGit = makeMockGit({
      status: async () => ({ files: [] }),
    });
    const result = await stageAndCommit(makeState(), { _git: mockGit });
    assert.equal(result.filesStaged, 0, `Expected filesStaged = 0, got ${result.filesStaged}`);
  });

  it('generateCommitMessage task name with special chars (spaces, slashes) → message is valid commit format', () => {
    const msg = generateCommitMessage({
      state: makeState({ tasks: { 1: [{ name: 'add user/auth feature' }] }, currentPhase: 1 }),
    });
    // Commit message must start with type(scope): description
    assert.match(msg, /^\w+\([^)]+\):\s+\S+/, `Expected conventional commit format, got: ${msg}`);
    // No raw slashes in scope or subject from the task name
    const subjectPart = msg.slice(msg.indexOf(': ') + 2);
    assert.ok(!subjectPart.includes('/'), `Expected no raw slash in subject: ${subjectPart}`);
  });

  it('generateBranchName with task name containing spaces → uses dashes', () => {
    const branch = generateBranchName(makeState({ tasks: { 1: [{ name: 'my feature task' }] } }));
    assert.ok(!branch.includes(' '), `Expected no spaces in branch: ${branch}`);
    assert.ok(branch.includes('-'), `Expected dashes in branch: ${branch}`);
  });

  it('createTaskBranch returns the generated branch name in result', async () => {
    const checked: string[] = [];
    const mockGit = makeMockGit({
      checkoutLocalBranch: async (name: string) => { checked.push(name); },
    });
    const result = await createTaskBranch(makeState(), { _git: mockGit });
    assert.ok(result.created, 'Expected created: true');
    assert.equal(result.branchName, checked[0], 'Expected branchName to match the checked out branch');
  });

  it('generatePRBody phase number appears in output', async () => {
    const body = await generatePRBody({ project: 'my-app', phase: 7 });
    assert.ok(body.includes('7'), `Expected phase number 7 in PR body`);
  });
});
