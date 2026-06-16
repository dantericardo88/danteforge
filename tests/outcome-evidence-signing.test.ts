// CH-025 regression: a derived score is a read-only projection of SIGNED receipts.
// Unit: sign/verify/tamper. Integration: loadOutcomeEvidence rejects tampered receipts always,
// and rejects unsigned receipts under strict enforcement (but honors them by default pre-migration).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signOutcomeEvidence, verifyOutcomeEvidenceSignature } from '../src/core/outcome-evidence-signer.js';
import { loadOutcomeEvidence } from '../src/matrix/engines/outcome-runner.js';
import type { OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';

function entry(over: Partial<OutcomeEvidenceEntry> = {}): OutcomeEvidenceEntry {
  return {
    dimensionId: 'testing', outcomeId: 'o1', tier: 'T5', gitSha: 'abc', passed: true,
    exitCode: 0, durationMs: 5000, stdoutTail: 'ok', stderrTail: '',
    ranAt: new Date().toISOString(), evidencePath: '/tmp/x.json', ...over,
  };
}

describe('outcome-evidence signer — CH-025 unit', () => {
  test('sign then verify round-trips', () => {
    const e = entry();
    e.sig = signOutcomeEvidence(e);
    assert.equal(verifyOutcomeEvidenceSignature(e), true);
  });
  test('signature is deterministic', () => {
    const a = entry({ ranAt: '2026-06-16T00:00:00.000Z' });
    const b = entry({ ranAt: '2026-06-16T00:00:00.000Z' });
    assert.equal(signOutcomeEvidence(a), signOutcomeEvidence(b));
  });
  test('an unsigned receipt does not verify', () => {
    assert.equal(verifyOutcomeEvidenceSignature(entry()), false);
  });
  test('flipping passed after signing is detected', () => {
    const e = entry({ passed: false });
    e.sig = signOutcomeEvidence(e);
    e.passed = true; // forge a fail into a pass
    assert.equal(verifyOutcomeEvidenceSignature(e), false);
  });
  test('inflating the tier after signing is detected', () => {
    const e = entry({ tier: 'T5' });
    e.sig = signOutcomeEvidence(e);
    (e as { tier: string }).tier = 'T7';
    assert.equal(verifyOutcomeEvidenceSignature(e), false);
  });
  test('moving evidencePath does NOT break the sig (a location is not a claim)', () => {
    const e = entry({ evidencePath: '/a/x.json' });
    e.sig = signOutcomeEvidence(e);
    e.evidencePath = '/b/y.json';
    assert.equal(verifyOutcomeEvidenceSignature(e), true);
  });
});

describe('loadOutcomeEvidence — CH-025 read gate', () => {
  const SHA = 'a'.repeat(40);
  const file = `${SHA}-testing-o1.json`;
  const seam = (json: string) => ({
    _exists: async () => true,
    _readdir: async () => [file],
    _readFile: async () => json,
    _readGitSha: async () => SHA,
  });

  test('a VALID signed receipt is loaded', async () => {
    const e = entry({ gitSha: SHA });
    e.sig = signOutcomeEvidence(e);
    const ev = await loadOutcomeEvidence('/x', SHA, seam(JSON.stringify(e)));
    assert.equal(ev.size, 1);
  });

  test('a TAMPERED signed receipt is rejected (always, no flag)', async () => {
    const e = entry({ gitSha: SHA, passed: false });
    e.sig = signOutcomeEvidence(e);
    e.passed = true; // forge after signing
    const ev = await loadOutcomeEvidence('/x', SHA, seam(JSON.stringify(e)));
    assert.equal(ev.size, 0, 'tampered receipt cannot feed a score');
  });

  test('an UNSIGNED receipt: honored by default, rejected under strict enforcement', async () => {
    const unsigned = JSON.stringify(entry({ gitSha: SHA }));
    const prev = process.env['DANTEFORGE_REQUIRE_SIGNED_EVIDENCE'];
    delete process.env['DANTEFORGE_REQUIRE_SIGNED_EVIDENCE'];
    try {
      const lenient = await loadOutcomeEvidence('/x', SHA, seam(unsigned));
      assert.equal(lenient.size, 1, 'unsigned honored pre-migration (matrix does not collapse)');
      process.env['DANTEFORGE_REQUIRE_SIGNED_EVIDENCE'] = '1';
      const strict = await loadOutcomeEvidence('/x', SHA, seam(unsigned));
      assert.equal(strict.size, 0, 'unsigned rejected once enforcement is on');
    } finally {
      if (prev !== undefined) process.env['DANTEFORGE_REQUIRE_SIGNED_EVIDENCE'] = prev;
      else delete process.env['DANTEFORGE_REQUIRE_SIGNED_EVIDENCE'];
    }
  });
});
