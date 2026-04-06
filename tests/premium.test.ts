import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateLicenseKey } from '../src/core/license-keygen.js';

const TEST_SECRET = 'premium-test-secret';
const testDeps = { _getSecret: () => TEST_SECRET };

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('Premium', () => {
  it('canAccessFeature gates by tier', async () => {
    const { canAccessFeature } = await import('../src/core/premium.js');

    assert.strictEqual(canAccessFeature('free', 'cloud-audit'), false);
    assert.strictEqual(canAccessFeature('pro', 'cloud-audit'), true);
    assert.strictEqual(canAccessFeature('enterprise', 'cloud-audit'), true);
  });

  it('enterprise features require enterprise tier', async () => {
    const { canAccessFeature } = await import('../src/core/premium.js');

    assert.strictEqual(canAccessFeature('free', 'sla-verification'), false);
    assert.strictEqual(canAccessFeature('pro', 'sla-verification'), false);
    assert.strictEqual(canAccessFeature('enterprise', 'sla-verification'), true);
  });

  it('listPremiumFeatures returns all features with tiers', async () => {
    const { listPremiumFeatures } = await import('../src/core/premium.js');
    const features = listPremiumFeatures();

    assert.ok(features.length >= 4);
    assert.ok(features.some(f => f.feature === 'cloud-audit'));
    assert.ok(features.some(f => f.feature === 'sla-verification'));
  });

  it('validatePremiumLicense recognizes HMAC-signed pro and enterprise keys', async () => {
    const { validatePremiumLicense } = await import('../src/core/premium.js');
    const farFuture = new Date('2099-12-31');

    const proKey = generateLicenseKey({ tier: 'pro', expiresAt: farFuture, deps: testDeps });
    const proResult = validatePremiumLicense(proKey, testDeps);
    assert.strictEqual(proResult.valid, true);
    assert.strictEqual(proResult.tier, 'pro');

    const entKey = generateLicenseKey({ tier: 'enterprise', expiresAt: farFuture, deps: testDeps });
    const entResult = validatePremiumLicense(entKey, testDeps);
    assert.strictEqual(entResult.valid, true);
    assert.strictEqual(entResult.tier, 'enterprise');

    const invalidResult = validatePremiumLicense('invalid-key');
    assert.strictEqual(invalidResult.valid, false);
    assert.strictEqual(invalidResult.tier, 'free');
  });

  it('exportAuditTrail returns empty for fresh project', async () => {
    const { exportAuditTrail } = await import('../src/core/premium.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-audit-'));
    tempDirs.push(tmpDir);

    const entries = await exportAuditTrail(tmpDir);
    assert.strictEqual(entries.length, 0);
  });

  it('getPremiumConfig returns correct flags per tier', async () => {
    const { getPremiumConfig } = await import('../src/core/premium.js');

    const free = getPremiumConfig('free');
    assert.strictEqual(free.cloudAuditEnabled, false);
    assert.strictEqual(free.slaVerification, false);

    const pro = getPremiumConfig('pro');
    assert.strictEqual(pro.cloudAuditEnabled, true);
    assert.strictEqual(pro.slaVerification, false);

    const ent = getPremiumConfig('enterprise');
    assert.strictEqual(ent.cloudAuditEnabled, true);
    assert.strictEqual(ent.slaVerification, true);
  });
});
