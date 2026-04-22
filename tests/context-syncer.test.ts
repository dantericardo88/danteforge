import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCursorContext,
  buildClaudeContext,
  buildCodexContext,
  syncContext,
  type ContextSyncOptions,
} from '../src/core/context-syncer.js';
import type { DanteState } from '../src/core/state.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    currentPhase: 2,
    workflowStage: 'forge',
    tasks: {
      2: [{ name: 'task-A', completed: false }, { name: 'task-B', completed: false }],
    },
    auditLog: [],
    profile: '',
    lastHandoff: '',
    ...overrides,
  } as DanteState;
}

function noopOpts(stateOverrides?: Partial<DanteState>): ContextSyncOptions {
  return {
    cwd: '/tmp/test',
    _loadState: async () => makeState(stateOverrides),
    _readFile: async () => { throw new Error('not found'); },
    _writeFile: async () => {},
    _mkdir: async () => {},
  };
}

describe('buildCursorContext', () => {
  it('contains project name in output', async () => {
    const content = await buildCursorContext('/tmp/test', noopOpts());
    assert.ok(content.includes('test-project'));
  });

  it('contains workflow stage', async () => {
    const content = await buildCursorContext('/tmp/test', noopOpts());
    assert.ok(content.includes('forge'));
  });

  it('includes fallback message when no constitution', async () => {
    const content = await buildCursorContext('/tmp/test', noopOpts());
    assert.ok(content.includes('No constitution found'));
  });

  it('renders constitution principles when file is present', async () => {
    const opts: ContextSyncOptions = {
      ...noopOpts(),
      _readFile: async () => '# Principles\n- Zero ambiguity\n- Test everything',
    };
    const content = await buildCursorContext('/tmp/test', opts);
    assert.ok(content.includes('Zero ambiguity'));
  });

  it('lists active tasks', async () => {
    const content = await buildCursorContext('/tmp/test', noopOpts());
    assert.ok(content.includes('task-A'));
  });

  it('shows "No active tasks" when task list empty', async () => {
    const opts = noopOpts({ tasks: {} });
    const content = await buildCursorContext('/tmp/test', opts);
    assert.ok(content.includes('No active tasks'));
  });
});

describe('buildClaudeContext', () => {
  it('contains project name', async () => {
    const content = await buildClaudeContext('/tmp/test', noopOpts());
    assert.ok(content.includes('test-project'));
  });

  it('includes phase number', async () => {
    const content = await buildClaudeContext('/tmp/test', noopOpts());
    assert.ok(content.includes('2'));
  });

  it('includes fallback when no constitution', async () => {
    const content = await buildClaudeContext('/tmp/test', noopOpts());
    assert.ok(content.includes('No constitution found'));
  });
});

describe('buildCodexContext', () => {
  it('contains project name', async () => {
    const content = await buildCodexContext('/tmp/test', noopOpts());
    assert.ok(content.includes('test-project'));
  });

  it('includes workflow stage', async () => {
    const content = await buildCodexContext('/tmp/test', noopOpts());
    assert.ok(content.includes('forge'));
  });
});

describe('syncContext', () => {
  it('syncs all three targets by default', async () => {
    const written: string[] = [];
    const opts: ContextSyncOptions = {
      cwd: '/tmp/sync-test',
      _loadState: async () => makeState(),
      _readFile: async () => { throw new Error('not found'); },
      _writeFile: async (p) => { written.push(p); },
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.equal(result.synced.length, 3);
    assert.equal(result.skipped.length, 0);
    assert.ok(result.totalTokens > 0);
  });

  it('syncs only cursor target when specified', async () => {
    const opts: ContextSyncOptions = {
      ...noopOpts(),
      target: 'cursor',
    };
    const result = await syncContext(opts);
    assert.equal(result.synced.length, 1);
    assert.equal(result.synced[0].target, 'cursor');
  });

  it('syncs only claude target when specified', async () => {
    const opts: ContextSyncOptions = {
      ...noopOpts(),
      target: 'claude',
    };
    const result = await syncContext(opts);
    assert.equal(result.synced.length, 1);
    assert.equal(result.synced[0].target, 'claude');
  });

  it('synced files have tokensEstimated > 0', async () => {
    const result = await syncContext(noopOpts());
    for (const f of result.synced) {
      assert.ok(f.tokensEstimated > 0, `${f.target} should have tokens > 0`);
    }
  });

  it('synced files contain content', async () => {
    const result = await syncContext(noopOpts());
    for (const f of result.synced) {
      assert.ok(f.content.length > 0, `${f.target} should have content`);
    }
  });

  it('skips target on write error', async () => {
    const opts: ContextSyncOptions = {
      cwd: '/tmp/skip-test',
      _loadState: async () => makeState(),
      _readFile: async () => { throw new Error('not found'); },
      _writeFile: async () => { throw new Error('write failed'); },
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.equal(result.synced.length, 0);
    assert.equal(result.skipped.length, 3);
  });
});
