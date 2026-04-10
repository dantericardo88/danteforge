// code-writer-path-traversal.test.ts — path traversal protection in applyOperation (v0.20.0)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyOperation } from '../src/core/code-writer.js';

describe('applyOperation — path traversal protection', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-traversal-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects Unix-style traversal ../../.env — returns success=false, no file written', async () => {
    const sensitiveTarget = path.join(tmpDir, '..', '.env-leaked');
    const result = await applyOperation(
      { type: 'create', filePath: '../../.env-leaked', replaceBlock: 'SECRET=leaked' },
      { cwd: tmpDir },
    );
    assert.ok(!result.success, 'should return success=false for traversal');
    // Verify the file was NOT written outside cwd
    let exists = false;
    try { await fs.access(sensitiveTarget); exists = true; } catch { /* expected */ }
    assert.ok(!exists, 'file must not be written outside project root');
  });

  it('rejects deep traversal path — ../../../../../../../etc/passwd', async () => {
    const result = await applyOperation(
      { type: 'create', filePath: '../../../../../../../etc/passwd-test', replaceBlock: 'x' },
      { cwd: tmpDir },
    );
    assert.ok(!result.success, 'deep traversal should be rejected');
    assert.ok(typeof result.error === 'string', 'error message should be present');
  });

  it('rejects Windows-style traversal ..\\..\\sensitive', async () => {
    const result = await applyOperation(
      { type: 'create', filePath: '..\\..\\sensitive-file', replaceBlock: 'data' },
      { cwd: tmpDir },
    );
    assert.ok(!result.success, 'Windows-style traversal should be rejected');
  });

  it('rejects absolute path outside cwd', async () => {
    const absoluteTarget = process.platform === 'win32' ? 'C:\\Windows\\Temp\\df-test-abs' : '/tmp/df-abs-test';
    const result = await applyOperation(
      { type: 'create', filePath: absoluteTarget, replaceBlock: 'x' },
      { cwd: tmpDir },
    );
    assert.ok(!result.success, 'absolute path outside cwd should be rejected');
  });

  it('error message on traversal contains the attempted path', async () => {
    const result = await applyOperation(
      { type: 'create', filePath: '../../attempted-path', replaceBlock: 'x' },
      { cwd: tmpDir },
    );
    assert.ok(!result.success);
    assert.ok(
      result.error?.includes('../../attempted-path') || result.error?.includes('traversal'),
      `error message should reference the path or mention traversal, got: ${result.error}`,
    );
  });

  it('allows valid create of src/feature.ts within cwd', async () => {
    const result = await applyOperation(
      { type: 'create', filePath: 'src/feature.ts', replaceBlock: 'export const x = 1;' },
      { cwd: tmpDir },
    );
    assert.ok(result.success, `should succeed for valid path, got error: ${result.error}`);
    const written = await fs.readFile(path.join(tmpDir, 'src', 'feature.ts'), 'utf8');
    assert.equal(written, 'export const x = 1;');
  });

  it('allows valid nested create src/components/Button.tsx and creates directories', async () => {
    const result = await applyOperation(
      { type: 'create', filePath: 'src/components/Button.tsx', replaceBlock: 'export default function Button() {}' },
      { cwd: tmpDir },
    );
    assert.ok(result.success, `should succeed, got error: ${result.error}`);
    const stat = await fs.stat(path.join(tmpDir, 'src', 'components', 'Button.tsx'));
    assert.ok(stat.isFile(), 'nested file should exist');
  });

  it('rejects replace type with traversal path — returns success=false, not thrown', async () => {
    // Create a file first inside cwd
    await fs.writeFile(path.join(tmpDir, 'legit.ts'), 'original content');
    const result = await applyOperation(
      {
        type: 'replace',
        filePath: '../../outside.ts',
        searchBlock: 'original',
        replaceBlock: 'replaced',
      },
      { cwd: tmpDir },
    );
    assert.ok(!result.success, 'replace with traversal path should return success=false');
  });
});
