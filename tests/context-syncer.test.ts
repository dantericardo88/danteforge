// context-syncer.test.ts — tests for context-syncer module
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  buildCursorContext,
  buildClaudeContext,
  buildCodexContext,
  syncContext,
} from '../src/core/context-syncer.js';
import type { ContextSyncOptions } from '../src/core/context-syncer.js';
import type { DanteState } from '../src/core/state.js';

// ── Shared test fixtures ───────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'TestProject',
    currentPhase: 2,
    workflowStage: 'tasks',
    tasks: {
      2: [
        { name: 'Build auth' },
        { name: 'Write tests' },
        { name: 'Setup DB' },
        { name: 'Add logging' },
        { name: 'Deploy pipeline' },
      ],
    },
    auditLog: [],
    profile: '',
    lastHandoff: '',
    ...overrides,
  };
}

const MOCK_CONSTITUTION = `# DanteForge Constitution
- Always write tests first
- Security by default
# Never skip phases
- Validate inputs strictly
- Follow the workflow pipeline
- Extra principle six
`;

function makeOpts(overrides: Partial<ContextSyncOptions> = {}): ContextSyncOptions {
  return {
    _loadState: async () => makeState(),
    _readFile: async () => MOCK_CONSTITUTION,
    ...overrides,
  };
}

// ── buildCursorContext tests ───────────────────────────────────────────────────

describe('buildCursorContext', () => {
  it('output includes project name', async () => {
    const result = await buildCursorContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('TestProject'), 'should contain project name');
  });

  it('returns minimal fallback when CONSTITUTION.md is missing', async () => {
    const opts = makeOpts({
      _readFile: async () => { throw new Error('file not found'); },
    });
    const result = await buildCursorContext('/fake/cwd', opts);
    assert.ok(result.includes('No constitution found'), 'should use fallback text');
    assert.ok(result.length > 0, 'should still return content');
  });

  it('includes workflow stage', async () => {
    const result = await buildCursorContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('tasks'), 'should include workflow stage');
  });

  it('includes phase number', async () => {
    const result = await buildCursorContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('2'), 'should include phase number');
  });

  it('includes DanteForge commands section', async () => {
    const result = await buildCursorContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('DanteForge Commands'), 'should include commands section');
    assert.ok(result.includes('danteforge verify'), 'should include verify command');
    assert.ok(result.includes('danteforge autoforge --auto'), 'should include autoforge command');
    assert.ok(result.includes('danteforge sync-context'), 'should include sync-context command');
  });

  it('uses state load fallback when _loadState throws', async () => {
    const opts: ContextSyncOptions = {
      _loadState: async () => { throw new Error('state unavailable'); },
      _readFile: async () => MOCK_CONSTITUTION,
    };
    const result = await buildCursorContext('/fake/cwd', opts);
    assert.ok(result.includes('unknown'), 'should use default project name on state failure');
  });
});

// ── buildClaudeContext tests ───────────────────────────────────────────────────

describe('buildClaudeContext', () => {
  it('includes maturity/phase from injected state', async () => {
    const opts = makeOpts({
      _loadState: async () => makeState({ currentPhase: 3, workflowStage: 'forge' }),
    });
    const result = await buildClaudeContext('/fake/cwd', opts);
    assert.ok(result.includes('3'), 'should include phase 3');
    assert.ok(result.includes('forge'), 'should include workflow stage forge');
  });

  it('missing constitution still returns valid markdown', async () => {
    const opts = makeOpts({
      _readFile: async () => { throw new Error('no file'); },
    });
    const result = await buildClaudeContext('/fake/cwd', opts);
    assert.ok(result.startsWith('#'), 'should start with markdown heading');
    assert.ok(result.includes('TestProject'), 'should still contain project name');
  });

  it('output is valid markdown (starts with #)', async () => {
    const result = await buildClaudeContext('/fake/cwd', makeOpts());
    assert.ok(result.trimStart().startsWith('#'), 'should start with # heading');
  });

  it('includes Active Tasks section with phase number', async () => {
    const result = await buildClaudeContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('Active Tasks'), 'should include active tasks section');
    assert.ok(result.includes('Phase 2'), 'should include phase number in tasks header');
  });
});

// ── buildCodexContext tests ────────────────────────────────────────────────────

describe('buildCodexContext', () => {
  it('includes project name', async () => {
    const result = await buildCodexContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('TestProject'), 'should contain project name');
  });

  it('includes active tasks when state has tasks', async () => {
    const result = await buildCodexContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('Build auth'), 'should include first task');
    assert.ok(result.includes('Write tests'), 'should include second task');
  });

  it('shows "No active tasks" when tasks are empty', async () => {
    const opts = makeOpts({
      _loadState: async () => makeState({ tasks: {} }),
    });
    const result = await buildCodexContext('/fake/cwd', opts);
    assert.ok(result.includes('No active tasks'), 'should show no active tasks');
  });

  it('includes constraints section', async () => {
    const result = await buildCodexContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('Constraints'), 'should include constraints section');
    assert.ok(result.includes('danteforge verify'), 'should include verify in constraints');
  });

  it('output includes project overview section', async () => {
    const result = await buildCodexContext('/fake/cwd', makeOpts());
    assert.ok(result.includes('Project Overview'), 'should include project overview');
    assert.ok(result.includes('Name: TestProject'), 'should include project name line');
  });
});

// ── syncContext tests ──────────────────────────────────────────────────────────

describe('syncContext', () => {
  it('with target cursor only writes cursor file', async () => {
    const written: string[] = [];
    const opts: ContextSyncOptions = {
      target: 'cursor',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async (p) => { written.push(p); },
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.equal(result.synced.length, 1, 'should sync exactly 1 file');
    assert.equal(result.synced[0]?.target, 'cursor', 'synced target should be cursor');
    assert.equal(written.length, 1, '_writeFile called once');
    assert.ok(written[0]?.includes('danteforge-project.mdc'), 'should write .mdc file');
  });

  it('with target all calls _writeFile 3 times', async () => {
    let writeCount = 0;
    const opts: ContextSyncOptions = {
      target: 'all',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => { writeCount++; },
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.equal(writeCount, 3, '_writeFile should be called 3 times');
    assert.equal(result.synced.length, 3, 'should have 3 synced files');
  });

  it('with target claude writes CLAUDE.local.md', async () => {
    const written: string[] = [];
    const opts: ContextSyncOptions = {
      target: 'claude',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async (p) => { written.push(p); },
      _mkdir: async () => {},
    };
    await syncContext(opts);
    assert.ok(written[0]?.endsWith('CLAUDE.local.md'), 'should write CLAUDE.local.md');
  });

  it('with target codex writes AGENTS.local.md', async () => {
    const written: string[] = [];
    const opts: ContextSyncOptions = {
      target: 'codex',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async (p) => { written.push(p); },
      _mkdir: async () => {},
    };
    await syncContext(opts);
    assert.ok(written[0]?.endsWith('AGENTS.local.md'), 'should write AGENTS.local.md');
  });

  it('_writeFile injection captures written content', async () => {
    const captured: Record<string, string> = {};
    const opts: ContextSyncOptions = {
      target: 'claude',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async (p, content) => { captured[p] = content; },
      _mkdir: async () => {},
    };
    await syncContext(opts);
    const content = Object.values(captured)[0];
    assert.ok(content !== undefined && content.length > 0, 'should capture written content');
    assert.ok(content.includes('TestProject'), 'captured content should include project name');
  });

  it('_mkdir injection is called for parent directory', async () => {
    const mkdirCalls: string[] = [];
    const opts: ContextSyncOptions = {
      target: 'cursor',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => {},
      _mkdir: async (p) => { mkdirCalls.push(p); },
    };
    await syncContext(opts);
    assert.ok(mkdirCalls.length > 0, '_mkdir should be called at least once');
    assert.ok(mkdirCalls[0]?.includes('.cursor'), 'should create .cursor directory');
  });

  it('result.synced has correct paths', async () => {
    const opts: ContextSyncOptions = {
      target: 'all',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    const paths = result.synced.map((f) => f.path);
    assert.ok(paths.some((p) => p.includes('danteforge-project.mdc')), 'should include cursor path');
    assert.ok(paths.some((p) => p.endsWith('CLAUDE.local.md')), 'should include claude path');
    assert.ok(paths.some((p) => p.endsWith('AGENTS.local.md')), 'should include codex path');
  });

  it('result.totalTokens is greater than 0', async () => {
    const opts: ContextSyncOptions = {
      target: 'all',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.ok(result.totalTokens > 0, 'totalTokens should be greater than 0');
  });

  it('SyncedContextFile tokensEstimated is greater than 0', async () => {
    const opts: ContextSyncOptions = {
      target: 'claude',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.ok(result.synced[0] !== undefined, 'should have at least one synced file');
    assert.ok(result.synced[0].tokensEstimated > 0, 'tokensEstimated should be > 0');
  });

  it('_loadState injection returns custom state visible in output', async () => {
    const opts: ContextSyncOptions = {
      target: 'cursor',
      cwd: '/fake/cwd',
      _loadState: async () => makeState({ project: 'CustomProjectName' }),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.ok(result.synced[0] !== undefined, 'should have synced file');
    assert.ok(
      result.synced[0].content.includes('CustomProjectName'),
      'content should reflect custom project name from injected state',
    );
  });

  it('default target is all when target is omitted', async () => {
    let writeCount = 0;
    const opts: ContextSyncOptions = {
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => { writeCount++; },
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.equal(writeCount, 3, 'should write 3 files when target is omitted (defaults to all)');
    assert.equal(result.synced.length, 3, 'synced should have 3 entries');
  });

  it('totalTokens equals sum of individual file token estimates', async () => {
    const opts: ContextSyncOptions = {
      target: 'all',
      cwd: '/fake/cwd',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    const sumOfParts = result.synced.reduce((sum, f) => sum + f.tokensEstimated, 0);
    assert.equal(result.totalTokens, sumOfParts, 'totalTokens should equal sum of file tokens');
  });

  it('synced file paths use provided cwd as base', async () => {
    const opts: ContextSyncOptions = {
      target: 'claude',
      cwd: '/my/project/root',
      _loadState: async () => makeState(),
      _readFile: async () => MOCK_CONSTITUTION,
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await syncContext(opts);
    assert.ok(result.synced[0]?.path.startsWith(path.sep === '\\' ? '\\my\\project\\root' : '/my/project/root') || result.synced[0]?.path.includes('my'), 'path should be based on provided cwd');
  });
});

// ── Integration: real filesystem (tmp dir) ────────────────────────────────────

describe('syncContext integration', () => {
  it('writes real files to temp directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-ctx-syncer-'));
    try {
      const opts: ContextSyncOptions = {
        target: 'claude',
        cwd: tmpDir,
        _loadState: async () => makeState(),
        _readFile: async () => MOCK_CONSTITUTION,
      };
      const result = await syncContext(opts);
      assert.equal(result.synced.length, 1, 'should sync 1 file');

      const writtenContent = await fs.readFile(result.synced[0]!.path, 'utf8');
      assert.ok(writtenContent.includes('TestProject'), 'written file should contain project name');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
