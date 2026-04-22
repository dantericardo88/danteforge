import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateLiveReleaseConfig } from '../src/cli/commands/doctor.js';

describe('validateLiveReleaseConfig', () => {
  it('returns error when DANTEFORGE_LIVE_PROVIDERS not set', () => {
    const result = validateLiveReleaseConfig({});
    assert.ok('error' in result);
    assert.ok(result.error?.includes('DANTEFORGE_LIVE_PROVIDERS'));
  });

  it('returns error when DANTEFORGE_LIVE_PROVIDERS is empty string', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: '' });
    assert.ok('error' in result);
  });

  it('returns error for unknown provider', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'unknown-provider' });
    assert.ok(result.error?.includes('Unknown live provider'));
  });

  it('returns providers array for valid single provider without API key', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'ollama' });
    assert.ok(Array.isArray(result.providers));
    assert.ok(result.providers.includes('ollama'));
  });

  it('reports missing API key for openai', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'openai' });
    assert.ok(result.missing.length > 0);
    assert.ok(result.missing.some(m => m.includes('OPENAI_API_KEY')));
  });

  it('reports missing API key for claude', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'claude' });
    assert.ok(result.missing.some(m => m.includes('ANTHROPIC_API_KEY')));
  });

  it('does not report missing key when API key is provided', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    assert.equal(result.missing.length, 0);
  });

  it('handles multiple providers', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'openai,claude',
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'ant-test',
    });
    assert.ok(result.providers.includes('openai'));
    assert.ok(result.providers.includes('claude'));
    assert.equal(result.missing.length, 0);
  });

  it('deduplicates providers', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'ollama,ollama',
      OLLAMA_MODEL: 'llama3',
    });
    assert.equal(result.providers.length, 1);
  });

  it('reports missing OLLAMA_MODEL for ollama', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'ollama' });
    assert.ok(result.missing.some(m => m.includes('OLLAMA_MODEL')));
  });
});
