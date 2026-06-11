// autoresearch-worktree.test.ts — isolated-worktree setup/teardown + the command-level isolate path.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorktree, teardownWorktree, type WorktreeDeps } from '../src/cli/commands/autoresearch-worktree.js';
import { autoResearch } from '../src/cli/commands/autoresearch.js';
import { bindGitToCwd, assertGitTargetNotUserTree, type GitFn } from '../src/cli/commands/autoresearch-git.js';
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

  it('drives a rollback through the loop: the reset runs in the worktree, NEVER the user tree (the fleet-run-2 leak)', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    let budgetExpired = false;
    const userCwd = process.cwd();
    const state = makeState();
    await autoResearch('opt', { time: '30m', measurementCommand: 'echo 0', isolate: true }, {
      _loadState: async () => ({ ...state, auditLog: [] } as DanteState), _saveState: async () => {},
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"x","fileToChange":"","change":""}',
      _runBaseline: async () => 50,
      // Worse than baseline → discard → doRollback → git reset --hard must address the WORKTREE.
      _runExperiment: async (_c, id): Promise<ExperimentResult> => { budgetExpired = true; return { id, description: 'x', metricValue: 200, status: 'discard' }; },
      _git: async (args: string[], cwd: string) => { calls.push({ args: [...args], cwd }); return args[0] === 'status' ? '' : 'abc1234'; },
      _writeFile: async () => {}, _appendFile: async () => {},
      _isAgentEditAvailable: async () => false,
      _setupWorktree: async (_userCwd, agentName, branch) => ({ worktreePath: WT, branch, agentName }),
      _teardownWorktree: async () => {},
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    assert.ok(calls.length > 0, 'git was actually exercised');
    assert.ok(calls.some(c => c.args[0] === 'reset' && c.cwd === WT), 'the rollback reset ran in the worktree');
    assert.ok(calls.every(c => c.cwd === WT), 'EVERY git invocation was pinned to the worktree');
    assert.ok(!calls.some(c => c.cwd === userCwd), 'NO git invocation addressed the user tree');
  });

  it('non-isolated mode unchanged: every git op (including the rollback reset) addresses the user cwd', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    let budgetExpired = false;
    const userCwd = process.cwd();
    const state = makeState();
    await autoResearch('opt', { time: '30m', measurementCommand: 'echo 0' }, {
      _loadState: async () => ({ ...state, auditLog: [] } as DanteState), _saveState: async () => {},
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"x","fileToChange":"","change":""}',
      _runBaseline: async () => 50,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => { budgetExpired = true; return { id, description: 'x', metricValue: 200, status: 'discard' }; },
      _git: async (args: string[], cwd: string) => { calls.push({ args: [...args], cwd }); return args[0] === 'status' ? '' : 'abc1234'; },
      _writeFile: async () => {}, _appendFile: async () => {},
      _isAgentEditAvailable: async () => false,
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    assert.ok(calls.length > 0, 'git was actually exercised');
    assert.ok(calls.every(c => c.cwd === userCwd), 'without --isolate every git op runs in the user cwd');
    assert.ok(calls.some(c => c.args[0] === 'reset' && c.cwd === userCwd), 'the rollback legitimately targets the user tree when isolation is off');
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

// ── bindGitToCwd / assertGitTargetNotUserTree — the isolation pin itself ─────────

const USER = process.platform === 'win32' ? 'C:\\user' : '/user';

describe('bindGitToCwd — the isolation pin', () => {
  it('pins every invocation to the worktree regardless of the cwd the caller passes', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const base: GitFn = async (args, cwd) => { calls.push({ args: [...args], cwd }); return ''; };
    const pinned = bindGitToCwd(base, WT, USER);
    // A pre-isolation closure addressing the user's tree — the exact fleet-run-2 shape.
    await pinned(['reset', '--hard', 'ca66098c'], USER);
    await pinned(['checkout', 'main'], USER);
    await pinned(['status', '--porcelain'], WT);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(c => c.cwd === WT), 'every call repinned to the worktree');
    assert.ok(!calls.some(c => c.cwd === USER), 'the user tree is unreachable through the pinned adapter');
  });

  it('refuses construction when the "worktree" resolves to the user tree (isolation would be a no-op)', () => {
    const base: GitFn = async () => '';
    assert.throws(() => bindGitToCwd(base, USER, USER), /isolation pin refused/);
  });
});

describe('assertGitTargetNotUserTree — rollback defense in depth', () => {
  it('throws loudly, naming the leak, when a reset would target the user tree under isolation', () => {
    assert.throws(
      () => assertGitTargetNotUserTree(USER, USER, 'git reset --hard ca66098c'),
      /ISOLATION LEAK/,
    );
  });

  it('allows the worktree target under isolation, and any target when isolation is off', () => {
    assert.doesNotThrow(() => assertGitTargetNotUserTree(WT, USER, 'git reset --hard abc'));
    assert.doesNotThrow(() => assertGitTargetNotUserTree(USER, undefined, 'git reset --hard abc'));
  });
});
