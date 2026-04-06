import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePremiumLicense,
  isLicenseExpired,
  canAccessFeature,
  requirePremiumFeature,
} from '../src/core/premium.js';
import { generateLicenseKey } from '../src/core/license-keygen.js';

const TEST_SECRET = 'test-secret-for-gates';
const testDeps = { _getSecret: () => TEST_SECRET };
const farFuture = new Date('2099-12-31');

describe('validatePremiumLicense', () => {
  it('rejects empty key', () => {
    assert.equal(validatePremiumLicense('').valid, false);
  });

  it('non-HMAC keys are rejected (old 4-segment format with wrong HMAC)', () => {
    // Old-style keys without valid HMAC are now rejected
    const r = validatePremiumLicense('DF-PRO-20991231-TESTKEY', testDeps);
    assert.equal(r.valid, false);
  });

  it('non-HMAC enterprise keys are rejected', () => {
    const r = validatePremiumLicense('DF-ENT-20991231-TESTKEY', testDeps);
    assert.equal(r.valid, false);
  });

  it('accepts HMAC-signed pro key as pro tier', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    const r = validatePremiumLicense(key, testDeps);
    assert.equal(r.valid, true);
    assert.equal(r.tier, 'pro');
  });

  it('accepts HMAC-signed enterprise key as enterprise tier', () => {
    const key = generateLicenseKey({ tier: 'enterprise', expiresAt: farFuture, deps: testDeps });
    const r = validatePremiumLicense(key, testDeps);
    assert.equal(r.valid, true);
    assert.equal(r.tier, 'enterprise');
  });

  it('extracts expiry date from valid HMAC key', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: new Date('2026-12-31'), deps: testDeps });
    const r = validatePremiumLicense(key, testDeps);
    assert.equal(r.expiresAt, '2026-12-31');
  });
});

describe('isLicenseExpired', () => {
  it('returns false for far-future expiry', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    assert.equal(isLicenseExpired(key, testDeps), false);
  });

  it('returns true for past expiry', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: new Date('2020-01-01'), deps: testDeps });
    assert.equal(isLicenseExpired(key, testDeps), true);
  });

  it('returns false for key without date portion (3-segment old format)', () => {
    // Old format — validatePremiumLicense returns valid: false, so isLicenseExpired returns false
    assert.equal(isLicenseExpired('DF-PRO-TESTKEY'), false);
  });
});

describe('requirePremiumFeature', () => {
  it('throws DanteError with PREMIUM_REQUIRED code when free tier tries to access pro feature', async () => {
    const savedKey = process.env['DANTEFORGE_LICENSE_KEY'];
    delete process.env['DANTEFORGE_LICENSE_KEY'];
    try {
      await assert.rejects(
        () => requirePremiumFeature('audit-export', '/nonexistent'),
        (err: any) => err.code === 'PREMIUM_REQUIRED',
      );
    } finally {
      if (savedKey !== undefined) process.env['DANTEFORGE_LICENSE_KEY'] = savedKey;
    }
  });
});
