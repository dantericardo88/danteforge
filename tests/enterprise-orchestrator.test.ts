// EnterpriseOrchestrator tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeEnterpriseFeatures,
  getEnterpriseReadinessScore,
} from '../src/core/enterprise-orchestrator.js';

describe('initializeEnterpriseFeatures', () => {
  it('returns an EnterpriseFeatures object with required shape', async () => {
    const features = await initializeEnterpriseFeatures();
    assert.ok(typeof features.accessControl === 'object');
    assert.ok(typeof features.encryption === 'object');
    assert.ok(typeof features.multiTenancy === 'object');
  });

  it('access control is enabled by default', async () => {
    const features = await initializeEnterpriseFeatures();
    assert.equal(features.accessControl.enabled, true);
  });

  it('access control has at least 2 default policies', async () => {
    const features = await initializeEnterpriseFeatures();
    assert.ok(features.accessControl.policiesCount >= 2);
  });

  it('encryption is enabled with default algorithm', async () => {
    const features = await initializeEnterpriseFeatures();
    assert.equal(features.encryption.enabled, true);
    assert.equal(features.encryption.algorithm, 'aes-256-gcm');
    assert.equal(features.encryption.atRestEnabled, true);
  });

  it('generates at least 2 default encryption keys', async () => {
    const features = await initializeEnterpriseFeatures();
    assert.ok(features.encryption.keysGenerated >= 2);
  });

  it('multi-tenancy is enabled with default tenant', async () => {
    const features = await initializeEnterpriseFeatures();
    assert.equal(features.multiTenancy.enabled, true);
    assert.ok(features.multiTenancy.tenantsCount >= 1);
  });

  it('lastAudit is an ISO timestamp', async () => {
    const features = await initializeEnterpriseFeatures();
    assert.ok(typeof features.accessControl.lastAudit === 'string');
    assert.ok(!isNaN(Date.parse(features.accessControl.lastAudit!)));
  });
});

describe('getEnterpriseReadinessScore', () => {
  it('returns a number between 0 and 10', async () => {
    const score = await getEnterpriseReadinessScore();
    assert.ok(typeof score === 'number');
    assert.ok(score >= 0);
    assert.ok(score <= 10);
  });

  it('returns a score above 7 with full enterprise initialization', async () => {
    // All enterprise features initialized: access(3) + encryption(3) + tenancy(3) = 9
    const score = await getEnterpriseReadinessScore();
    assert.ok(score >= 7, `Expected score >= 7 but got ${score}`);
  });
});
