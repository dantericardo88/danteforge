// autoresearch-worktree.test.ts — isolated-worktree setup/teardown + the command-level isolate path.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorktree, teardownWorktree, type WorktreeDeps } from '../src/cli/commands/autoresearch-worktree.js';
import { autoResearch } from '../src/cli/commands/autoresearch.js';
import type { DanteState } from '../src/core/state.js';
import type { ExperimentResult } from '../src/core/autoresearch-engine.js';

function fakeDeps(over: Partial<WorktreeDeps> = {}): WorktreeDeps {
  return {
    createWorktree: async () => '/wt',
    removeWorktree: async () => {},
    exists: async (p) => p.includes('user'),   // user node_modules exists; worktree one does not
    symlink: async () => {},
    mkdir: async () => {},
    copyFile: async () => {},
    ...over,
  };
}

describe('setupWorktree', () => {
  it('creates the worktree off the user tree and links node_modules in', async () => {
    const calls: string[] = [];
    const deps = fakeDeps({
      createWorktree: async (name, opts) => { calls.push(`create:${name}:${opts.branch}`); return '/wt'; },
      symlink: async () => { calls.push('symlink'); },
    });
    const s = await setupWorktree('/user', 'ar-x', 'autoresearch/x-1', deps);
    assert.equal(s?.worktreePath, '/wt');
    assert.equal(s?.branch, 'autoresearch/x-1');
    assert.ok(calls.some(c => c.startsWith('create:ar-x:')), 'worktree created on the given branch');
    assert.ok(calls.includes('symlink'), 'node_modules junction created');
  });

  it('skips the symlink when the worktree already has node_modules', async () => {
    let symlinked = false;
    const deps = fakeDeps({ exists: async () => true, symlink: async () => { symlinked = true; } });
    await setupWorktree('/user', 'ar-x', 'b', deps);
    assert.equal(symlinked, false);
  });

  it('returns null (does not throw) when worktree creation fails', async () => {
    const deps = fakeDeps({ createWorktree: async () => { throw new Error('boom'); } });
    assert.equal(await setupWorktree('/user', 'ar-x', 'b', deps), null);
  });
});

describe('teardownWorktree', () => {
  it('copies artifacts back to the user tree, then removes the worktree', async () => {
    const copiedTo: string[] = [];
    let removed = '';
    const deps = fakeDeps({
      copyFile: async (_s, d) => { copiedTo.push(d); },
      removeWorktree: async (name) => { removed = name; },
    });
    await teardownWorktree({ worktreePath: '/wt', branch: 'b', agentName: 'ar-x' }, '/user', deps);
    assert.ok(copiedTo.some(d => d.includes('user') && d.includes('AUTORESEARCH_REPORT.md')), 'report copied to user tree');
    assert.equal(removed, 'ar-x', 'worktree removed');
  });
});

// ── command-level: isolate runs in the worktree and always tears it down ─────────

const makeState = (): DanteState => ({ project: 't', workflowStage: 'tasks', currentPhase: 0, profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {} } as unknown as DanteState);
const WT = process.platform === 'win32' ? 'C:\\wt' : '/wt';
const originalExit = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExit; });

describe('autoResearch --isolate', () => {
  it('runs git/experiments in the worktree (not the user tree) and tears it down', async () => {
    const gitCwds: string[] = [];
    let setup = false, torn = false, budgetExpired = false;
    const state = makeState();
    await autoResearch('opt', { time: '30m', measurementCommand: 'echo 0', isolate: true }, {
      _loadState: async () => ({ ...state, auditLog: [] } as DanteState), _saveState: async () => {},
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"x","fileToChange":"","change":""}',
      _runBaseline: async () => 100,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => { budgetExpired = true; return { id, description: 'x', metricValue: 50, status: 'keep' }; },
      _git: async (args: string[], cwd: string) => { gitCwds.push(cwd); return args[0] === 'status' ? '' : 'abc1234'; },
      _writeFile: async () => {}, _appendFile: async () => {},
      _isAgentEditAvailable: async () => false,
      _setupWorktree: async (_userCwd, agentName, branch) => { setup = true; return { worktreePath: WT, branch, agentName }; },
      _teardownWorktree: async () => { torn = true; },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    assert.ok(setup, 'worktree was set up');
    assert.ok(gitCwds.every(c => c === WT), 'every git op ran in the worktree, never the user tree');
    assert.ok(torn, 'worktree was torn down');
  });

  it('tears the worktree down even when the run throws', async () => {
    let torn = false;
    await autoResearch('opt', { time: '30m', measurementCommand: 'echo 0', isolate: true }, {
      _loadState: async () => makeState(), _saveState: async () => {},
      _isLLMAvailable: async () => true,
      _runBaseline: async () => { throw new Error('baseline blew up'); }, // setup fails inside the try
      _git: async () => 'abc1234',
      _writeFile: async () => {}, _appendFile: async () => {},
      _isAgentEditAvailable: async () => false,
      _setupWorktree: async (_c, agentName, branch) => ({ worktreePath: WT, branch, agentName }),
      _teardownWorktree: async () => { torn = true; },
      _now: () => 0,
    });
    assert.ok(torn, 'finally tore down the worktree despite the failure');
  });
});
