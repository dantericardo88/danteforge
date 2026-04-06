import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLicenseKey } from '../src/core/license-keygen.js';
import { validatePremiumLicense } from '../src/core/premium.js';

const TEST_SECRET = 'test-secret-for-hmac';
const testDeps = { _getSecret: () => TEST_SECRET };
const farFuture = new Date('2099-12-31');

describe('HMAC license keys', () => {
  it('generateLicenseKey produces DF-PRO-YYYYMMDD-XXXXXXXXXXXXXXXX format', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    assert.match(key, /^DF-PRO-\d{8}-[0-9A-F]{16}$/);
  });

  it('key has exactly 4 dash-separated segments', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    assert.equal(key.split('-').length, 4);
  });

  it('HMAC segment is exactly 16 uppercase hex chars', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    const hmacPart = key.split('-')[3];
    assert.match(hmacPart, /^[0-9A-F]{16}$/);
  });

  it('round-trip: generated key validates successfully', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    const result = validatePremiumLicense(key, testDeps);
    assert.equal(result.valid, true);
    assert.equal(result.tier, 'pro');
  });

  it('tampered HMAC fails validation', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    const tampered = key.slice(0, -4) + 'XXXX';
    const result = validatePremiumLicense(tampered, testDeps);
    assert.equal(result.valid, false);
  });

  it('tampered date fails validation', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    const parts = key.split('-');
    parts[2] = '20200101'; // expired date with wrong HMAC
    const tampered = parts.join('-');
    const result = validatePremiumLicense(tampered, testDeps);
    assert.equal(result.valid, false);
  });

  it('17-char HMAC returns valid: false, not throws', () => {
    const key = 'DF-PRO-20991231-12345678901234567'; // 17 chars in HMAC segment
    const result = validatePremiumLicense(key, testDeps);
    assert.equal(result.valid, false);
  });

  it('enterprise keys validate independently', () => {
    const key = generateLicenseKey({ tier: 'enterprise', expiresAt: farFuture, deps: testDeps });
    const result = validatePremiumLicense(key, testDeps);
    assert.equal(result.valid, true);
    assert.equal(result.tier, 'enterprise');
  });

  it('DANTEFORGE_LICENSE_SECRET env var overrides default secret', () => {
    const originalEnv = process.env['DANTEFORGE_LICENSE_SECRET'];
    process.env['DANTEFORGE_LICENSE_SECRET'] = TEST_SECRET;
    try {
      const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture }); // no deps — uses env var
      const result = validatePremiumLicense(key); // no deps — uses env var
      assert.equal(result.valid, true);
    } finally {
      if (originalEnv !== undefined) {
        process.env['DANTEFORGE_LICENSE_SECRET'] = originalEnv;
      } else {
        delete process.env['DANTEFORGE_LICENSE_SECRET'];
      }
    }
  });

  it('old 3-segment format returns valid: false', () => {
    const result = validatePremiumLicense('DF-PRO-test123', testDeps);
    assert.equal(result.valid, false);
  });
});
