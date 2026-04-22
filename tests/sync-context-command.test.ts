import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncContext } from '../src/cli/commands/sync-context.js';
import type { ContextSyncResult } from '../src/core/context-syncer.js';

function makeResult(overrides: Partial<ContextSyncResult> = {}): ContextSyncResult {
  return {
    synced: [],
    skipped: [],
    totalTokens: 0,
    ...overrides,
  };
}

describe('syncContext', () => {
  it('reports synced files', async () => {
    const lines: string[] = [];
    await syncContext({
      _syncContext: async () => makeResult({
        synced: [{ path: '.cursor/rules', tokens: 100 }, { path: '.github/copilot-instructions.md', tokens: 50 }],
        totalTokens: 150,
      }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('2')));
    assert.ok(lines.some(l => l.includes('.cursor/rules') || l.includes('cursor')));
  });

  it('reports zero synced files', async () => {
    const lines: string[] = [];
    await syncContext({
      _syncContext: async () => makeResult(),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('0')));
  });

  it('reports skipped files when present', async () => {
    const lines: string[] = [];
    await syncContext({
      _syncContext: async () => makeResult({ skipped: ['vscode', 'jetbrains'] }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('Skipped') || l.includes('vscode')));
  });

  it('shows total tokens', async () => {
    const lines: string[] = [];
    await syncContext({
      _syncContext: async () => makeResult({ totalTokens: 2500 }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('2500') || l.includes('tokens')));
  });

  it('calls _syncContext with target option', async () => {
    let capturedOpts: any = null;
    await syncContext({
      target: 'cursor',
      cwd: '/tmp/project',
      _syncContext: async (opts) => { capturedOpts = opts; return makeResult(); },
      _stdout: () => {},
    });
    assert.equal(capturedOpts?.target, 'cursor');
    assert.equal(capturedOpts?.cwd, '/tmp/project');
  });

  it('includes reminder to sync after milestones', async () => {
    const lines: string[] = [];
    await syncContext({
      _syncContext: async () => makeResult(),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('sync-context') || l.includes('milestone')));
  });
});
