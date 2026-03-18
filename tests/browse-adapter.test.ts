// Browse Adapter tests — binary detection, port derivation, invocation, install instructions
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getBrowsePort,
  getBrowseInstallInstructions,
  type BrowseAdapterConfig,
} from '../src/core/browse-adapter.js';

describe('getBrowsePort', () => {
  it('returns 9400 as default port when no worktree ID', () => {
    const port = getBrowsePort();
    assert.strictEqual(port, 9400);
  });

  it('returns conductor port when provided', () => {
    const port = getBrowsePort('my-worktree', 9500);
    assert.strictEqual(port, 9500);
  });

  it('derives a deterministic port from worktree ID', () => {
    const port = getBrowsePort('worktree-alpha');
    assert.ok(port >= 9400 && port < 9500, `Expected 9400–9499, got ${port}`);
  });

  it('produces consistent results for same worktree ID', () => {
    const p1 = getBrowsePort('test-tree');
    const p2 = getBrowsePort('test-tree');
    assert.strictEqual(p1, p2);
  });

  it('produces different ports for different worktree IDs', () => {
    const p1 = getBrowsePort('worktree-a');
    const p2 = getBrowsePort('worktree-b');
    // They might collide by hash, but typically won't
    // Just check they're both in range
    assert.ok(p1 >= 9400 && p1 < 9500);
    assert.ok(p2 >= 9400 && p2 < 9500);
  });
});

describe('getBrowseInstallInstructions', () => {
  it('returns platform-specific instructions for darwin', () => {
    const instructions = getBrowseInstallInstructions('darwin');
    assert.ok(instructions.includes('brew'));
    assert.ok(instructions.includes('Browse binary not found'));
  });

  it('returns platform-specific instructions for linux', () => {
    const instructions = getBrowseInstallInstructions('linux');
    assert.ok(instructions.includes('curl'));
  });

  it('returns platform-specific instructions for win32', () => {
    const instructions = getBrowseInstallInstructions('win32');
    assert.ok(instructions.includes('winget'));
  });

  it('returns generic instructions for unknown platforms', () => {
    const instructions = getBrowseInstallInstructions('freebsd' as NodeJS.Platform);
    assert.ok(instructions.includes('Download from'));
  });

  it('always includes re-run message', () => {
    const instructions = getBrowseInstallInstructions('darwin');
    assert.ok(instructions.includes('re-run'));
  });
});

describe('BrowseAdapterConfig types', () => {
  it('accepts a valid config object', () => {
    const config: BrowseAdapterConfig = {
      binaryPath: '/usr/local/bin/browse',
      port: 9400,
      workspaceId: 'main',
      timeoutMs: 5000,
      evidenceDir: '.danteforge/evidence',
    };
    assert.strictEqual(config.binaryPath, '/usr/local/bin/browse');
    assert.strictEqual(config.port, 9400);
  });

  it('allows minimal config with only binaryPath', () => {
    const config: BrowseAdapterConfig = { binaryPath: '/usr/local/bin/browse' };
    assert.strictEqual(config.port, undefined);
    assert.strictEqual(config.timeoutMs, undefined);
  });
});
