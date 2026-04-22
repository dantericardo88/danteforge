import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getCommandCheckReceiptPath,
  writeCommandCheckReceipt,
  readCommandCheckReceipt,
} from '../src/core/command-check-receipts.js';

let tmpDir: string;
before(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccr-test-')); });
after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

describe('getCommandCheckReceiptPath', () => {
  it('includes the id in the path', () => {
    const p = getCommandCheckReceiptPath('test', '/projects/foo');
    assert.ok(p.includes('test.json'));
  });

  it('includes cwd in the path', () => {
    const p = getCommandCheckReceiptPath('build', '/my/project');
    assert.ok(p.includes('my') || p.includes('project'));
  });

  it('includes evidence directory segment', () => {
    const p = getCommandCheckReceiptPath('test', '/project');
    assert.ok(p.includes('command-checks'));
  });
});

describe('writeCommandCheckReceipt + readCommandCheckReceipt', () => {
  it('writes and reads back a receipt', async () => {
    await writeCommandCheckReceipt({
      id: 'test',
      command: 'npm test',
      status: 'pass',
      timestamp: '2026-01-01T00:00:00.000Z',
      gitSha: null,
      worktreeFingerprint: null,
      durationMs: 1234,
    }, tmpDir);

    const receipt = await readCommandCheckReceipt('test', tmpDir);
    assert.ok(receipt !== null);
    assert.equal(receipt!.id, 'test');
    assert.equal(receipt!.command, 'npm test');
    assert.equal(receipt!.status, 'pass');
    assert.equal(receipt!.durationMs, 1234);
  });

  it('readCommandCheckReceipt returns null when file missing', async () => {
    const result = await readCommandCheckReceipt('build', path.join(tmpDir, 'nonexistent-subdir'));
    assert.equal(result, null);
  });

  it('normalizes receipt with cwd field', async () => {
    const receipt = await writeCommandCheckReceipt({
      id: 'build',
      command: 'npm run build',
      status: 'fail',
      timestamp: '2026-01-01T00:00:00.000Z',
      gitSha: null,
      worktreeFingerprint: null,
      durationMs: null,
    }, tmpDir);

    assert.equal(receipt.cwd, tmpDir);
    assert.equal(receipt.id, 'build');
    assert.equal(receipt.status, 'fail');
  });

  it('stores null gitSha when provided', async () => {
    const receipt = await writeCommandCheckReceipt({
      id: 'test',
      command: 'npm test',
      status: 'pass',
      timestamp: '2026-01-01T00:00:00.000Z',
      gitSha: null,
      worktreeFingerprint: null,
      durationMs: null,
    }, tmpDir);
    assert.equal(receipt.gitSha, null);
    assert.equal(receipt.worktreeFingerprint, null);
  });
});
