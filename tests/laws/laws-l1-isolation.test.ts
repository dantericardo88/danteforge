// LAW L1 — Isolation: under --isolate, no git mutation ever addresses the user's tree.
//
// Pins the fleet-run-2 leak (docs/SEAM_HARDENING_PLAN.md): a pre-isolation git closure ran
// `git reset --hard` against the OPERATOR'S MAIN TREE while the experiment edits happened in the
// worktree — uncommitted fixes wiped, edits re-reverted for minutes. Driven through the REAL
// autoResearch entry point with a recording GitFn (real coordination, recorded work), then through
// harden-crusade's exported mergeBackIsolatedBranch on real git repos.
//
// NEGATIVE CONTROLS: the leaky-closure shape is re-introduced via the same seams and the law
// (checkGitIsolation + assertGitTargetNotUserTree + bindGitToCwd's pin) is asserted to TRIP.

import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { autoResearch } from '../../src/cli/commands/autoresearch.js';
import {
  bindGitToCwd, assertGitTargetNotUserTree, type GitFn,
} from '../../src/cli/commands/autoresearch-git.js';
import { mergeBackIsolatedBranch } from '../../src/cli/commands/harden-crusade.js';
import type { ExperimentResult } from '../../src/core/autoresearch-engine.js';
import {
  lawsTmpDir, rmrf, makeRepo, git, makeRecordingGit, checkGitIsolation, isMutatingGit,
} from './rig.js';

const ROOT = lawsTmpDir('l1');
before(async () => { await fs.mkdir(ROOT, { recursive: true }); });
after(async () => { await rmrf(ROOT); });

describe('L1 — autoResearch --isolate drive-through (setup → experiment keep+discard → rollback)', () => {
  test('every recorded git call under isolation targets the worktree; zero calls touch the user tree', async () => {
    const userTree = path.join(ROOT, 'user-tree');
    const worktree = path.join(ROOT, 'agent-worktree');
    await fs.mkdir(userTree, { recursive: true });
    await fs.mkdir(worktree, { recursive: true });

    const recording = makeRecordingGit();
    let t = 0;
    let experimentCalls = 0;
    let teardownCalls = 0;
    const auditLog: string[] = [];
    const prevCwd = process.cwd();
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;
    process.chdir(userTree);
    try {
      await autoResearch('laws-l1 isolation drive', {
        metric: 'capability pass rate',
        time: '5m',
        measurementCommand: 'node measure.js',
        isolate: true,
        isolateBranch: 'autoresearch/laws-l1',
      }, {
        _git: recording.fn,
        _setupWorktree: async (_userCwd, agentName, branch) => ({ worktreePath: worktree, branch, agentName }),
        _teardownWorktree: async () => { teardownCalls++; },
        _isAgentEditAvailable: async () => true,
        _dispatchAgentEdit: async (_cfg, id) => ({ description: `recorded agent edit ${id}`, ranOk: true }),
        _runBaseline: async () => 10,
        _runExperiment: async (_cfg, id, desc): Promise<ExperimentResult> => {
          experimentCalls++;
          t += 120_000; // advance the injected clock so the loop ends after two experiments
          return { id, description: desc, metricValue: id === 1 ? 5 : 20, status: 'keep' };
        },
        _isLLMAvailable: async () => false,
        _callLLM: async () => { throw new Error('LLM must not be consulted in this drive'); },
        _writeFile: async () => {},
        _appendFile: async () => {},
        _readFile: async () => '',
        _sleep: async () => {},
        _now: () => t,
        _loadState: async () => ({ auditLog } as never),
        _saveState: async () => {},
      });
    } finally {
      process.chdir(prevCwd);
    }

    assert.notEqual(process.exitCode, 1, 'the drive-through itself must not error out behind the error boundary');
    process.exitCode = prevExitCode;
    assert.equal(experimentCalls, 2, 'both experiments (one keep, one discard) ran');
    assert.equal(teardownCalls, 1, 'isolated session torn down exactly once');

    // The law: NO recorded git call addressed the user tree (reads included — under --isolate
    // even the dirty-check is skipped, so the user tree is fully untouchable).
    const userCalls = recording.calls.filter(c => path.resolve(c.cwd) === path.resolve(userTree));
    assert.deepEqual(userCalls, [], `user-tree git calls recorded: ${JSON.stringify(userCalls)}`);
    assert.deepEqual(checkGitIsolation(recording.calls, userTree), [], 'isolation law clean');

    // Non-vacuous: the drive really exercised mutating verbs (commit for the keep, reset for the discard).
    const mutations = recording.calls.filter(c => isMutatingGit(c.args));
    assert.ok(mutations.some(c => c.args[0] === 'commit'), 'a keep produced a commit in the worktree');
    assert.ok(mutations.some(c => c.args[0] === 'reset' && c.args[1] === '--hard'), 'a discard produced a rollback reset in the worktree');
    for (const m of mutations) {
      assert.equal(path.resolve(m.cwd), path.resolve(worktree), `mutation pinned to the worktree: git ${m.args.join(' ')}`);
    }
  });
});

describe('L1 — NEGATIVE controls: the fleet-run-2 leaky shapes trip the law', () => {
  test('a leaky GitFn that hard-binds the user tree is CAUGHT by checkGitIsolation even through the pin', async () => {
    const userTree = path.join(ROOT, 'neg-user');
    const worktree = path.join(ROOT, 'neg-worktree');
    await fs.mkdir(userTree, { recursive: true });
    await fs.mkdir(worktree, { recursive: true });
    const recording = makeRecordingGit();
    // The fleet-run-2 shape: a closure captured BEFORE isolation that ignores the cwd it is
    // handed and always addresses the operator's checkout.
    const leaky: GitFn = (args) => recording.fn(args, userTree);
    const bound = bindGitToCwd(leaky, worktree, userTree);
    await bound(['reset', '--hard', 'HEAD'], worktree);
    const violations = checkGitIsolation(recording.calls, userTree);
    assert.equal(violations.length, 1, 'the law MUST trip on a reset that reached the user tree');
    assert.match(violations[0]!, /reset --hard/);
  });

  test('bindGitToCwd repins a wrong requested cwd to the worktree (the pre-isolation closure case)', async () => {
    const userTree = path.join(ROOT, 'pin-user');
    const worktree = path.join(ROOT, 'pin-worktree');
    await fs.mkdir(userTree, { recursive: true });
    await fs.mkdir(worktree, { recursive: true });
    const recording = makeRecordingGit();
    const bound = bindGitToCwd(recording.fn, worktree, userTree);
    await bound(['reset', '--hard', 'HEAD'], userTree); // caller asks for the USER tree
    assert.equal(recording.calls.length, 1);
    assert.equal(path.resolve(recording.calls[0]!.cwd), path.resolve(worktree), 'repinned to the worktree');
    assert.deepEqual(checkGitIsolation(recording.calls, userTree), []);
  });

  test('constructing the pin against the user tree itself is refused outright', async () => {
    const userTree = path.join(ROOT, 'refuse-user');
    await fs.mkdir(userTree, { recursive: true });
    const recording = makeRecordingGit();
    assert.throws(() => bindGitToCwd(recording.fn, userTree, userTree), /isolation pin refused/);
  });

  test('assertGitTargetNotUserTree throws on the user tree under isolation, passes otherwise', () => {
    const userTree = path.join(ROOT, 'assert-user');
    assert.throws(() => assertGitTargetNotUserTree(userTree, userTree, 'git reset --hard abc'), /ISOLATION LEAK/);
    assert.doesNotThrow(() => assertGitTargetNotUserTree(path.join(ROOT, 'elsewhere'), userTree, 'git reset --hard abc'));
    assert.doesNotThrow(() => assertGitTargetNotUserTree(userTree, undefined, 'git reset --hard abc'), 'isolation off — user tree is the legitimate target');
  });
});

describe('L1 — merge-back path: kept work lands WITHOUT ever moving the operator checkout', () => {
  function reflogSubjects(dir: string): string[] {
    return git(dir, 'reflog', '--format=%gs').split('\n').filter(Boolean);
  }

  test('kept commits merge into the current branch with zero checkout/reset reflog entries', async () => {
    const dir = await makeRepo(path.join(ROOT, 'mb-clean'));
    git(dir, 'branch', 'autoresearch/laws-mb-1');
    git(dir, 'switch', '-q', 'autoresearch/laws-mb-1');
    await fs.writeFile(path.join(dir, 'kept.txt'), 'kept\n', 'utf8');
    git(dir, 'add', 'kept.txt');
    git(dir, 'commit', '-qm', 'kept work');
    git(dir, 'switch', '-q', 'main');
    const reflogBefore = reflogSubjects(dir).length;
    const headRefBefore = git(dir, 'symbolic-ref', '--short', 'HEAD');

    await mergeBackIsolatedBranch(dir, 'autoresearch/laws-mb-1', 'laws-dim', 'main');

    assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD'), headRefBefore, 'operator checkout never moved');
    const newEntries = reflogSubjects(dir).slice(0, reflogSubjects(dir).length - reflogBefore);
    for (const entry of newEntries) {
      assert.doesNotMatch(entry, /^(checkout|reset):/, `merge-back must never checkout/reset the user tree — saw "${entry}"`);
    }
    assert.ok(newEntries.some(e => /^merge /.test(e)), 'kept work landed via a merge (the only sanctioned mutation)');
    assert.equal(await fs.readFile(path.join(dir, 'kept.txt'), 'utf8'), 'kept\n');
  });

  test('a moved checkout (expectedRef mismatch) blocks the merge — kept work stays on its branch', async () => {
    const dir = await makeRepo(path.join(ROOT, 'mb-moved'));
    git(dir, 'branch', 'autoresearch/laws-mb-2');
    git(dir, 'switch', '-q', 'autoresearch/laws-mb-2');
    await fs.writeFile(path.join(dir, 'kept2.txt'), 'kept2\n', 'utf8');
    git(dir, 'add', 'kept2.txt');
    git(dir, 'commit', '-qm', 'kept work 2');
    git(dir, 'switch', '-q', 'main');
    const headBefore = git(dir, 'rev-parse', 'HEAD');

    // The run started on a DIFFERENT ref than the operator is on now — merging would misdeliver.
    await mergeBackIsolatedBranch(dir, 'autoresearch/laws-mb-2', 'laws-dim', 'feature/elsewhere');

    assert.equal(git(dir, 'rev-parse', 'HEAD'), headBefore, 'nothing merged onto the moved checkout');
    assert.ok(git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/autoresearch/laws-mb-2'), 'kept work preserved for review');
  });

  test('a detached HEAD blocks the merge entirely', async () => {
    const dir = await makeRepo(path.join(ROOT, 'mb-detached'));
    git(dir, 'branch', 'autoresearch/laws-mb-3');
    git(dir, 'switch', '-q', 'autoresearch/laws-mb-3');
    await fs.writeFile(path.join(dir, 'kept3.txt'), 'kept3\n', 'utf8');
    git(dir, 'add', 'kept3.txt');
    git(dir, 'commit', '-qm', 'kept work 3');
    git(dir, 'switch', '-q', 'main');
    git(dir, 'checkout', '-q', '--detach', 'HEAD');
    const headBefore = git(dir, 'rev-parse', 'HEAD');

    await mergeBackIsolatedBranch(dir, 'autoresearch/laws-mb-3', 'laws-dim', 'main');

    assert.equal(git(dir, 'rev-parse', 'HEAD'), headBefore, 'detached HEAD untouched');
    assert.ok(git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/autoresearch/laws-mb-3'), 'kept work preserved');
  });
});
