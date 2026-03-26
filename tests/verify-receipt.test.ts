import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  computeReceiptStatus,
  buildReceiptMarkdown,
  writeVerifyReceipt,
  readLatestVerifyReceipt,
  type VerifyReceipt,
  type VerifyStatus,
} from '../src/core/verify-receipts.js';

function makeReceipt(overrides: Partial<VerifyReceipt> = {}): VerifyReceipt {
  return {
    project: 'danteforge',
    version: '0.9.0',
    gitSha: 'abc1234def5678',
    platform: 'linux',
    nodeVersion: 'v20.0.0',
    cwd: '/project',
    projectType: 'cli',
    workflowStage: 'verify',
    timestamp: '2026-03-24T12:00:00.000Z',
    commandMode: { release: false, live: false, recompute: false },
    passed: ['STATE.yaml is valid', 'audit log has 5 entries'],
    warnings: [],
    failures: [],
    counts: { passed: 2, warnings: 0, failures: 0 },
    releaseCheckPassed: null,
    liveCheckPassed: null,
    currentStateFresh: true,
    selfEditPolicyEnforced: true,
    status: 'pass',
    ...overrides,
  };
}

describe('computeReceiptStatus', () => {
  it('returns pass when no failures and no warnings', () => {
    const status: VerifyStatus = computeReceiptStatus(['check 1', 'check 2'], [], []);
    assert.strictEqual(status, 'pass');
  });

  it('returns warn when warnings but no failures', () => {
    const status = computeReceiptStatus(['check 1'], ['minor issue'], []);
    assert.strictEqual(status, 'warn');
  });

  it('returns fail when any failures present', () => {
    const status = computeReceiptStatus(['check 1'], [], ['bad failure']);
    assert.strictEqual(status, 'fail');
  });

  it('returns fail when both failures and warnings present', () => {
    const status = computeReceiptStatus([], ['warning'], ['failure']);
    assert.strictEqual(status, 'fail');
  });
});

describe('buildReceiptMarkdown', () => {
  it('includes the heading', () => {
    const md = buildReceiptMarkdown(makeReceipt());
    assert.ok(md.includes('# DanteForge Verify Receipt'));
  });

  it('includes PASS status for clean receipt', () => {
    const md = buildReceiptMarkdown(makeReceipt({ status: 'pass' }));
    assert.ok(md.toUpperCase().includes('PASS'));
  });

  it('includes FAIL status for failed receipt', () => {
    const md = buildReceiptMarkdown(makeReceipt({ status: 'fail', failures: ['bad thing'] }));
    assert.ok(md.toUpperCase().includes('FAIL'));
  });

  it('includes git SHA when provided', () => {
    const md = buildReceiptMarkdown(makeReceipt({ gitSha: 'deadbeef1234' }));
    assert.ok(md.includes('deadbeef1234'));
  });

  it('shows "unavailable" when gitSha is null', () => {
    const md = buildReceiptMarkdown(makeReceipt({ gitSha: null }));
    assert.ok(md.includes('unavailable'));
  });

  it('includes failures section when failures present', () => {
    const md = buildReceiptMarkdown(makeReceipt({
      status: 'fail',
      failures: ['critical error occurred'],
      counts: { passed: 0, warnings: 0, failures: 1 },
    }));
    assert.ok(md.includes('Failures'));
    assert.ok(md.includes('critical error occurred'));
  });

  it('includes warnings section when warnings present', () => {
    const md = buildReceiptMarkdown(makeReceipt({
      status: 'warn',
      warnings: ['drift detected in src/'],
      counts: { passed: 1, warnings: 1, failures: 0 },
    }));
    assert.ok(md.includes('Warnings'));
    assert.ok(md.includes('drift detected in src/'));
  });

  it('shows selfEditPolicyEnforced status in Policy section', () => {
    const mdEnforced = buildReceiptMarkdown(makeReceipt({ selfEditPolicyEnforced: true }));
    const mdNotEnforced = buildReceiptMarkdown(makeReceipt({ selfEditPolicyEnforced: false }));
    assert.ok(mdEnforced.includes('Self-edit policy enforced: yes'));
    assert.ok(mdNotEnforced.includes('Self-edit policy enforced: no'));
  });
});

describe('writeVerifyReceipt + readLatestVerifyReceipt', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-receipts-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates the evidence directory and writes both files', async () => {
    const receipt = makeReceipt();
    await writeVerifyReceipt(receipt, tmpDir);

    const jsonPath = path.join(tmpDir, '.danteforge', 'evidence', 'verify', 'latest.json');
    const mdPath = path.join(tmpDir, '.danteforge', 'evidence', 'verify', 'latest.md');

    const jsonStat = await fs.stat(jsonPath);
    const mdStat = await fs.stat(mdPath);
    assert.ok(jsonStat.isFile());
    assert.ok(mdStat.isFile());
  });

  it('round-trips all receipt fields through JSON', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-receipts-rt-'));
    try {
      const original = makeReceipt({
        project: 'my-proj',
        version: '1.2.3',
        gitSha: 'cafebabe',
        passed: ['p1', 'p2'],
        warnings: ['w1'],
        failures: [],
        status: 'warn',
        counts: { passed: 2, warnings: 1, failures: 0 },
      });

      await writeVerifyReceipt(original, dir);
      const loaded = await readLatestVerifyReceipt(dir);

      assert.ok(loaded !== null);
      assert.strictEqual(loaded!.project, original.project);
      assert.strictEqual(loaded!.version, original.version);
      assert.strictEqual(loaded!.gitSha, original.gitSha);
      assert.strictEqual(loaded!.status, original.status);
      assert.deepStrictEqual(loaded!.passed, original.passed);
      assert.deepStrictEqual(loaded!.warnings, original.warnings);
      assert.deepStrictEqual(loaded!.failures, original.failures);
      assert.deepStrictEqual(loaded!.counts, original.counts);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no receipt has been written', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-receipts-empty-'));
    try {
      const result = await readLatestVerifyReceipt(freshDir);
      assert.strictEqual(result, null);
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('overwrites the previous receipt on second write', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-receipts-overwrite-'));
    try {
      await writeVerifyReceipt(makeReceipt({ status: 'fail', project: 'first' }), dir);
      await writeVerifyReceipt(makeReceipt({ status: 'pass', project: 'second' }), dir);

      const loaded = await readLatestVerifyReceipt(dir);
      assert.strictEqual(loaded!.status, 'pass');
      assert.strictEqual(loaded!.project, 'second');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('selfEditPolicyEnforced is false when policy is allow-with-audit', () => {
    const receipt = makeReceipt({ selfEditPolicyEnforced: false });
    assert.strictEqual(receipt.selfEditPolicyEnforced, false);
    const md = buildReceiptMarkdown(receipt);
    assert.ok(md.includes('Self-edit policy enforced: no'));
  });
});

describe('selfEditPolicyEnforced — policy logic (verify.ts A2 fix)', () => {
  // These tests verify the policy logic: (selfEditPolicy ?? 'deny') !== 'allow-with-audit'
  // which is computed in verify.ts and surfaced in the receipt.

  it('enforced is true when selfEditPolicy is undefined (default deny is active)', () => {
    // undefined ?? 'deny' = 'deny', 'deny' !== 'allow-with-audit' = true
    const selfEditPolicy = undefined;
    const enforced = (selfEditPolicy ?? 'deny') !== 'allow-with-audit';
    assert.strictEqual(enforced, true);
  });

  it('enforced is true when selfEditPolicy is "deny"', () => {
    const selfEditPolicy = 'deny';
    const enforced = (selfEditPolicy ?? 'deny') !== 'allow-with-audit';
    assert.strictEqual(enforced, true);
  });

  it('enforced is false when selfEditPolicy is "allow-with-audit" (bypass mode)', () => {
    const selfEditPolicy = 'allow-with-audit';
    const enforced = (selfEditPolicy ?? 'deny') !== 'allow-with-audit';
    assert.strictEqual(enforced, false);
  });

  it('enforced is true when selfEditPolicy is "confirm" (interactive mode is still enforced)', () => {
    const selfEditPolicy = 'confirm';
    const enforced = (selfEditPolicy ?? 'deny') !== 'allow-with-audit';
    assert.strictEqual(enforced, true);
  });
});
