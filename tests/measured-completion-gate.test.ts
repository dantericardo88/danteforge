import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { measuredReceiptGate } from '../src/core/measured-completion-gate.js';
import type { OutcomeEvidence, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';
import type { CapabilityTier } from '../src/matrix/types/capability-test.js';

const HEAD = 'a'.repeat(40);
// Minimal entry — the gate reads .passed, .tier, and .gitSha.
function entry(tier: CapabilityTier, passed: boolean, gitSha: string = HEAD): OutcomeEvidenceEntry {
  return { tier, passed, gitSha } as OutcomeEvidenceEntry;
}
function evidenceLoader(entries: OutcomeEvidenceEntry[]) {
  return async (): Promise<OutcomeEvidence> => new Map(entries.map((e, i) => [String(i), e]));
}
const atHead = { _readGitSha: async () => HEAD };

describe('measured-completion-gate — the Depth-Doctrine firewall', () => {
  test('passes with >=1 fresh T5+ passing receipt (build proven)', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T5', true)]), ...atHead });
    assert.equal(r.passed, true);
    assert.equal(r.passingHighTier, 1);
  });

  test('passes on a higher tier too (T7 passing)', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T7', true)]), ...atHead });
    assert.equal(r.passed, true);
  });

  test('FAILS when the only passing receipts are below T5 (not BUILD-COMPLETE)', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T4', true), entry('T2', true)]), ...atHead });
    assert.equal(r.passed, false);
    assert.match(r.reason, /unproven/);
  });

  test('FAILS when a T5 receipt exists but did NOT pass', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T5', false)]), ...atHead });
    assert.equal(r.passed, false);
  });

  test('FAILS (fail-closed) when there are no receipts at all', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([]), ...atHead });
    assert.equal(r.passed, false);
    assert.equal(r.passingHighTier, 0);
  });

  test('FAILS (fail-closed) when evidence cannot be loaded', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: async () => { throw new Error('disk error'); }, ...atHead });
    assert.equal(r.passed, false);
    assert.match(r.reason, /fail-closed/);
  });

  test('REJECTS a passing T5 receipt minted on an OLD sha (council hole: stale-SHA fallback)', async () => {
    const old = 'b'.repeat(40);
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T5', true, old)]), ...atHead });
    assert.equal(r.passed, false, 'an old-commit receipt must NOT certify new code');
  });

  test('FAILS (fail-closed) when HEAD sha is unavailable', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T5', true)]), _readGitSha: async () => null });
    assert.equal(r.passed, false);
  });
});
