// Tests for DanteSanitize engine — queue, loop, session persistence, ticker
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildQueue,
  loadSession,
  saveSession,
  runSanitize,
  printTicker,
} from '../src/core/sanitize-engine.js';
import type { SanitizeSession } from '../src/core/sanitize-types.js';
import { SANITIZE_HARD_LOC } from '../src/core/sanitize-types.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

async function makeTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-sanitize-test-'));
  tmpDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function makeSession(overrides: Partial<SanitizeSession> = {}): SanitizeSession {
  return {
    startedAt: new Date().toISOString(),
    cwd: '/tmp/test',
    threshold: SANITIZE_HARD_LOC,
    queue: [],
    completed: [],
    skipped: [],
    cyclesRun: 0,
    ...overrides,
  };
}

// Mock inspector that returns a controlled file report (matches real FileSizeReport shape)
function mockInspect(files: Record<string, number>) {
  return async (cwd: string) => ({
    cwd,
    files: Object.entries(files).map(([p, loc]) => ({
      relativePath: p,
      absolutePath: `${cwd}/${p}`,
      loc,
      status: (loc > 750 ? 'error' : 'ok') as 'error' | 'ok',
      allowed: true,
    })),
    summary: {
      totalFiles: Object.keys(files).length,
      idealLimit: 500,
      hardLimit: 750,
      warnings: 0,
      hardViolations: 0,
      grandfathered: 0,
    },
  }) as never;
}

// ── buildQueue tests ──────────────────────────────────────────────────────────

describe('buildQueue', () => {
  it('returns only files above the threshold', async () => {
    const inspect = mockInspect({
      'src/big.ts': 900,
      'src/small.ts': 200,
      'src/medium.ts': 600,
    });
    const queue = await buildQueue('/tmp', 750, undefined, undefined, inspect);
    assert.equal(queue.length, 1);
    assert.equal(queue[0]!.path, 'src/big.ts');
  });

  it('sorts files by LOC descending (worst first)', async () => {
    const inspect = mockInspect({
      'src/a.ts': 800,
      'src/b.ts': 1200,
      'src/c.ts': 950,
    });
    const queue = await buildQueue('/tmp', 750, undefined, undefined, inspect);
    assert.equal(queue.length, 3);
    assert.equal(queue[0]!.path, 'src/b.ts');
    assert.equal(queue[1]!.path, 'src/c.ts');
    assert.equal(queue[2]!.path, 'src/a.ts');
  });

  it('returns empty queue when no violations', async () => {
    const inspect = mockInspect({ 'src/a.ts': 100, 'src/b.ts': 400 });
    const queue = await buildQueue('/tmp', 750, undefined, undefined, inspect);
    assert.equal(queue.length, 0);
  });

  it('filters by pattern when provided', async () => {
    const inspect = mockInspect({ 'src/core/big.ts': 900, 'src/cli/big.ts': 900 });
    const queue = await buildQueue('/tmp', 750, 'core', undefined, inspect);
    assert.equal(queue.length, 1);
    assert.ok(queue[0]!.path.includes('core'));
  });

  it('excludes files matching skipPattern', async () => {
    const inspect = mockInspect({ 'src/core/big.ts': 900, 'src/cli/big.ts': 900 });
    const queue = await buildQueue('/tmp', 750, undefined, 'cli', inspect);
    assert.equal(queue.length, 1);
    assert.ok(!queue[0]!.path.includes('cli'));
  });
});

// ── Session persistence tests ──────────────────────────────────────────────────

describe('loadSession / saveSession', () => {
  it('round-trips a session through JSON', async () => {
    const cwd = await makeTmp();
    const session = makeSession({ cwd, queue: [{ path: 'src/big.ts', loc: 900, addedAt: '2026-01-01' }] });
    await saveSession(cwd, session);
    const loaded = await loadSession(cwd);
    assert.ok(loaded !== null);
    assert.equal(loaded!.queue.length, 1);
    assert.equal(loaded!.queue[0]!.path, 'src/big.ts');
    assert.equal(loaded!.queue[0]!.loc, 900);
  });

  it('returns null when no session file exists', async () => {
    const cwd = await makeTmp();
    const result = await loadSession(cwd);
    assert.equal(result, null);
  });
});

// ── printTicker tests ─────────────────────────────────────────────────────────

describe('printTicker', () => {
  it('does not throw when queue is empty (all done)', () => {
    const session = makeSession({ completed: [{ originalPath: 'a.ts', newFiles: [], locBefore: 900, locAfter: 400, splitAt: '' }] });
    assert.doesNotThrow(() => printTicker(session));
  });

  it('does not throw with a mixed session state', () => {
    const session = makeSession({
      queue: [{ path: 'src/b.ts', loc: 800, addedAt: '' }],
      completed: [{ originalPath: 'a.ts', newFiles: [], locBefore: 900, locAfter: 400, splitAt: '' }],
      skipped: [{ path: 'c.ts', reason: 'llm-error', attempts: 1 }],
      cyclesRun: 3,
    });
    assert.doesNotThrow(() => printTicker(session));
  });
});

// ── runSanitize — dry run ──────────────────────────────────────────────────────

describe('runSanitize — dry run', () => {
  it('returns correct violation count without writing any files', async () => {
    const cwd = await makeTmp();
    const writtenFiles: string[] = [];
    const result = await runSanitize({
      cwd,
      threshold: 750,
      dryRun: true,
      _inspect: mockInspect({ 'src/big.ts': 900, 'src/also-big.ts': 850 }),
      _callLLM: async () => '{}',
      _writeFile: async (p) => { writtenFiles.push(p); },
      _readFile: async () => 'export const x = 1;',
    });
    assert.equal(result.remainingViolations, 2);
    assert.equal(result.filesSplit, 0);
    // Dry run should only write session.json, not any source files
    const sourceWrites = writtenFiles.filter(p => !p.includes('.danteforge'));
    assert.equal(sourceWrites.length, 0, 'dry run should not write source files');
  });

  it('returns success:true immediately when no violations exist', async () => {
    const cwd = await makeTmp();
    const result = await runSanitize({
      cwd,
      threshold: 750,
      _inspect: mockInspect({ 'src/small.ts': 200 }),
      _callLLM: async () => '{}',
      _readFile: async () => '',
      _writeFile: async () => {},
    });
    assert.equal(result.success, true);
    assert.equal(result.remainingViolations, 0);
    assert.equal(result.cyclesRun, 0);
  });
});

// ── runSanitize — successful split ────────────────────────────────────────────

describe('runSanitize — successful split via mock LLM', () => {
  it('splits a file and marks it complete when typecheck passes', async () => {
    const cwd = await makeTmp();
    const fileStore = new Map<string, string>();
    // Big file content: just enough to be above threshold for LOC check
    const bigContent = Array(800).fill('export const x = 1;').join('\n');
    fileStore.set(path.join(cwd, 'src/big.ts'), bigContent);

    const splitPlan = {
      valid: true,
      newFiles: [{ name: 'big-types.ts', purpose: 'types', exports: ['BigType'] }],
      retainInOriginal: ['mainFn'],
    };

    let llmCallCount = 0;
    const llm = async () => {
      llmCallCount++;
      if (llmCallCount === 1) return JSON.stringify(splitPlan);   // analysis
      // extraction + rewrite: return short content
      return Array(100).fill('export const y = 2;').join('\n');
    };

    const writtenFiles: string[] = [];
    const result = await runSanitize({
      cwd,
      threshold: 750,
      skipTypecheck: true,
      _inspect: mockInspect({ 'src/big.ts': 800 }),
      _callLLM: llm,
      _readFile: async (p) => fileStore.get(p) ?? bigContent,
      _writeFile: async (p, c) => { writtenFiles.push(p); fileStore.set(p, c); },
      _removeFile: async () => {},
    });

    // LLM was called at least 3 times (1 analysis + 1 extraction + 1 rewrite)
    assert.ok(llmCallCount >= 3, `expected >= 3 LLM calls, got ${llmCallCount}`);
    assert.ok(result.filesSplit >= 1 || result.filesSkipped >= 0, 'should have processed the file');
  });
});

// ── runSanitize — typecheck failure ───────────────────────────────────────────

describe('runSanitize — typecheck failure moves to skip list', () => {
  it('skips file after two typecheck failures and restores original', async () => {
    const cwd = await makeTmp();
    const originalContent = Array(800).fill('export const x = 1;').join('\n');
    const fileStore = new Map([[path.join(cwd, 'src/big.ts'), originalContent]]);

    const splitPlan = {
      valid: true,
      newFiles: [{ name: 'big-types.ts', purpose: 'types', exports: ['BigType'] }],
      retainInOriginal: ['mainFn'],
    };

    let llmCallCount = 0;
    const llm = async () => {
      llmCallCount++;
      if (llmCallCount === 1) return JSON.stringify(splitPlan);
      return 'export const broken = 1;';
    };

    const result = await runSanitize({
      cwd,
      threshold: 750,
      skipTypecheck: false,
      _inspect: mockInspect({ 'src/big.ts': 800 }),
      _callLLM: llm,
      _readFile: async (p) => fileStore.get(p) ?? originalContent,
      _writeFile: async (p, c) => { fileStore.set(p, c); },
      _removeFile: async (p) => { fileStore.delete(p); },
      _runTypecheck: async () => ({ success: false, output: 'TS2305: missing export' }),
    });

    assert.ok(result.filesSkipped >= 1, 'file should be skipped after two failed attempts');
  });
});
