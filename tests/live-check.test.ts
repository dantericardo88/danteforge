import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  DEFAULT_LIVE_REQUEST_TIMEOUT_MS,
  DEFAULT_OLLAMA_LIVE_REQUEST_TIMEOUT_MS,
  formatLiveConfigurationError,
  getProviderCredentialRequirements,
  parseLiveProviders,
  resolveLiveRequestTimeoutMs,
  validateLiveConfiguration,
} from '../scripts/live-check-lib.mjs';

describe('live check configuration', () => {
  it('parses provider lists case-insensitively and removes duplicates', () => {
    const providers = parseLiveProviders(' OpenAI, claude, openai , gemini ');

    assert.deepStrictEqual(providers, ['openai', 'claude', 'gemini']);
  });

  it('reports all missing credentials for the selected providers at once', () => {
    const result = validateLiveConfiguration({
      DANTEFORGE_LIVE_PROVIDERS: 'openai,claude,ollama',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    });

    assert.deepStrictEqual(result.providers, ['openai', 'claude', 'ollama']);
    assert.deepStrictEqual(result.missing, [
      'OPENAI_API_KEY is required for openai live verification.',
      'ANTHROPIC_API_KEY is required for claude live verification.',
      'OLLAMA_MODEL is required for ollama live verification.',
    ]);
  });

  it('formats a setup error with the provider matrix and override guidance', () => {
    const message = formatLiveConfigurationError({
      providers: [],
      missing: [],
      error: 'Set DANTEFORGE_LIVE_PROVIDERS to a comma-separated list such as "openai,claude,gemini,grok,ollama".',
    });

    assert.match(message, /DANTEFORGE_LIVE_PROVIDERS/);
    assert.match(message, /OPENAI_API_KEY/);
    assert.match(message, /ANTHROPIC_API_KEY/);
    assert.match(message, /GEMINI_API_KEY/);
    assert.match(message, /XAI_API_KEY/);
    assert.match(message, /OLLAMA_BASE_URL/);
    assert.match(message, /ANTIGRAVITY_BUNDLES_URL/);
    assert.match(message, /FIGMA_MCP_URL/);
  });

  it('describes each provider credential contract explicitly', () => {
    const requirements = getProviderCredentialRequirements();

    assert.deepStrictEqual(requirements.openai, ['OPENAI_API_KEY']);
    assert.deepStrictEqual(requirements.claude, ['ANTHROPIC_API_KEY']);
    assert.deepStrictEqual(requirements.gemini, ['GEMINI_API_KEY']);
    assert.deepStrictEqual(requirements.grok, ['XAI_API_KEY']);
    assert.deepStrictEqual(requirements.ollama, ['OLLAMA_BASE_URL', 'OLLAMA_MODEL']);
  });

  it('uses longer default timeouts for Ollama live checks', () => {
    assert.strictEqual(resolveLiveRequestTimeoutMs({}, 'openai'), DEFAULT_LIVE_REQUEST_TIMEOUT_MS);
    assert.strictEqual(resolveLiveRequestTimeoutMs({}, 'ollama'), DEFAULT_OLLAMA_LIVE_REQUEST_TIMEOUT_MS);
  });

  it('allows live timeout overrides for all providers and Ollama specifically', () => {
    assert.strictEqual(
      resolveLiveRequestTimeoutMs({ DANTEFORGE_LIVE_TIMEOUT_MS: '45000' }, 'gemini'),
      45_000,
    );
    assert.strictEqual(
      resolveLiveRequestTimeoutMs(
        {
          DANTEFORGE_LIVE_TIMEOUT_MS: '45000',
          OLLAMA_TIMEOUT_MS: '125000',
        },
        'ollama',
      ),
      125_000,
    );
  });

  it('ships live verification receipt writing in the live check script', async () => {
    const fs = await import('node:fs/promises');
    const script = await fs.readFile('scripts/check-live-integrations.mjs', 'utf8');

    assert.match(script, /writeLiveVerifyReceipt/);
    assert.match(script, /evidence\/live/);
  });
});
