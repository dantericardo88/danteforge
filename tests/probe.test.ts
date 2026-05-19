import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  runProbe,
  runQuickImportCheck,
  detectMonorepoRunner,
  parseFailedPackages,
  type ProbeResult,
} from '../src/cli/commands/probe.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStore() {
  const store = new Map<string, string>();
  return {
    store,
    _readFile: async (p: string) => {
      const v = store.get(p);
      if (!v) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    _writeFile: async (p: string, d: string) => { store.set(p, d); },
    _exists: async (p: string) => store.has(p),
    _mkdir: async (_p: string) => {},
  };
}

function fakeGit(sha: string | null, dirty = false) {
  return async (_cwd: string) => ({
    gitSha: sha,
    worktreeFingerprint: sha === null ? null : dirty ? `${sha}-dirty-3` : sha,
  });
}

// ── detectMonorepoRunner ──────────────────────────────────────────────────────

describe('detectMonorepoRunner', () => {
  it('returns "none" when cwd has no project files', async () => {
    // Pointing at a path we know doesn't exist on disk → all exist checks fail
    const runner = await detectMonorepoRunner('/totally-fake-path-that-does-not-exist-xyz');
    assert.equal(runner, 'none');
  });
});

// ── parseFailedPackages ───────────────────────────────────────────────────────

describe('parseFailedPackages', () => {
  it('extracts turbo per-package errors from stdout (legacy ERROR format)', () => {
    const stdout = `
@dirtydlite/cli:build: ERROR: command failed
@dirtydlite/platform-compat:build: ERROR: tsc failed
@danteagents/integrations:build: completed
`;
    const failed = parseFailedPackages('turbo', stdout, '');
    assert.deepEqual(failed.sort(), ['@dirtydlite/cli', '@dirtydlite/platform-compat']);
  });

  it('extracts turbo "Failed:" summary line', () => {
    const stdout = `
 Tasks:    85 successful, 86 total
Cached:    0 cached, 86 total
  Time:    3m32.437s
Failed:    @dirtydlite/chat-cockpit#build
`;
    const failed = parseFailedPackages('turbo', stdout, '');
    assert.deepEqual(failed, ['@dirtydlite/chat-cockpit']);
  });

  it('extracts turbo summary line with multiple comma-separated failures', () => {
    const stdout = `Failed:    @org/foo#build, @org/bar#test, @org/baz#build`;
    const failed = parseFailedPackages('turbo', stdout, '');
    assert.deepEqual(failed.sort(), ['@org/bar', '@org/baz', '@org/foo']);
  });

  it('extracts turbo stderr ERROR pattern', () => {
    const stderr = ` ERROR  @dirtydlite/chat-cockpit#build: command (...) exited (1)
 ERROR  run failed: command  exited (1)`;
    const failed = parseFailedPackages('turbo', '', stderr);
    assert.deepEqual(failed, ['@dirtydlite/chat-cockpit']);
  });

  it('returns empty array on a clean build', () => {
    const failed = parseFailedPackages('turbo', 'all packages built\n', '');
    assert.deepEqual(failed, []);
  });

  it('extracts pnpm -r failures', () => {
    const stdout = `
@org/foo dev ERR_pnpm_recursive_run_first_fail typescript build failed
@org/bar dev ERR_pnpm_recursive_run_first_fail vitest failed
`;
    const failed = parseFailedPackages('pnpm-r', stdout, '');
    assert.ok(failed.includes('@org/foo'));
    assert.ok(failed.includes('@org/bar'));
  });

  it('extracts lerna errors', () => {
    const stderr = `lerna ERR! npm: @org/app: exit code 1\nlerna ERR! lifecycle: @org/lib: build script failed`;
    const failed = parseFailedPackages('lerna', '', stderr);
    assert.ok(failed.includes('@org/app'));
    assert.ok(failed.includes('@org/lib'));
  });
});

// ── runProbe ──────────────────────────────────────────────────────────────────

describe('runProbe', () => {
  it('records a passed probe to evidence when exit 0', async () => {
    const fs = makeStore();
    const result = await runProbe({
      cwd: '/p',
      tier: 'T1',
      forceCold: true,
      _detectRunner: async () => 'turbo',
      _spawn: () => ({ status: 0, stdout: 'all built', stderr: '' }),
      _readGitSha: fakeGit('abc123'),
      ...fs,
    });
    assert.equal(result.passed, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.runner, 'turbo');
    assert.equal(result.failedPackages.length, 0);
    assert.ok(result.evidencePath.includes('abc123'));
    assert.ok(result.evidencePath.includes('T1'));
    const evidenceJson = fs.store.get(result.evidencePath);
    assert.ok(evidenceJson, 'evidence file should be written');
  });

  it('records a failed probe and parses failed packages', async () => {
    const fs = makeStore();
    const turboStdout = `
@dirtydlite/cli:build: ERROR: typescript errors
@dirtydlite/platform-compat:build: ERROR: tsc exit 1
`;
    const result = await runProbe({
      cwd: '/p',
      tier: 'T1',
      forceCold: true,
      _detectRunner: async () => 'turbo',
      _spawn: () => ({ status: 1, stdout: turboStdout, stderr: '' }),
      _readGitSha: fakeGit('def456'),
      ...fs,
    });
    assert.equal(result.passed, false);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.failedPackages.sort(), ['@dirtydlite/cli', '@dirtydlite/platform-compat']);
  });

  it('returns a passed probe even on clean exit when failedPackages is non-empty (parser caught compile errors)', async () => {
    // Defensive: exit 0 but parser found failures (e.g., turbo --continue swallows non-zero)
    const fs = makeStore();
    const result = await runProbe({
      cwd: '/p',
      tier: 'T1',
      forceCold: true,
      _detectRunner: async () => 'turbo',
      _spawn: () => ({ status: 0, stdout: '@org/broken:build: ERROR: tsc failed', stderr: '' }),
      _readGitSha: fakeGit('ghi789'),
      ...fs,
    });
    assert.equal(result.passed, false, 'parser finding ERRORs must override exit code 0');
    assert.deepEqual(result.failedPackages, ['@org/broken']);
  });

  it('writes evidence keyed by gitSha and tier', async () => {
    const fs = makeStore();
    await runProbe({
      cwd: '/p', tier: 'T1', forceCold: true,
      _detectRunner: async () => 'npm',
      _spawn: () => ({ status: 0, stdout: '', stderr: '' }),
      _readGitSha: fakeGit('aaa111'),
      ...fs,
    });
    await runProbe({
      cwd: '/p', tier: 'T2', forceCold: true,
      _detectRunner: async () => 'npm',
      _spawn: () => ({ status: 0, stdout: '', stderr: '' }),
      _readGitSha: fakeGit('aaa111'),
      ...fs,
    });
    const keys = Array.from(fs.store.keys());
    assert.ok(keys.some(k => k.includes('aaa111-T1.json')));
    assert.ok(keys.some(k => k.includes('aaa111-T2.json')));
  });

  it('handles missing git gracefully (nogit fallback)', async () => {
    const fs = makeStore();
    const result = await runProbe({
      cwd: '/p', tier: 'T1', forceCold: true,
      _detectRunner: async () => 'none',
      _spawn: () => ({ status: 0, stdout: '', stderr: '' }),
      _readGitSha: async () => ({ gitSha: null, worktreeFingerprint: null }),
      ...fs,
    });
    assert.equal(result.gitSha, null);
    assert.ok(result.evidencePath.includes('nogit'));
  });

  it('truncates large stdout/stderr to the tail', async () => {
    const fs = makeStore();
    const bigOutput = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const result = await runProbe({
      cwd: '/p', tier: 'T1', forceCold: true,
      _detectRunner: async () => 'npm',
      _spawn: () => ({ status: 0, stdout: bigOutput, stderr: bigOutput }),
      _readGitSha: fakeGit('big001'),
      ...fs,
    });
    const stdoutLines = result.stdoutTail.split('\n').length;
    assert.ok(stdoutLines <= 100, `stdout tail should be <=100 lines, got ${stdoutLines}`);
  });
});

// ── runQuickImportCheck (M.7) ────────────────────────────────────────────────

describe('runQuickImportCheck', () => {
  it('returns empty brokenImports when all relative imports resolve', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'df-qc-'));
    const srcDir = path.join(tmp, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'a.ts'), `import { x } from './b.js';\nexport const a = 1;\n`);
    await fs.writeFile(path.join(srcDir, 'b.ts'), `export const x = 2;\n`);
    const result = await runQuickImportCheck(tmp);
    assert.equal(result.brokenImports.length, 0);
    assert.equal(result.scannedFiles, 2);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('catches a relative import pointing at a missing file', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'df-qc-'));
    const srcDir = path.join(tmp, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'broken.ts'), `import { gone } from './missing.js';\nexport const v = gone;\n`);
    const result = await runQuickImportCheck(tmp);
    assert.equal(result.brokenImports.length, 1);
    assert.equal(result.brokenImports[0]!.specifier, './missing.js');
    assert.ok(result.brokenImports[0]!.file.endsWith('broken.ts'));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('skips bare-module specifiers (node_modules) entirely', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'df-qc-'));
    const srcDir = path.join(tmp, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'a.ts'), `import path from 'node:path';\nimport chalk from 'chalk';\nexport const z = 1;\n`);
    const result = await runQuickImportCheck(tmp);
    assert.equal(result.brokenImports.length, 0);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
