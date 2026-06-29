import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { measuredReceiptGate } from '../src/core/measured-completion-gate.js';
import type { OutcomeEvidence, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';
import type { CapabilityTier } from '../src/matrix/types/capability-test.js';

// Minimal entry — the gate only reads .passed and .tier.
function entry(tier: CapabilityTier, passed: boolean): OutcomeEvidenceEntry {
  return { tier, passed } as OutcomeEvidenceEntry;
}
function evidenceLoader(entries: OutcomeEvidenceEntry[]) {
  return async (): Promise<OutcomeEvidence> => new Map(entries.map((e, i) => [String(i), e]));
}

describe('measured-completion-gate — the Depth-Doctrine firewall', () => {
  test('passes with >=1 fresh T5+ passing receipt (build proven)', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T5', true)]) });
    assert.equal(r.passed, true);
    assert.equal(r.passingHighTier, 1);
  });

  test('passes on a higher tier too (T7 passing)', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T7', true)]) });
    assert.equal(r.passed, true);
  });

  test('FAILS when the only passing receipts are below T5 (not BUILD-COMPLETE)', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T4', true), entry('T2', true)]) });
    assert.equal(r.passed, false);
    assert.match(r.reason, /unproven/);
  });

  test('FAILS when a T5 receipt exists but did NOT pass', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([entry('T5', false)]) });
    assert.equal(r.passed, false);
  });

  test('FAILS (fail-closed) when there are no receipts at all', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: evidenceLoader([]) });
    assert.equal(r.passed, false);
    assert.equal(r.passingHighTier, 0);
  });

  test('FAILS (fail-closed) when evidence cannot be loaded', async () => {
    const r = await measuredReceiptGate('/x', { _loadEvidence: async () => { throw new Error('disk error'); } });
    assert.equal(r.passed, false);
    assert.match(r.reason, /fail-closed/);
  });
});
