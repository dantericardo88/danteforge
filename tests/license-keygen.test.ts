import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLicenseKey, computeExpectedHmac } from '../src/core/license-keygen.js';

describe('generateLicenseKey', () => {
  const expires = new Date('2026-12-31T00:00:00.000Z');

  it('starts with DF-PRO for pro tier', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: expires });
    assert.ok(key.startsWith('DF-PRO-'));
  });

  it('starts with DF-ENT for enterprise tier', () => {
    const key = generateLicenseKey({ tier: 'enterprise', expiresAt: expires });
    assert.ok(key.startsWith('DF-ENT-'));
  });

  it('embeds the expiry date in YYYYMMDD format', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: expires });
    assert.ok(key.includes('20261231'));
  });

  it('appends a 16-char uppercase hex HMAC', () => {
    const key = generateLicenseKey({ tier: 'pro', expiresAt: expires });
    const parts = key.split('-');
    const hmac = parts[parts.length - 1];
    assert.equal(hmac.length, 16);
    assert.match(hmac, /^[A-F0-9]{16}$/);
  });

  it('is deterministic for same inputs and same secret', () => {
    const opts = { tier: 'pro' as const, expiresAt: expires, deps: { _getSecret: () => 'test-secret' } };
    const key1 = generateLicenseKey(opts);
    const key2 = generateLicenseKey(opts);
    assert.equal(key1, key2);
  });

  it('changes when secret changes', () => {
    const key1 = generateLicenseKey({ tier: 'pro', expiresAt: expires, deps: { _getSecret: () => 'secret-A' } });
    const key2 = generateLicenseKey({ tier: 'pro', expiresAt: expires, deps: { _getSecret: () => 'secret-B' } });
    assert.notEqual(key1, key2);
  });

  it('changes when tier changes', () => {
    const base = { expiresAt: expires, deps: { _getSecret: () => 'shared-secret' } };
    const pro = generateLicenseKey({ tier: 'pro', ...base });
    const ent = generateLicenseKey({ tier: 'enterprise', ...base });
    assert.notEqual(pro, ent);
  });

  it('changes when date changes', () => {
    const base = { tier: 'pro' as const, deps: { _getSecret: () => 'shared-secret' } };
    const key1 = generateLicenseKey({ ...base, expiresAt: new Date('2026-01-01T00:00:00.000Z') });
    const key2 = generateLicenseKey({ ...base, expiresAt: new Date('2027-01-01T00:00:00.000Z') });
    assert.notEqual(key1, key2);
  });
});

describe('computeExpectedHmac', () => {
  it('returns a Buffer', () => {
    const result = computeExpectedHmac('DF-PRO-20261231', 'test-secret');
    assert.ok(Buffer.isBuffer(result));
  });

  it('is deterministic', () => {
    const a = computeExpectedHmac('DF-PRO-20261231', 'test-secret');
    const b = computeExpectedHmac('DF-PRO-20261231', 'test-secret');
    assert.equal(a.toString(), b.toString());
  });

  it('changes with different body', () => {
    const a = computeExpectedHmac('DF-PRO-20261231', 'secret');
    const b = computeExpectedHmac('DF-ENT-20261231', 'secret');
    assert.notEqual(a.toString(), b.toString());
  });

  it('produces 16-char uppercase hex buffer content', () => {
    const result = computeExpectedHmac('DF-PRO-20261231', 'test-secret');
    const str = result.toString('utf-8');
    assert.equal(str.length, 16);
    assert.match(str, /^[A-F0-9]{16}$/);
  });
});
