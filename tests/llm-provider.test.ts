import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerProvider,
  getProvider,
  listProviders,
  isRegisteredProvider,
  togetherAdapter,
  groqAdapter,
  mistralAdapter,
} from '../src/core/llm-provider.js';
import type { LLMProviderAdapter } from '../src/core/llm-provider.js';

function makeAdapter(id: string): LLMProviderAdapter {
  return {
    id,
    displayName: `Test ${id}`,
    defaultModel: 'test-model',
    defaultBaseUrl: 'https://api.test.com/v1',
    inputPricePer1M: 1.0,
    outputPricePer1M: 2.0,
    maxTokens: 4096,
    requiresApiKey: true,
    call: async () => 'test response',
  };
}

describe('llm-provider registry', () => {
  it('built-in providers are registered on import', () => {
    assert.ok(isRegisteredProvider('together'));
    assert.ok(isRegisteredProvider('groq'));
    assert.ok(isRegisteredProvider('mistral'));
  });

  it('getProvider returns registered adapter', () => {
    const adapter = getProvider('together');
    assert.ok(adapter !== undefined);
    assert.equal(adapter!.id, 'together');
    assert.equal(adapter!.displayName, 'Together.ai');
  });

  it('getProvider returns undefined for unknown id', () => {
    assert.equal(getProvider('nonexistent-provider-xyz'), undefined);
  });

  it('isRegisteredProvider returns false for unknown id', () => {
    assert.equal(isRegisteredProvider('nonexistent-xyz'), false);
  });

  it('listProviders includes all built-in adapters', () => {
    const providers = listProviders();
    const ids = providers.map(p => p.id);
    assert.ok(ids.includes('together'));
    assert.ok(ids.includes('groq'));
    assert.ok(ids.includes('mistral'));
  });

  it('registerProvider adds new adapter', () => {
    const adapter = makeAdapter('test-provider-42');
    registerProvider(adapter);
    assert.ok(isRegisteredProvider('test-provider-42'));
    assert.equal(getProvider('test-provider-42')!.displayName, 'Test test-provider-42');
  });

  it('registerProvider overwrites existing adapter', () => {
    const a1 = makeAdapter('overwrite-test');
    a1.displayName = 'First';
    const a2 = makeAdapter('overwrite-test');
    a2.displayName = 'Second';
    registerProvider(a1);
    registerProvider(a2);
    assert.equal(getProvider('overwrite-test')!.displayName, 'Second');
  });
});

describe('built-in adapter properties', () => {
  it('togetherAdapter has correct metadata', () => {
    assert.equal(togetherAdapter.id, 'together');
    assert.ok(togetherAdapter.requiresApiKey);
    assert.ok(togetherAdapter.maxTokens > 0);
    assert.ok(togetherAdapter.defaultBaseUrl.includes('together'));
  });

  it('groqAdapter has correct metadata', () => {
    assert.equal(groqAdapter.id, 'groq');
    assert.ok(groqAdapter.requiresApiKey);
    assert.ok(groqAdapter.defaultBaseUrl.includes('groq'));
  });

  it('mistralAdapter has correct metadata', () => {
    assert.equal(mistralAdapter.id, 'mistral');
    assert.ok(mistralAdapter.requiresApiKey);
    assert.ok(mistralAdapter.defaultBaseUrl.includes('mistral'));
  });

  it('togetherAdapter.call throws without api key', async () => {
    await assert.rejects(
      () => togetherAdapter.call('hello', 'model', 'https://api.together.xyz/v1', undefined, 5000),
      /No API key/
    );
  });

  it('groqAdapter.call throws without api key', async () => {
    await assert.rejects(
      () => groqAdapter.call('hello', 'model', 'https://api.groq.com/v1', undefined, 5000),
      /No API key/
    );
  });

  it('mistralAdapter.call throws without api key', async () => {
    await assert.rejects(
      () => mistralAdapter.call('hello', 'model', 'https://api.mistral.ai/v1', undefined, 5000),
      /No API key/
    );
  });
});
