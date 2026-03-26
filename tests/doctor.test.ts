// doctor.ts — unit tests for the exported pure-function helpers
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateLiveReleaseConfig } from '../src/cli/commands/doctor.js';

describe('validateLiveReleaseConfig — branch coverage', () => {
  it('returns an error when DANTEFORGE_LIVE_PROVIDERS is not set', () => {
    const result = validateLiveReleaseConfig({});
    assert.ok(result.error?.includes('Set DANTEFORGE_LIVE_PROVIDERS'), `expected env-missing error, got: ${result.error}`);
    assert.deepStrictEqual(result.providers, []);
    assert.deepStrictEqual(result.missing, []);
  });

  it('returns an error when DANTEFORGE_LIVE_PROVIDERS is set but empty after split', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: '  ,  ,  ' });
    assert.ok(result.error?.includes('did not contain any providers'), `expected empty-providers error, got: ${result.error}`);
  });

  it('returns an error when an unknown provider is listed', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'openai,unknown_provider' });
    assert.ok(result.error?.includes('unknown_provider'), `expected unknown-provider error, got: ${result.error}`);
  });

  it('reports missing API key for openai when key is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'openai' });
    assert.strictEqual(result.error, undefined, 'should not have a top-level error');
    assert.ok(result.missing.some(m => m.includes('OPENAI_API_KEY')), `expected OPENAI_API_KEY in missing, got: ${JSON.stringify(result.missing)}`);
  });

  it('reports missing API key for claude when key is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'claude' });
    assert.ok(result.missing.some(m => m.includes('ANTHROPIC_API_KEY')), `expected ANTHROPIC_API_KEY in missing`);
  });

  it('reports missing API key for gemini when key is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'gemini' });
    assert.ok(result.missing.some(m => m.includes('GEMINI_API_KEY')), `expected GEMINI_API_KEY in missing`);
  });

  it('reports missing API key for grok when key is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'grok' });
    assert.ok(result.missing.some(m => m.includes('XAI_API_KEY')), `expected XAI_API_KEY in missing`);
  });

  it('reports missing OLLAMA_MODEL for ollama when model is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'ollama' });
    assert.ok(result.missing.some(m => m.includes('OLLAMA_MODEL')), `expected OLLAMA_MODEL in missing`);
  });

  it('returns success when openai provider has a valid API key', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'openai',
      OPENAI_API_KEY: 'sk-test-key',
    });
    assert.strictEqual(result.error, undefined, 'should not have an error');
    assert.deepStrictEqual(result.missing, [], 'should have no missing items');
    assert.deepStrictEqual(result.providers, ['openai']);
  });

  it('deduplicates providers and returns success for all with keys', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'openai,openai,claude',
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'ant-test',
    });
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.missing, []);
    assert.deepStrictEqual(result.providers, ['openai', 'claude'], 'should deduplicate openai');
  });

  it('returns ollama success when OLLAMA_MODEL is set', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'ollama',
      OLLAMA_MODEL: 'llama3',
    });
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.missing, []);
  });
});
