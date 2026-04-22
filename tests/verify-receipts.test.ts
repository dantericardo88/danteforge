import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReceiptStatus,
  buildReceiptMarkdown,
  type VerifyReceipt,
} from '../src/core/verify-receipts.js';

function makeReceipt(overrides: Partial<VerifyReceipt> = {}): VerifyReceipt {
  return {
    status: 'pass',
    timestamp: new Date().toISOString(),
    project: 'test-project',
    version: '1.0.0',
    gitSha: 'abc123',
    platform: 'linux',
    nodeVersion: 'v22.0.0',
    projectType: 'typescript',
    workflowStage: 'verify',
    passed: ['typecheck passed', 'tests passed'],
    warnings: [],
    failures: [],
    counts: { passed: 2, warnings: 0, failures: 0 },
    ...overrides,
  };
}

describe('computeReceiptStatus', () => {
  it('returns pass when no warnings or failures', () => {
    assert.equal(computeReceiptStatus(['a', 'b'], [], []), 'pass');
  });

  it('returns warn when warnings present but no failures', () => {
    assert.equal(computeReceiptStatus(['a'], ['warning 1'], []), 'warn');
  });

  it('returns fail when failures present', () => {
    assert.equal(computeReceiptStatus(['a'], ['w'], ['fail 1']), 'fail');
  });

  it('returns fail even when no warnings', () => {
    assert.equal(computeReceiptStatus([], [], ['fail 1']), 'fail');
  });

  it('returns pass for empty arrays', () => {
    assert.equal(computeReceiptStatus([], [], []), 'pass');
  });
});

describe('buildReceiptMarkdown', () => {
  it('includes status in output', () => {
    const md = buildReceiptMarkdown(makeReceipt());
    assert.ok(md.includes('PASS'));
  });

  it('includes project name', () => {
    const md = buildReceiptMarkdown(makeReceipt({ project: 'my-project' }));
    assert.ok(md.includes('my-project'));
  });

  it('includes timestamp', () => {
    const receipt = makeReceipt();
    const md = buildReceiptMarkdown(receipt);
    assert.ok(md.includes(receipt.timestamp));
  });

  it('shows fail status for failed receipt', () => {
    const receipt = makeReceipt({
      status: 'fail',
      failures: ['typecheck failed'],
      counts: { passed: 0, warnings: 0, failures: 1 },
    });
    const md = buildReceiptMarkdown(receipt);
    assert.ok(md.includes('FAIL') || md.includes('fail'));
  });

  it('shows warn status for warned receipt', () => {
    const receipt = makeReceipt({
      status: 'warn',
      warnings: ['coverage low'],
      counts: { passed: 1, warnings: 1, failures: 0 },
    });
    const md = buildReceiptMarkdown(receipt);
    assert.ok(md.includes('WARN') || md.includes('warn'));
  });

  it('lists passed checks', () => {
    const receipt = makeReceipt({ passed: ['typecheck passed', 'tests passed'] });
    const md = buildReceiptMarkdown(receipt);
    assert.ok(md.includes('typecheck passed'));
    assert.ok(md.includes('tests passed'));
  });

  it('returns non-empty string', () => {
    const md = buildReceiptMarkdown(makeReceipt());
    assert.ok(md.length > 0);
  });
});
