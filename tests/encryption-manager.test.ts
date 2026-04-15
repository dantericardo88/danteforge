// EncryptionManager tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EncryptionManager } from '../src/core/encryption-manager.js';

describe('EncryptionManager', () => {
  it('constructs with defaults', () => {
    const mgr = new EncryptionManager();
    const status = mgr.getEncryptionStatus();
    assert.equal(status.algorithm, 'aes-256-gcm');
    assert.equal(status.atRestEnabled, true);
    assert.equal(status.inTransitEnabled, false);
    assert.equal(status.keysGenerated, 0);
  });

  it('accepts custom options', () => {
    const mgr = new EncryptionManager({ enableAtRest: false, enableInTransit: true });
    const status = mgr.getEncryptionStatus();
    assert.equal(status.atRestEnabled, false);
    assert.equal(status.inTransitEnabled, true);
  });

  it('generateKey creates a key', async () => {
    const mgr = new EncryptionManager();
    await mgr.generateKey('k1');
    assert.equal(mgr.getEncryptionStatus().keysGenerated, 1);
  });

  it('generates multiple distinct keys', async () => {
    const mgr = new EncryptionManager();
    await mgr.generateKey('k1');
    await mgr.generateKey('k2');
    assert.equal(mgr.getEncryptionStatus().keysGenerated, 2);
  });

  it('encryptData returns a JSON string', async () => {
    const mgr = new EncryptionManager();
    await mgr.generateKey('k1');
    const result = await mgr.encryptData('hello world', 'k1');
    const parsed = JSON.parse(result) as Record<string, unknown>;
    assert.ok(typeof parsed['encrypted'] === 'string');
    assert.ok(typeof parsed['iv'] === 'string');
    assert.ok(typeof parsed['algorithm'] === 'string');
  });

  it('encryptData throws when key not found', async () => {
    const mgr = new EncryptionManager();
    await assert.rejects(() => mgr.encryptData('data', 'missing'), /not found/);
  });

  it('decryptData throws when key not found', async () => {
    const mgr = new EncryptionManager();
    const payload = JSON.stringify({ encrypted: 'abc', iv: '00'.repeat(16), algorithm: 'aes-256-gcm' });
    await assert.rejects(() => mgr.decryptData(payload, 'missing'), /not found/);
  });

  it('encrypt and decrypt roundtrip', async () => {
    // Use aes-256-cbc (non-GCM) so no auth tag required for roundtrip test
    const mgr = new EncryptionManager({ algorithm: 'aes-256-cbc', keyLength: 32 });
    await mgr.generateKey('k1');
    const plaintext = 'secret message';
    const encrypted = await mgr.encryptData(plaintext, 'k1');
    const decrypted = await mgr.decryptData(encrypted, 'k1');
    assert.equal(decrypted, plaintext);
  });

  it('getEncryptionStatus reflects generated key count', async () => {
    const mgr = new EncryptionManager();
    assert.equal(mgr.getEncryptionStatus().keysGenerated, 0);
    await mgr.generateKey('k1');
    assert.equal(mgr.getEncryptionStatus().keysGenerated, 1);
    await mgr.generateKey('k2');
    assert.equal(mgr.getEncryptionStatus().keysGenerated, 2);
  });
});
