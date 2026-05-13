// Tests for wave-time auto-sanitize hook (Sprint 10)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { postWaveSanitize } from '../src/core/auto-sanitize.js';

const tmpDirs: string[] = [];
async function makeTmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-sanitize-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

describe('postWaveSanitize', () => {
  it('returns ran:false when disabled', async () => {
    const r = await postWaveSanitize({
      cwd: '/tmp',
      disabled: true,
      _gitChangedFiles: async () => ['src/big.ts'],
    });
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'disabled');
  });

  it('returns ran:false when no files changed', async () => {
    const r = await postWaveSanitize({
      cwd: '/tmp',
      _gitChangedFiles: async () => [],
    });
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'no-changed-files');
  });

  it('returns ran:false when changed files are all under threshold', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src/small.ts'), 'export const x = 1;\n'.repeat(50));

    const r = await postWaveSanitize({
      cwd,
      threshold: 750,
      _gitChangedFiles: async () => ['src/small.ts'],
    });
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'no-violations');
  });

  it('skips test files and .d.ts files', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    const bigContent = 'export const x = 1;\n'.repeat(900);
    await fs.writeFile(path.join(cwd, 'tests/big.test.ts'), bigContent);
    await fs.writeFile(path.join(cwd, 'src/types.d.ts'), bigContent);

    const r = await postWaveSanitize({
      cwd,
      threshold: 750,
      _gitChangedFiles: async () => ['tests/big.test.ts', 'src/types.d.ts'],
    });
    assert.equal(r.ran, false, 'should skip test and .d.ts files');
  });

  it('runs sanitize on owned (non-frozen) violators only', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    const big = 'export const x = 1;\n'.repeat(900);
    await fs.writeFile(path.join(cwd, 'src/owned.ts'), big);
    await fs.writeFile(path.join(cwd, 'src/frozen.ts'), big);
    await fs.writeFile(path.join(cwd, '.danteforge/agent-guard.json'),
      JSON.stringify({ frozenFiles: ['src/frozen.ts'] }));

    const sanitizeCalls: string[] = [];
    const r = await postWaveSanitize({
      cwd,
      threshold: 750,
      _gitChangedFiles: async () => ['src/owned.ts', 'src/frozen.ts'],
      _runSanitize: async (opts) => {
        sanitizeCalls.push(opts.pattern);
        return {
          cyclesRun: 1, filesProcessed: 1, filesSplit: 1, filesSkipped: 0,
          remainingViolations: 0, success: true, sessionPath: '',
        };
      },
    });

    assert.equal(r.ran, true);
    assert.deepEqual(r.ownedViolators, ['src/owned.ts']);
    assert.deepEqual(r.frozenViolators, ['src/frozen.ts']);
    assert.equal(sanitizeCalls.length, 1);
    assert.ok(sanitizeCalls[0]!.includes('owned.ts'));
    assert.ok(!sanitizeCalls[0]!.includes('frozen.ts'));
  });

  it('caps the number of files processed per wave', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    const big = 'export const x = 1;\n'.repeat(900);
    for (const name of ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']) {
      await fs.writeFile(path.join(cwd, 'src', name), big);
    }

    let pattern = '';
    const r = await postWaveSanitize({
      cwd,
      threshold: 750,
      maxFilesPerWave: 2,
      _gitChangedFiles: async () => ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'],
      _runSanitize: async (opts) => {
        pattern = opts.pattern;
        return {
          cyclesRun: 0, filesProcessed: 0, filesSplit: 0, filesSkipped: 0,
          remainingViolations: 0, success: true, sessionPath: '',
        };
      },
    });

    assert.equal(r.ran, true);
    assert.equal(r.ownedViolators.length, 2, 'should cap at maxFilesPerWave');
    const patternParts = pattern.split('|');
    assert.equal(patternParts.length, 2);
  });

  it('writes platform-kernel-needed when all violators are frozen', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    const big = 'export const x = 1;\n'.repeat(900);
    await fs.writeFile(path.join(cwd, 'src/frozen.ts'), big);
    await fs.writeFile(path.join(cwd, '.danteforge/agent-guard.json'),
      JSON.stringify({ frozenFiles: ['src/frozen.ts'] }));

    const r = await postWaveSanitize({
      cwd,
      threshold: 750,
      _gitChangedFiles: async () => ['src/frozen.ts'],
      _runSanitize: async () => ({
        cyclesRun: 0, filesProcessed: 0, filesSplit: 0, filesSkipped: 0,
        remainingViolations: 0, success: true, sessionPath: '',
      }),
    });

    assert.equal(r.ran, false);
    assert.equal(r.reason, 'all-frozen');
    assert.deepEqual(r.frozenViolators, ['src/frozen.ts']);

    const kernelFile = path.join(cwd, '.danteforge/sanitize/platform-kernel-needed.json');
    const content = await fs.readFile(kernelFile, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0].path, 'src/frozen.ts');
  });
});
