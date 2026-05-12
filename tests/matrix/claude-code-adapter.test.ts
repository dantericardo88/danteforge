// Phase 14d — ClaudeCodeAdapter tests (subprocess version)
//
// Tests the subprocess-managed ClaudeCodeAdapter that spawns the `claude`
// CLI in the lease's worktree. Uses injected _spawn / _gitDiff / _revertFile
// / _isAvailable seams so the suite never spawns a real subprocess.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ClaudeCodeAdapter,
  buildClaudeCodePrompt,
  type ClaudeChildLike,
  type ClaudeCodeAdapterOptions,
} from '../../src/matrix/adapters/claude-code-adapter.js';
import { runAdapter } from '../../src/matrix/adapters/adapter-interface.js';
import type { AgentLease, WorkPacket } from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
async function makeWorktree(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-proc-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeLease(worktreePath: string, overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id: 'lease.test', workPacketId: 'work.test',
    provider: 'claude', agentRole: 'dimension-engineer',
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

// Helper: create a fake child process that exits with the given code.
function fakeChild(exitCode: number, delayMs = 5): ClaudeChildLike {
  const emitter = new EventEmitter();
  setTimeout(() => emitter.emit('close', exitCode), delayMs);
  return {
    stdout: null, stderr: null,
    on(event: string, cb: (...args: unknown[]) => void) { emitter.on(event, cb); return this; },
    kill() { return true; },
    pid: 9999,
  };
}

/** Default seam set used by every dispatch test — only override what each test exercises. */
function dispatchableAdapter(opts: Partial<ClaudeCodeAdapterOptions> = {}): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({
    workPacket: fakePacket(),
    _isAvailable: async () => true,
    _spawn: () => fakeChild(0),
    _gitDiff: async () => [],
    _revertFile: async () => { /* no-op */ },
    ...opts,
  });
}

describe('ClaudeCodeAdapter — basic shape', () => {
  it('has id="claude" and a labeled name', () => {
    const adapter = new ClaudeCodeAdapter({ workPacket: fakePacket() });
    assert.equal(adapter.id, 'claude');
    assert.ok(adapter.name.includes('Claude'));
  });

  it('isAvailable returns the injected value', async () => {
    const adapter = new ClaudeCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => false,
    });
    assert.equal(await adapter.isAvailable(), false);
  });
});

describe('ClaudeCodeAdapter — happy path', () => {
  it('reports changed files when claude exits 0 and git-diff shows a sample edit', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({ _gitDiff: async () => ['src/sample.ts'] });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged, ['src/sample.ts']);
    assert.equal(result.provider, 'claude');
    assert.ok((result.events ?? []).some(e => e.kind === 'file_changed'));
    assert.ok((result.events ?? []).some(e => e.kind === 'completed'));
  });

  it('reports 0 file changes when claude judged no edits were needed', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({ _gitDiff: async () => [] });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.equal(result.filesChanged.length, 0);
  });

  it('handles multi-file diffs with one file_changed event per kept file', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({
      _gitDiff: async () => ['src/sample.ts', 'src/lib/helper.ts'],
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged.sort(), ['src/lib/helper.ts', 'src/sample.ts']);
    const fileEvents = (result.events ?? []).filter(e => e.kind === 'file_changed');
    assert.equal(fileEvents.length, 2);
  });
});

describe('ClaudeCodeAdapter — lease enforcement', () => {
  it('reverts files outside allowedWritePaths and fails the run', async () => {
    const cwd = await makeWorktree();
    const reverted: string[] = [];
    const adapter = dispatchableAdapter({
      _gitDiff: async () => ['src/somewhere-unowned.ts'],
      _revertFile: async (_cwd, f) => { reverted.push(f); },
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('edit_outside_lease'));
    assert.deepEqual(reverted, ['src/somewhere-unowned.ts']);
    assert.equal(result.filesChanged.length, 0);
  });

  it('reverts files matching forbiddenPaths even if otherwise allowed', async () => {
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

  it('keeps allowed-path edits even when another file is reverted (partial diff)', async () => {
    const cwd = await makeWorktree();
    const reverted: string[] = [];
    const adapter = dispatchableAdapter({
      _gitDiff: async () => ['src/sample.ts', 'src/forbidden.ts'],
      _revertFile: async (_cwd, f) => { reverted.push(f); },
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.filesChanged, ['src/sample.ts']);
    assert.deepEqual(reverted, ['src/forbidden.ts']);
  });
});

describe('ClaudeCodeAdapter — failure modes', () => {
  it('fails when the claude CLI exits non-zero', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({
      _spawn: () => fakeChild(1),
      _gitDiff: async () => { throw new Error('should not be called'); },
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('claude_cli_exit_1'));
  });

  it('emits a failed event when the run fails', async () => {
    const cwd = await makeWorktree();
    const adapter = dispatchableAdapter({ _spawn: () => fakeChild(2) });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok((result.events ?? []).some(e => e.kind === 'failed'));
  });
});

describe('ClaudeCodeAdapter — prompt construction', () => {
  it('embeds the work-packet objective and acceptance criteria', () => {
    const prompt = buildClaudeCodePrompt(fakePacket(), fakeLease('/tmp'));
    assert.ok(prompt.includes('Add helper'));
    assert.ok(prompt.includes('exists'));
  });

  it('lists every allowed + forbidden path so claude can self-respect them', () => {
    const prompt = buildClaudeCodePrompt(
      fakePacket(),
      fakeLease('/tmp', { allowedWritePaths: ['a/x.ts'], forbiddenPaths: ['b/y.ts'] }),
    );
    assert.ok(prompt.includes('a/x.ts'));
    assert.ok(prompt.includes('b/y.ts'));
  });

  it('explicitly directs the model NOT to emit JSON (subprocess pattern)', () => {
    const prompt = buildClaudeCodePrompt(fakePacket(), fakeLease('/tmp'));
    assert.ok(prompt.includes('do NOT emit JSON'));
    assert.ok(prompt.includes('via git status'));
  });
});
