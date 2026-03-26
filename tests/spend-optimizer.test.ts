import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('spend optimizer', () => {
  it('chooseRecommendedOllamaModel prefers coder-oriented local models', async () => {
    const { chooseRecommendedOllamaModel } = await import('../src/core/spend-optimizer.js');

    const selected = chooseRecommendedOllamaModel([
      'gemma2:9b',
      'qwen2.5-coder:latest',
      'llama3.1:8b',
    ]);

    assert.equal(selected, 'qwen2.5-coder:latest');
  });

  it('configureSpendOptimizedDefaults configures local ollama when no explicit cloud default exists', async () => {
    const { configureSpendOptimizedDefaults } = await import('../src/core/spend-optimizer.js');

    let savedConfig = null;
    const result = await configureSpendOptimizedDefaults({
      hostOverride: 'codex',
      loadConfig: async () => ({
        defaultProvider: 'ollama',
        ollamaModel: 'llama3',
        providers: {},
      }),
      saveConfig: async (config) => {
        savedConfig = config;
      },
      inspectOllama: async () => ({
        available: true,
        installedModels: ['qwen2.5-coder:latest', 'gemma2:9b'],
      }),
    });

    assert.equal(result.status, 'configured-local');
    assert.equal(result.host, 'codex');
    assert.equal(result.hostUsesNativeModel, true);
    assert.equal(result.selectedProvider, 'ollama');
    assert.equal(result.selectedModel, 'qwen2.5-coder:latest');
    assert.ok(savedConfig, 'expected saveConfig to be called');
    assert.equal(savedConfig.defaultProvider, 'ollama');
    assert.equal(savedConfig.ollamaModel, 'qwen2.5-coder:latest');
    assert.equal(savedConfig.providers.ollama?.model, 'qwen2.5-coder:latest');
  });

  it('configureSpendOptimizedDefaults preserves explicit hosted defaults unless forced', async () => {
    const { configureSpendOptimizedDefaults } = await import('../src/core/spend-optimizer.js');

    let saveCalls = 0;
    const result = await configureSpendOptimizedDefaults({
      hostOverride: 'claude-code',
      loadConfig: async () => ({
        defaultProvider: 'openai',
        ollamaModel: 'llama3',
        providers: {
          openai: { apiKey: 'sk-test', model: 'gpt-4o' },
        },
      }),
      saveConfig: async () => {
        saveCalls += 1;
      },
      inspectOllama: async () => ({
        available: true,
        installedModels: ['qwen2.5-coder:7b'],
      }),
    });

    assert.equal(result.status, 'kept-existing-cloud');
    assert.equal(result.selectedProvider, 'openai');
    assert.equal(result.selectedModel, 'gpt-4o');
    assert.equal(saveCalls, 0);
    assert.match(result.message, /preserved existing default provider/i);
  });

  it('chooseSpendOptimizedProviderForReview prefers local ollama when the probe succeeds', async () => {
    const { chooseSpendOptimizedProviderForReview } = await import('../src/core/spend-optimizer.js');

    const provider = await chooseSpendOptimizedProviderForReview(async selected => ({
      ok: selected === 'ollama',
    }));

    assert.equal(provider, 'ollama');
  });

  it('configureSpendOptimizedDefaults gives a clear next step when ollama is unavailable', async () => {
    const { configureSpendOptimizedDefaults } = await import('../src/core/spend-optimizer.js');

    const result = await configureSpendOptimizedDefaults({
      hostOverride: 'unknown',
      loadConfig: async () => ({
        defaultProvider: 'ollama',
        ollamaModel: 'qwen2.5-coder:7b',
        providers: {},
      }),
      inspectOllama: async () => ({
        available: false,
        installedModels: [],
        detail: 'Ollama binary was not found on PATH.',
      }),
    });

    assert.equal(result.status, 'ollama-missing');
    assert.match(result.message, /No usable local Ollama model is configured yet/i);
    assert.match(result.nextSteps.join('\n'), /Install Ollama from https:\/\/ollama\.com\/download/i);
  });
});
