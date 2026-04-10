// executor-integration.test.ts — real filesystem tests for applyAllOperations (v0.18.0)
// No mock fs — exercises the actual node:fs/promises path end-to-end.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyAllOperations } from '../src/core/code-writer.js';

describe('applyAllOperations — real filesystem', () => {
  it('writes a new file and reads it back', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-integration-'));
    try {
      const ops = [{ type: 'create' as const, filePath: 'out.ts', replaceBlock: 'export const x = 1;' }];
      const result = await applyAllOperations(ops, { cwd: dir });
      assert.ok(result.success, 'applyAllOperations should succeed');
      assert.ok(result.filesWritten.includes('out.ts'), 'should report out.ts as written');
      const content = await fs.readFile(path.join(dir, 'out.ts'), 'utf8');
      assert.equal(content, 'export const x = 1;');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('applies a replace operation to an existing file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-integration-'));
    try {
      await fs.writeFile(path.join(dir, 'src.ts'), 'const x = 1;\nconst y = 2;\n');
      const ops = [{ type: 'replace' as const, filePath: 'src.ts', searchBlock: 'const x = 1;', replaceBlock: 'const x = 99;' }];
      const result = await applyAllOperations(ops, { cwd: dir });
      assert.ok(result.success, 'replace operation should succeed');
      const content = await fs.readFile(path.join(dir, 'src.ts'), 'utf8');
      assert.ok(content.includes('const x = 99;'), 'replacement should be applied');
      assert.ok(!content.includes('const x = 1;'), 'original should be gone');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('creates nested directories automatically', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-integration-'));
    try {
      const ops = [{ type: 'create' as const, filePath: 'src/nested/deep/file.ts', replaceBlock: 'export {}' }];
      const result = await applyAllOperations(ops, { cwd: dir });
      assert.ok(result.success, 'should create nested dirs and file');
      const content = await fs.readFile(path.join(dir, 'src/nested/deep/file.ts'), 'utf8');
      assert.equal(content, 'export {}');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns success=false when replace target file does not exist', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-integration-'));
    try {
      const ops = [{ type: 'replace' as const, filePath: 'missing.ts', searchBlock: 'const x = 1;', replaceBlock: 'const x = 2;' }];
      const result = await applyAllOperations(ops, { cwd: dir });
      assert.ok(!result.success, 'should fail when file does not exist');
      assert.ok(result.filesFailedToApply.includes('missing.ts'), 'should report failed file');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
