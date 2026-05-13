// Phase 14d — CodexAdapter tests (subprocess version)
//
// Tests the subprocess-managed CodexAdapter that spawns the `codex` CLI in
// the lease's worktree. Uses injected _spawn / _gitDiff / _revertFile /
// _isAvailable seams.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CodexAdapter,
  buildCodexPrompt,
  type CodexChildLike,
  type CodexAdapterOptions,
} from '../../src/matrix/adapters/codex-adapter.js';
import { runAdapter } from '../../src/matrix/adapters/adapter-interface.js';
import type { AgentLease, WorkPacket } from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
async function makeWorktree(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-proc-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeLease(worktreePath: string, overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id: 'lease.test', workPacketId: 'work.test',
    provider: 'codex', agentRole: 'dimension-engineer',
    branch: 'b', worktreePath,
    allowedWritePaths: ['src/sample.ts', 'src/lib/**'],
    allowedReadPaths: ['src/**'],
    forbiddenPaths: ['src/forbidden.ts'],
    requiredCommands: [],
    budget: { maxTokens: 200000, maxRuntimeMinutes: 30, maxIterations: 3 },
    status: 'active',
    ...overrides,
  };
}

function fakePacket(): WorkPacket {
  return {
    id: 'work.test', title: 'Test', objective: 'Add helper',
    dimensionId: 'dim.test',
    paths: { ownedPaths: ['src/sample.ts'], readOnlyPaths: [], forbiddenPaths: ['src/forbidden.ts'] },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['exists'], proof: { proofRequired: ['typecheck'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'rm worktree', riskLevel: 'low', createdAt: '',
  };
}

function fakeChild(exitCode: number, delayMs = 5): CodexChildLike {
  const emitter = new EventEmitter();
  setTimeout(() => emitter.emit('close', exitCode), delayMs);
  return {
    stdout: null, stderr: null,
    on(event: string, cb: (...args: unknown[]) => void) { emitter.on(event, cb); return this; },
    kill() { return true; },
    pid: 8888,
  };
}

function dispatchableAdapter(opts: Partial<CodexAdapterOptions> = {}): CodexAdapter {
  return new CodexAdapter({
    workPacket: fakePacket(),
    _isAvailable: async () => true,
    _spawn: () => fakeChild(0),
    _gitDiff: async () => [],
    _revertFile: async () => { /* no-op */ },
    ...opts,
  });
}

describe('CodexAdapter — basic shape', () => {
  it('has id="codex"', () => {
    const adapter = new CodexAdapter({ workPacket: fakePacket() });
    assert.equal(adapter.id, 'codex');
  });

  it('isAvailable returns the injected value', async () => {
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => false,
    });
    assert.equal(await adapter.isAvailable(), false);
  });
});

describe('CodexAdapter — happy + edge paths', () => {
  it('reports changed files when codex exits 0 and git-diff shows a sample edit', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({ _gitDiff: async () => ['src/sample.ts'] });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged, ['src/sample.ts']);
    assert.equal(result.provider, 'codex');
  });

  it('reports 0 file changes when codex judged no edits were needed', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({ _gitDiff: async () => [] });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.equal(result.filesChanged.length, 0);
  });
});

describe('CodexAdapter — lease enforcement', () => {
  it('reverts files outside allowedWritePaths and fails the run', async () => {
    const cwd = await makeWorktree();
    const reverted: string[] = [];
    const adapter = dispatchableAdapter({
      _gitDiff: async () => ['src/somewhere-unowned.ts'],
      _revertFile: async (_cwd, f) => { reverted.push(f); },
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.deepEqual(reverted, ['src/somewhere-unowned.ts']);
  });

  it('reverts forbiddenPaths even if otherwise allowed', async () => {
    const cwd = await makeWorktree();
    const reverted: string[] = [];
    const adapter = dispatchableAdapter({
      _gitDiff: async () => ['src/forbidden.ts'],
      _revertFile: async (_cwd, f) => { reverted.push(f); },
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.deepEqual(reverted, ['src/forbidden.ts']);
  });
});

describe('CodexAdapter — failure handling', () => {
  it('fails when codex exits non-zero', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({ _spawn: () => fakeChild(1) });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('codex_cli_exit_1'));
  });

  it('emits a failed event when the run fails', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({ _spawn: () => fakeChild(7) });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok((result.events ?? []).some(e => e.kind === 'failed'));
  });
});

describe('CodexAdapter — prompt construction', () => {
  it('embeds the objective + paths + acceptance criteria', () => {
    const prompt = buildCodexPrompt(fakePacket(), fakeLease('/tmp'));
    assert.ok(prompt.includes('Add helper'));
    assert.ok(prompt.includes('exists'));
    assert.ok(prompt.includes('src/sample.ts'));
  });

  it('directs the model NOT to emit JSON', () => {
    const prompt = buildCodexPrompt(fakePacket(), fakeLease('/tmp'));
    assert.ok(prompt.includes('do NOT emit JSON'));
  });
});
