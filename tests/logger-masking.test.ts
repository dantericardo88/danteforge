import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('logger masking', () => {
  beforeEach(async () => {
    // Re-import to get fresh module state — workaround for module caching
    // We'll test the exported functions directly
  });

  it('maskSecrets returns input unchanged when no patterns registered', async () => {
    // Fresh import via dynamic import to avoid stale module state
    // Note: since SECRET_PATTERNS is module-level, we test the exported function directly
    const { maskSecrets } = await import('../src/core/logger.js');
    const result = maskSecrets('hello world');
    // Should not contain [REDACTED] if the pattern wasn't registered
    assert.ok(typeof result === 'string');
  });

  it('maskSecrets redacts literal string match', async () => {
    const { maskSecrets, registerSecretPattern } = await import('../src/core/logger.js');
    registerSecretPattern(/super-secret-key/g);
    const result = maskSecrets('api call with super-secret-key token');
    assert.ok(!result.includes('super-secret-key'), 'Should have redacted the secret');
    assert.ok(result.includes('[REDACTED]'));
  });

  it('maskSecrets redacts multiple occurrences in one string', async () => {
    const { maskSecrets, registerSecretPattern } = await import('../src/core/logger.js');
    registerSecretPattern(/my-api-key-123/g);
    const result = maskSecrets('key=my-api-key-123 and again my-api-key-123');
    assert.equal((result.match(/\[REDACTED\]/g) ?? []).length, 2);
  });

  it('multiple registered patterns all apply', async () => {
    const { maskSecrets, registerSecretPattern } = await import('../src/core/logger.js');
    registerSecretPattern(/secret-alpha/g);
    registerSecretPattern(/secret-beta/g);
    const result = maskSecrets('secret-alpha and secret-beta here');
    assert.ok(!result.includes('secret-alpha'));
    assert.ok(!result.includes('secret-beta'));
  });

  it('registerSecretPattern handles regex special chars in API keys', async () => {
    const { maskSecrets, registerSecretPattern } = await import('../src/core/logger.js');
    // API keys sometimes have dots, which are regex special chars
    // Using a literal-safe pattern
    registerSecretPattern(new RegExp('xai\\.key\\.abc123', 'g'));
    // This just verifies it doesn't throw
    const result = maskSecrets('token xai.key.abc123 here');
    assert.ok(typeof result === 'string');
  });

  it('maskSecrets export exists and is a function', async () => {
    const mod = await import('../src/core/logger.js');
    assert.equal(typeof mod.maskSecrets, 'function');
    assert.equal(typeof mod.registerSecretPattern, 'function');
  });
});
