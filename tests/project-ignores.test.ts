import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  cleanGeneratedAgentState,
  ensureProjectIgnores,
  inspectProjectHygiene,
} from '../src/core/project-ignores.js';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-hygiene-'));
  tempRoots.push(root);
  return root;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

describe('project hygiene ignores', () => {
  it('writes idempotent ignore files for file-walking coding agents', async () => {
    const cwd = await makeWorkspace();
    await fs.writeFile(path.join(cwd, '.gitignore'), '# user rules\nnode_modules/\n', 'utf8');

    await ensureProjectIgnores(cwd);
    await ensureProjectIgnores(cwd);

    const gitignore = await fs.readFile(path.join(cwd, '.gitignore'), 'utf8');
    const claudeignore = await fs.readFile(path.join(cwd, '.claudeignore'), 'utf8');
    const cursorignore = await fs.readFile(path.join(cwd, '.cursorignore'), 'utf8');

    assert.match(gitignore, /# user rules/);
    assert.equal((gitignore.match(/DanteForge agent hygiene start/g) ?? []).length, 1);
    assert.equal((claudeignore.match(/DanteForge agent hygiene start/g) ?? []).length, 1);
    assert.equal((cursorignore.match(/DanteForge agent hygiene start/g) ?? []).length, 1);
    for (const content of [gitignore, claudeignore, cursorignore]) {
      assert.match(content, /\.danteforge\/oss-repos\//);
      assert.match(content, /\.claude\/worktrees\//);
      assert.match(content, /\.dantecode\//);
      assert.match(content, /\.tmp-\*\//);
    }
    assert.equal((gitignore.match(/node_modules\//g) ?? []).length, 1);
  });

  it('patches DanteCode excludePatterns without duplicating entries', async () => {
    const cwd = await makeWorkspace();
    const statePath = path.join(cwd, '.dantecode', 'STATE.yaml');
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(
      statePath,
      [
        'version: 1.0.0',
        'project:',
        '  excludePatterns:',
        '    - node_modules/',
      ].join('\n') + '\n',
      'utf8',
    );

    await ensureProjectIgnores(cwd);
    await ensureProjectIgnores(cwd);

    const state = await fs.readFile(statePath, 'utf8');
    assert.match(state, /\.dantecode\/worktrees\//);
    assert.match(state, /\.danteforge\/oss-repos\//);
    assert.equal((state.match(/\.dantecode\/worktrees\//g) ?? []).length, 1);
  });

  it('reports cleanup candidates without recursively walking huge caches', async () => {
    const cwd = await makeWorkspace();
    await fs.mkdir(path.join(cwd, '.danteforge', 'oss-repos'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.dantecode', 'index.json'), '{}', 'utf8').catch(async () => {
      await fs.mkdir(path.join(cwd, '.dantecode'), { recursive: true });
      await fs.writeFile(path.join(cwd, '.dantecode', 'index.json'), '{}', 'utf8');
    });

    const report = await inspectProjectHygiene(cwd);
    assert.ok(report.cleanupCandidates.some(c => c.relativePath === '.danteforge/oss-repos'));
    assert.ok(report.cleanupCandidates.some(c => c.relativePath === '.dantecode/index.json'));
  });
});

describe('generated agent state cleanup', () => {
  it('supports dry-run cleanup and preserves workflow state files', async () => {
    const cwd = await makeWorkspace();
    const statePath = path.join(cwd, '.danteforge', 'STATE.yaml');
    const ossPath = path.join(cwd, '.danteforge', 'oss-repos');
    await fs.mkdir(ossPath, { recursive: true });
    await fs.writeFile(statePath, 'workflowStage: plan\n', 'utf8');
    await fs.mkdir(path.join(cwd, '.dantecode'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.dantecode', 'index.json'), '{}', 'utf8');
    await fs.mkdir(path.join(cwd, '.tmp-example'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'test-run1.log'), 'log', 'utf8');

    const dryRun = await cleanGeneratedAgentState(cwd, { dryRun: true });
    assert.ok(dryRun.actions.some(a => a.status === 'would-remove'));
    assert.equal(await exists(ossPath), true);
    assert.equal(await exists(statePath), true);

    const result = await cleanGeneratedAgentState(cwd, { dryRun: false });
    assert.ok(result.actions.some(a => a.relativePath === '.danteforge/oss-repos' && a.status === 'removed'));
    assert.equal(await exists(ossPath), false);
    assert.equal(await exists(path.join(cwd, '.dantecode', 'index.json')), false);
    assert.equal(await exists(path.join(cwd, '.tmp-example')), false);
    assert.equal(await exists(path.join(cwd, 'test-run1.log')), false);
    assert.equal(await exists(statePath), true);
  });

  it('skips tracked cleanup-looking files unless forced', async () => {
    const cwd = await makeWorkspace();
    const logPath = path.join(cwd, 'test-output.txt');
    await fs.writeFile(logPath, 'tracked fixture', 'utf8');
    const git = async (args: string[]) => {
      if (args[0] === 'ls-files' && args.includes('test-output.txt')) {
        return 'test-output.txt\n';
      }
      return '';
    };

    const dryRunSkipped = await cleanGeneratedAgentState(cwd, { dryRun: true, _git: git });
    assert.ok(dryRunSkipped.actions.some(a => (
      a.relativePath === 'test-output.txt'
      && a.status === 'skipped'
      && a.reason === 'tracked by git'
    )));

    const skipped = await cleanGeneratedAgentState(cwd, { dryRun: false, _git: git });
    assert.ok(skipped.actions.some(a => (
      a.relativePath === 'test-output.txt'
      && a.status === 'skipped'
      && a.reason === 'tracked by git'
    )));
    assert.equal(await exists(logPath), true);

    const forced = await cleanGeneratedAgentState(cwd, { dryRun: false, force: true, _git: git });
    assert.ok(forced.actions.some(a => a.relativePath === 'test-output.txt' && a.status === 'removed'));
    assert.equal(await exists(logPath), false);
  });

  it('skips registered worktrees with tracked changes unless forced', async () => {
    const cwd = await makeWorkspace();
    const worktreePath = path.join(cwd, '.claude', 'worktrees', 'agent-a');
    const calls: string[][] = [];
    const git = async (args: string[], gitCwd?: string) => {
      calls.push([gitCwd ?? '', ...args]);
      if (args.join(' ') === 'worktree list --porcelain') {
        return [
          `worktree ${cwd}`,
          'branch refs/heads/main',
          '',
          `worktree ${worktreePath}`,
          'branch refs/heads/worktree-agent-a',
          '',
        ].join('\n');
      }
      if (gitCwd === worktreePath && args.join(' ') === 'status --short --untracked-files=no') {
        return ' M src/index.ts\n';
      }
      return '';
    };

    const skipped = await cleanGeneratedAgentState(cwd, { dryRun: false, _git: git });
    assert.ok(skipped.actions.some(a => a.relativePath.includes('.claude/worktrees/agent-a') && a.status === 'skipped'));
    assert.equal(calls.some(c => c.includes('remove')), false);

    calls.length = 0;
    const forced = await cleanGeneratedAgentState(cwd, { dryRun: false, force: true, _git: git });
    assert.ok(forced.actions.some(a => a.relativePath.includes('.claude/worktrees/agent-a') && a.status === 'removed'));
    assert.ok(calls.some(c => c.includes('remove')));
    assert.ok(calls.some(c => c.includes('prune')));
  });
});
