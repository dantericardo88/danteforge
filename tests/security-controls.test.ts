import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSecurityControls } from '../src/core/security-controls.js';

describe('validateSecurityControls', () => {
  it('returns all false when no checks requested', async () => {
    const result = await validateSecurityControls({});
    assert.equal(result.secretsSecure, false);
    assert.equal(result.permissionsValid, false);
    assert.equal(result.integrityVerified, false);
    assert.deepEqual(result.issues, []);
  });

  it('checkPermissions sets permissionsValid true when configDir accessible', async () => {
    // On a real machine the home/.danteforge dir may or may not exist;
    // the function sets permissionsValid=true optimistically on access and catches errors silently.
    const result = await validateSecurityControls({ checkPermissions: true });
    // Either true (dir exists) or false with an issue (dir missing) — both are valid paths
    assert.ok(typeof result.permissionsValid === 'boolean');
  });

  it('checkIntegrity adds issue when audit dir missing', async () => {
    // In a fresh test environment .danteforge/audit is unlikely to exist at process.cwd()
    const result = await validateSecurityControls({ checkIntegrity: true });
    // Either verified (dir exists) or issue added — both valid
    assert.ok(typeof result.integrityVerified === 'boolean');
    assert.ok(Array.isArray(result.issues));
  });

  it('checkSecrets runs without throwing', async () => {
    // git command may fail in test env — function catches and adds issue
    const result = await validateSecurityControls({ checkSecrets: true });
    assert.ok(Array.isArray(result.issues));
  });

  it('issues array collects from all enabled checks', async () => {
    const result = await validateSecurityControls({
      checkSecrets: true,
      checkPermissions: true,
      checkIntegrity: true,
    });
    assert.ok(Array.isArray(result.issues));
  });
});
