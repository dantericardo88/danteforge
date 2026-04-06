import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeBrowse,
  detectBrowseBinary,
  isBrowseDaemonRunning,
  getBrowsePort,
  type BrowseAdapterTestOpts,
} from '../src/core/browse-adapter.js';

// ── invokeBrowse ────────────────────────────────────────────────────────────

describe('invokeBrowse', () => {
  const baseConfig = { binaryPath: '/usr/bin/browse', port: 9400 };

  it('success path returns stdout', async () => {
    const mockExec = async () => ({ stdout: 'page loaded', stderr: '' });
    const result = await invokeBrowse('goto', ['https://example.com'], baseConfig, { _exec: mockExec });
    assert.equal(result.success, true);
    assert.equal(result.stdout, 'page loaded');
    assert.equal(result.exitCode, 0);
  });

  it('screenshot subcommand creates evidence path', async () => {
    let mkdirCalled = false;
    let mkdirPath = '';
    const mockExec = async () => ({ stdout: 'screenshot taken', stderr: '' });
    const mockMkdir = async (p: string, _opts: { recursive: boolean }) => {
      mkdirCalled = true;
      mkdirPath = p;
      return undefined;
    };
    const result = await invokeBrowse('screenshot', [], baseConfig, { _exec: mockExec, _mkdir: mockMkdir });
    assert.equal(result.success, true);
    assert.equal(mkdirCalled, true);
    assert.ok(mkdirPath.length > 0, 'mkdir should have been called with a path');
    assert.ok(result.evidencePath, 'evidencePath should be set for screenshot subcommand');
    assert.ok(result.evidencePath!.endsWith('.png'), 'evidencePath should end with .png');
  });

  it('timeout handling', async () => {
    const mockExec = async () => {
      const err: Record<string, unknown> = { killed: true, stderr: '', stdout: '' };
      throw err;
    };
    const result = await invokeBrowse('goto', ['https://slow.com'], baseConfig, { _exec: mockExec });
    assert.equal(result.success, false);
    assert.ok(result.errorMessage, 'errorMessage should be set');
    assert.ok(result.errorMessage!.includes('timed out'), `Expected "timed out" in: ${result.errorMessage}`);
  });

  it('non-zero exit code', async () => {
    const mockExec = async () => {
      const err: Record<string, unknown> = { status: 2, stderr: 'error', stdout: '' };
      throw err;
    };
    const result = await invokeBrowse('goto', ['https://bad.com'], baseConfig, { _exec: mockExec });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 2);
  });

  it('empty opts object uses defaults', async () => {
    // Passing {} should use real defaults — since no _exec is provided,
    // invokeBrowse will use the real execFileAsync. We can't call the real binary,
    // so we verify the function accepts {} without throwing a type error by
    // catching the expected runtime error (binary not found).
    const result = await invokeBrowse('goto', ['https://example.com'], { binaryPath: '/nonexistent/browse', port: 9400 }, {});
    // Real exec will fail because the binary doesn't exist — that's expected
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1, 'Should have non-zero exit code when binary is missing');
  });
});

// ── detectBrowseBinary ──────────────────────────────────────────────────────

describe('detectBrowseBinary', () => {
  it('finds binary at common location', async () => {
    const mockAccess = async (p: string) => {
      if (p === './node_modules/.bin/browse') return;
      throw new Error('ENOENT');
    };
    const result = await detectBrowseBinary({ _fsAccess: mockAccess });
    assert.equal(result, './node_modules/.bin/browse');
  });

  it('returns null when no binary found', async () => {
    const mockAccess = async () => {
      throw new Error('ENOENT');
    };
    const result = await detectBrowseBinary({ _fsAccess: mockAccess });
    assert.equal(result, null);
  });

  it('checks multiple paths in order', async () => {
    const checkedPaths: string[] = [];
    const mockAccess = async (p: string) => {
      checkedPaths.push(p);
      throw new Error('ENOENT');
    };
    await detectBrowseBinary({ _fsAccess: mockAccess });
    // Should check both COMMON_LOCATIONS first
    assert.ok(checkedPaths.includes('./bin/browse'), 'Should check ./bin/browse');
    assert.ok(checkedPaths.includes('./node_modules/.bin/browse'), 'Should check ./node_modules/.bin/browse');
    // Should also check PATH entries
    assert.ok(checkedPaths.length > 2, 'Should check PATH entries beyond COMMON_LOCATIONS');
  });

  it('undefined opts uses real fs.access defaults', async () => {
    // Passing undefined should use the real fs.access — binary won't exist on CI
    // but the function should not throw, it should return null or a path
    const result = await detectBrowseBinary(undefined);
    // Result is either a string (binary found) or null (not found) — both are valid
    assert.ok(result === null || typeof result === 'string', 'Should return null or string');
  });
});

// ── isBrowseDaemonRunning ───────────────────────────────────────────────────

describe('isBrowseDaemonRunning', () => {
  it('returns true on healthy daemon', async () => {
    const mockHealth = async () => true;
    const result = await isBrowseDaemonRunning(9400, { _checkHealth: mockHealth });
    assert.equal(result, true);
  });

  it('returns false when daemon is down', async () => {
    const mockHealth = async () => false;
    const result = await isBrowseDaemonRunning(9400, { _checkHealth: mockHealth });
    assert.equal(result, false);
  });

  it('uses default port when none specified', async () => {
    let receivedPort = 0;
    const mockHealth = async (port: number) => {
      receivedPort = port;
      return true;
    };
    await isBrowseDaemonRunning(undefined, { _checkHealth: mockHealth });
    assert.equal(receivedPort, 9400, 'Should use DEFAULT_PORT 9400 when port is undefined');
  });
});

// ── getBrowsePort ───────────────────────────────────────────────────────────

describe('getBrowsePort', () => {
  it('returns conductor port when provided', () => {
    const port = getBrowsePort('abc', 9500);
    assert.equal(port, 9500);
  });

  it('derives deterministic port from worktree ID', () => {
    const port1 = getBrowsePort('agent-1');
    const port2 = getBrowsePort('agent-1');
    assert.equal(port1, port2, 'Same worktree ID should produce the same port');
    assert.ok(port1 >= 9400, `Port ${port1} should be >= 9400`);
    assert.ok(port1 <= 9499, `Port ${port1} should be <= 9499`);
  });
});
