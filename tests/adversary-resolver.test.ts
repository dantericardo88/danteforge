import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdversaryProvider } from '../src/core/adversary-resolver.js';
import type { DanteConfig } from '../src/core/config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DanteConfig> = {}): DanteConfig {
  return {
    defaultProvider: 'ollama',
    providers: {
      ollama: { model: 'llama3' },
      claude: { apiKey: 'sk-ant-test' },
      grok: { apiKey: 'xai-test', model: 'grok-3' },
    },
    adversary: undefined,
    ...overrides,
  } as unknown as DanteConfig;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveAdversaryProvider', () => {
  it('returns null when adversary.enabled === false', async () => {
    const config = makeConfig({ adversary: { enabled: false } });
    const result = await resolveAdversaryProvider(config);
    assert.equal(result, null);
  });

  it('uses configured provider when adversary.provider is set', async () => {
    const config = makeConfig({ adversary: { provider: 'grok', model: 'grok-3-mini' } });
    const result = await resolveAdversaryProvider(config);
    assert.ok(result !== null);
    assert.equal(result!.provider, 'grok');
    assert.equal(result!.model, 'grok-3-mini');
  });

  it('mode is "configured" when adversary.provider is set', async () => {
    const config = makeConfig({ adversary: { provider: 'claude' } });
    const result = await resolveAdversaryProvider(config);
    assert.equal(result?.mode, 'configured');
  });

  it('reads adversary provider from env var', async () => {
    const config = makeConfig({ defaultProvider: 'claude' });
    const result = await resolveAdversaryProvider(config, {
      _env: { DANTEFORGE_ADVERSARY_PROVIDER: 'grok' },
      _probeOllama: async () => false,
    });
    assert.ok(result !== null);
    assert.equal(result!.provider, 'grok');
    assert.equal(result!.mode, 'configured');
  });

  it('auto-detects Ollama when primary is not ollama and Ollama is available', async () => {
    const config = makeConfig({ defaultProvider: 'claude' });
    const result = await resolveAdversaryProvider(config, {
      _env: {},
      _probeOllama: async () => true,
    });
    assert.ok(result !== null);
    assert.equal(result!.provider, 'ollama');
    assert.equal(result!.mode, 'ollama-auto');
  });

  it('does NOT auto-detect Ollama when primary provider is ollama and no alternate model installed', async () => {
    const config = makeConfig({ defaultProvider: 'ollama', ollamaModel: 'llama3' } as Partial<DanteConfig>);
    const result = await resolveAdversaryProvider(config, {
      _env: {},
      _probeOllama: async () => { throw new Error('should not be called'); },
      // Only the primary model installed — no alternate available
      _fetchOllamaModels: async () => ['llama3'],
    });
    // Falls through to self-challenge since no alternate model exists
    assert.equal(result?.mode, 'self-challenge');
  });

  it('falls back to self-challenge when Ollama probe returns false', async () => {
    const config = makeConfig({ defaultProvider: 'claude' });
    const result = await resolveAdversaryProvider(config, {
      _env: {},
      _probeOllama: async () => false,
    });
    assert.ok(result !== null);
    assert.equal(result!.mode, 'self-challenge');
    assert.equal(result!.provider, 'claude');
  });

  it('_probeOllama seam is used instead of real probe', async () => {
    let probed = false;
    const config = makeConfig({ defaultProvider: 'claude' });
    await resolveAdversaryProvider(config, {
      _env: {},
      _probeOllama: async () => { probed = true; return false; },
    });
    assert.ok(probed);
  });

  it('inherits API key from adversary section when set', async () => {
    const config = makeConfig({
      adversary: { provider: 'grok', apiKey: 'adversary-specific-key' },
    });
    const result = await resolveAdversaryProvider(config);
    assert.equal(result?.apiKey, 'adversary-specific-key');
  });

  it('inherits API key from providers[provider] when adversary.apiKey not set', async () => {
    const config = makeConfig({
      adversary: { provider: 'grok' },
      providers: { grok: { apiKey: 'provider-key', model: 'grok-3' } },
    } as unknown as Partial<DanteConfig>);
    const result = await resolveAdversaryProvider(config, { _env: {} });
    assert.equal(result?.apiKey, 'provider-key');
  });

  it('inherits API key from env var when no adversary or provider key', async () => {
    const config = makeConfig({
      adversary: { provider: 'grok' },
      providers: { grok: {} },
    } as unknown as Partial<DanteConfig>);
    const result = await resolveAdversaryProvider(config, {
      _env: { DANTEFORGE_GROK_API_KEY: 'env-grok-key' },
    });
    assert.equal(result?.apiKey, 'env-grok-key');
  });

  it('inherits baseUrl from adversary section', async () => {
    const config = makeConfig({
      adversary: { provider: 'claude', baseUrl: 'https://custom.endpoint.com' },
    });
    const result = await resolveAdversaryProvider(config);
    assert.equal(result?.baseUrl, 'https://custom.endpoint.com');
  });

  it('does not throw when Ollama probe throws', async () => {
    const config = makeConfig({ defaultProvider: 'claude' });
    const result = await resolveAdversaryProvider(config, {
      _env: {},
      _probeOllama: async () => { throw new Error('probe failed'); },
    });
    // Should fall through to self-challenge, not throw
    assert.ok(result !== null);
    assert.equal(result!.mode, 'self-challenge');
  });

  // ── Sprint 49: alternate Ollama model diversity ──────────────────────────────

  it('uses alternate Ollama model when primary is ollama and a different model is installed', async () => {
    const config = makeConfig({
      defaultProvider: 'ollama',
      ollamaModel: 'qwen2.5-coder:latest',
    } as Partial<DanteConfig>);
    const result = await resolveAdversaryProvider(config, {
      _env: {},
      _fetchOllamaModels: async () => ['qwen2.5-coder:latest', 'llama3.1:latest', 'mistral:7b'],
    });
    assert.ok(result !== null, 'Should return a result');
    assert.equal(result!.mode, 'ollama-auto', 'Should use ollama-auto mode with alternate model');
    assert.notEqual(result!.model, 'qwen2.5-coder:latest', 'Should not pick the primary model');
    assert.ok(
      result!.model === 'llama3.1:latest' || result!.model === 'mistral:7b',
      `Expected alternate model, got: ${result!.model}`,
    );
  });

  it('falls back to self-challenge when only one Ollama model is installed', async () => {
    const config = makeConfig({
      defaultProvider: 'ollama',
      ollamaModel: 'qwen2.5-coder:latest',
    } as Partial<DanteConfig>);
    const result = await resolveAdversaryProvider(config, {
      _env: {},
      _fetchOllamaModels: async () => ['qwen2.5-coder:latest'],
    });
    assert.ok(result !== null);
    assert.equal(result!.mode, 'self-challenge', 'Only one model installed → self-challenge');
  });
});
