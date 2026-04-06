import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLicenseKey } from '../src/core/license-keygen.js';
import { validatePremiumLicense } from '../src/core/premium.js';

const TEST_SECRET = 'keygen-test-secret';
const testDeps = { _getSecret: () => TEST_SECRET };

describe('premium keygen', () => {
  it('generateLicenseKey generates a key without throwing', () => {
    assert.doesNotThrow(() => generateLicenseKey({
      tier: 'pro',
      expiresAt: new Date('2099-12-31'),
      deps: testDeps,
    }));
  });

  it('generated key is accepted by validatePremiumLicense (round-trip)', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: new Date('2099-12-31'), deps: testDeps });
    const result = validatePremiumLicense(key, testDeps);
    assert.equal(result.valid, true);
    assert.equal(result.tier, 'pro');
  });

  it('enterprise tier produces DF-ENT- prefix', () => {
    const key = generateLicenseKey({ tier: 'enterprise', expiresAt: new Date('2099-12-31'), deps: testDeps });
    assert.ok(key.startsWith('DF-ENT-'));
  });

  it('30-day key expires in ~30 days', () => {
    const now = Date.now();
    const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000);
    const key = generateLicenseKey({ tier: 'pro', expiresAt, deps: testDeps });
    const result = validatePremiumLicense(key, testDeps);
    assert.equal(result.valid, true);
    // expiresAt date in key should be approximately 30 days from now
    const keyDate = result.expiresAt;
    assert.ok(keyDate, 'Expected expiresAt in result');
    const diffDays = (new Date(keyDate!).getTime() - now) / (24 * 60 * 60 * 1000);
    assert.ok(diffDays > 28 && diffDays < 32, `Expected ~30 days, got ${diffDays}`);
  });
});
