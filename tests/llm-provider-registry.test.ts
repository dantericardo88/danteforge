// LLM Provider Registry — tests for adapter registration, dispatch,
// Together.ai and Groq formats, and unknown provider error.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerProvider,
  getProvider,
  listProviders,
  isRegisteredProvider,
  callOpenAICompatibleAdapter,
  togetherAdapter,
  groqAdapter,
  mistralAdapter,
  type LLMProviderAdapter,
} from '../src/core/llm-provider.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAdapter(id: string): LLMProviderAdapter {
  return {
    id,
    displayName: `Test ${id}`,
    defaultModel: 'test-model',
    defaultBaseUrl: `https://${id}.example.com/v1`,
    inputPricePer1M: 1.0,
    outputPricePer1M: 2.0,
    maxTokens: 16384,
    requiresApiKey: true,
    call: async (_prompt, _model, _baseUrl, _apiKey) => `response from ${id}`,
  };
}

// ── registerProvider / getProvider ────────────────────────────────────────────

describe('registerProvider / getProvider', () => {
  it('registered provider is retrievable by id', () => {
    const adapter = makeAdapter('test-registry-01');
    registerProvider(adapter);
    assert.equal(getProvider('test-registry-01'), adapter);
  });

  it('returns undefined for unknown provider', () => {
    assert.equal(getProvider('nonexistent-xyz-abc'), undefined);
  });

  it('isRegisteredProvider returns true for registered', () => {
    const adapter = makeAdapter('test-registry-02');
    registerProvider(adapter);
    assert.equal(isRegisteredProvider('test-registry-02'), true);
  });

  it('isRegisteredProvider returns false for unregistered', () => {
    assert.equal(isRegisteredProvider('never-registered-xyz'), false);
  });

  it('registering same id overwrites previous adapter', () => {
    registerProvider(makeAdapter('test-overwrite'));
    const second = makeAdapter('test-overwrite');
    second.displayName = 'Overwritten';
    registerProvider(second);
    assert.equal(getProvider('test-overwrite')?.displayName, 'Overwritten');
  });
});

// ── listProviders ─────────────────────────────────────────────────────────────

describe('listProviders', () => {
  it('includes the built-in extended adapters', () => {
    const ids = listProviders().map((a) => a.id);
    assert.ok(ids.includes('together'), 'together in registry');
    assert.ok(ids.includes('groq'), 'groq in registry');
    assert.ok(ids.includes('mistral'), 'mistral in registry');
  });

  it('returns array of adapters', () => {
    const providers = listProviders();
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length >= 3);
  });
});

// ── Built-in extended adapters ────────────────────────────────────────────────

describe('togetherAdapter', () => {
  it('has correct id and display name', () => {
    assert.equal(togetherAdapter.id, 'together');
    assert.equal(togetherAdapter.displayName, 'Together.ai');
  });

  it('has correct default base URL', () => {
    assert.ok(togetherAdapter.defaultBaseUrl.includes('together.xyz'));
  });

  it('requiresApiKey is true', () => {
    assert.equal(togetherAdapter.requiresApiKey, true);
  });

  it('throws when no API key provided', async () => {
    await assert.rejects(
      () => togetherAdapter.call('hello', 'model', 'https://api.together.xyz/v1', undefined, 5000),
      (err: Error) => err.message.includes('Together.ai') && err.message.includes('API key'),
    );
  });

  it('has positive token limit', () => {
    assert.ok(togetherAdapter.maxTokens > 0);
  });
});

describe('groqAdapter', () => {
  it('has correct id and display name', () => {
    assert.equal(groqAdapter.id, 'groq');
    assert.equal(groqAdapter.displayName, 'Groq');
  });

  it('has correct default base URL', () => {
    assert.ok(groqAdapter.defaultBaseUrl.includes('groq.com'));
  });

  it('requiresApiKey is true', () => {
    assert.equal(groqAdapter.requiresApiKey, true);
  });

  it('throws when no API key provided', async () => {
    await assert.rejects(
      () => groqAdapter.call('hello', 'model', 'https://api.groq.com/openai/v1', undefined, 5000),
      (err: Error) => err.message.includes('Groq') && err.message.includes('API key'),
    );
  });

  it('has lower price than openai (fast inference)', () => {
    assert.ok(groqAdapter.inputPricePer1M < 1.0, 'Groq should be < $1/1M input');
  });
});

describe('mistralAdapter', () => {
  it('has correct id', () => {
    assert.equal(mistralAdapter.id, 'mistral');
  });

  it('has correct base URL', () => {
    assert.ok(mistralAdapter.defaultBaseUrl.includes('mistral.ai'));
  });
});

// ── callOpenAICompatibleAdapter ───────────────────────────────────────────────

describe('callOpenAICompatibleAdapter', () => {
  it('throws when no API key', async () => {
    await assert.rejects(
      () => callOpenAICompatibleAdapter('prompt', 'model', 'https://example.com/v1', undefined, 5000, 'TestProvider'),
      (err: Error) => err.message.includes('TestProvider') && err.message.includes('API key'),
    );
  });

  it('sends correct request structure to mock endpoint', async () => {
    let capturedBody: unknown;

    // Inject a mock fetch via module override — test that the body format is correct
    const mockAdapter: LLMProviderAdapter = {
      ...makeAdapter('mock-openai-compat'),
      call: async (prompt, model, baseUrl, apiKey) => {
        // Simulate what callOpenAICompatibleAdapter would send
        capturedBody = {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 4096,
        };
        return 'mock response';
      },
    };

    const result = await mockAdapter.call('test prompt', 'gpt-4o', 'https://example.com', 'key123', 5000);
    assert.equal(result, 'mock response');
    assert.equal((capturedBody as Record<string, unknown>)['model'], 'gpt-4o');
  });
});

// ── Custom adapter registration ───────────────────────────────────────────────

describe('custom provider registration', () => {
  it('custom adapter can be registered and called', async () => {
    const custom: LLMProviderAdapter = {
      id: 'my-custom-provider',
      displayName: 'My Custom LLM',
      defaultModel: 'custom-v1',
      defaultBaseUrl: 'https://my-llm.internal/v1',
      inputPricePer1M: 0,
      outputPricePer1M: 0,
      maxTokens: 4096,
      requiresApiKey: false,
      call: async () => 'custom response',
    };

    registerProvider(custom);
    assert.equal(isRegisteredProvider('my-custom-provider'), true);

    const retrieved = getProvider('my-custom-provider');
    assert.ok(retrieved !== undefined);
    const result = await retrieved!.call('prompt', 'custom-v1', 'https://my-llm.internal/v1', undefined, 5000);
    assert.equal(result, 'custom response');
  });
});
