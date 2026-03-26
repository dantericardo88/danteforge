// Integration tests for callLLM with _fetch injection — exercises the full
// callLLM → provider → fetchProviderJson → _fetch chain without real API calls.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';

import { callLLM, setLLMFetch, resetLLMFetch } from '../src/core/llm.js';
import type { CallLLMOptions, LLMUsageMetadata } from '../src/core/llm.js';
import { saveState } from '../src/core/state.js';
import type { DanteState } from '../src/core/state.js';
import { resetAllCircuits } from '../src/core/circuit-breaker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
let originalDanteforgeHome: string | undefined;

/** Create a temp project dir with valid DanteForge state */
async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-llm-fetch-'));
  tempDirs.push(dir);
  const stateDir = path.join(dir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(stateDir, 'reports'), { recursive: true });
  await fs.mkdir(path.join(stateDir, 'scores'), { recursive: true });

  const state: DanteState = {
    project: 'llm-fetch-test',
    created: new Date().toISOString(),
    workflowStage: 'initialized' as DanteState['workflowStage'],
    currentPhase: 'phase-1',
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    gateResults: {},
    auditLog: [],
  } as DanteState;
  await saveState(state, { cwd: dir });
  return dir;
}

/** Create a temp config dir with provider config */
async function createTempConfig(provider: string, apiKey: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-config-'));
  tempDirs.push(dir);
  const configDir = path.join(dir, '.danteforge');
  await fs.mkdir(configDir, { recursive: true });
  const config = {
    defaultProvider: provider,
    ollamaModel: 'llama3',
    providers: {
      [provider]: {
        apiKey,
        model: provider === 'ollama' ? 'llama3' : 'test-model',
        baseUrl: 'http://localhost:9999',
      },
    },
  };
  await fs.writeFile(path.join(configDir, 'config.yaml'), yaml.stringify(config));
  return dir;
}

/** Build a mock fetch that returns provider-shaped responses */
function makeMockFetch(
  provider: 'openai' | 'claude' | 'gemini' | 'ollama',
  responseText: string,
  usage?: { input: number; output: number },
): typeof globalThis.fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Ollama model listing
    if (url.includes('/api/tags')) {
      return new Response(JSON.stringify({
        models: [{ name: 'llama3', model: 'llama3' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    let body: unknown;
    switch (provider) {
      case 'openai':
        body = {
          choices: [{ message: { content: responseText } }],
          usage: usage ? { prompt_tokens: usage.input, completion_tokens: usage.output } : undefined,
        };
        break;
      case 'claude':
        body = {
          content: [{ type: 'text', text: responseText }],
          usage: usage ? { input_tokens: usage.input, output_tokens: usage.output } : undefined,
        };
        break;
      case 'gemini':
        body = {
          candidates: [{ content: { parts: [{ text: responseText }] } }],
          usageMetadata: usage ? { promptTokenCount: usage.input, candidatesTokenCount: usage.output } : undefined,
        };
        break;
      case 'ollama':
        body = {
          message: { content: responseText },
          prompt_eval_count: usage?.input,
          eval_count: usage?.output,
        };
        break;
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('callLLM _fetch integration', () => {
  let projectDir: string;

  before(async () => {
    resetAllCircuits();
    projectDir = await createTempProject();
    originalDanteforgeHome = process.env.DANTEFORGE_HOME;
  });

  beforeEach(() => { resetAllCircuits(); });

  after(async () => {
    resetAllCircuits();
    // Restore original env
    if (originalDanteforgeHome !== undefined) {
      process.env.DANTEFORGE_HOME = originalDanteforgeHome;
    } else {
      delete process.env.DANTEFORGE_HOME;
    }
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('callLLM with _fetch returns OpenAI provider text', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    const mockFetch = makeMockFetch('openai', 'Hello from OpenAI mock');
    const result = await callLLM('test prompt', 'openai', {
      _fetch: mockFetch,
      cwd: projectDir,
      recordMemory: false,
    });

    assert.equal(result, 'Hello from OpenAI mock');
  });

  it('callLLM with _fetch invokes onUsage callback', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    const usageReports: LLMUsageMetadata[] = [];
    const mockFetch = makeMockFetch('openai', 'response', { input: 50, output: 100 });

    await callLLM('test prompt', 'openai', {
      _fetch: mockFetch,
      cwd: projectDir,
      recordMemory: false,
      onUsage: (usage) => usageReports.push(usage),
    });

    assert.equal(usageReports.length, 1);
    assert.equal(usageReports[0].inputTokens, 50);
    assert.equal(usageReports[0].outputTokens, 100);
    assert.equal(usageReports[0].provider, 'openai');
    assert.ok(usageReports[0].costUsd >= 0);
  });

  it('callLLM with _fetch auto-updates budgetFence', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    const fence = {
      agentRole: 'test-agent',
      maxBudgetUsd: 10.0,
      currentSpendUsd: 0,
      isExceeded: false,
      warningThresholdPercent: 80,
    };

    const mockFetch = makeMockFetch('openai', 'response', { input: 100, output: 200 });

    await callLLM('test prompt', 'openai', {
      _fetch: mockFetch,
      cwd: projectDir,
      recordMemory: false,
      budgetFence: fence,
    });

    assert.ok(fence.currentSpendUsd > 0, 'budget should be updated after call');
  });

  it('callLLM with _fetch for Claude provider', async () => {
    const configDir = await createTempConfig('claude', 'fake-claude-key');
    process.env.DANTEFORGE_HOME = configDir;

    const mockFetch = makeMockFetch('claude', 'Hello from Claude mock');
    const result = await callLLM('test prompt', 'claude', {
      _fetch: mockFetch,
      cwd: projectDir,
      recordMemory: false,
    });

    assert.equal(result, 'Hello from Claude mock');
  });

  it('callLLM with _fetch for Gemini provider', async () => {
    const configDir = await createTempConfig('gemini', 'fake-gemini-key');
    process.env.DANTEFORGE_HOME = configDir;

    const mockFetch = makeMockFetch('gemini', 'Hello from Gemini mock');
    const result = await callLLM('test prompt', 'gemini', {
      _fetch: mockFetch,
      cwd: projectDir,
      recordMemory: false,
    });

    assert.equal(result, 'Hello from Gemini mock');
  });

  it('callLLM with _fetch for Ollama provider', async () => {
    const configDir = await createTempConfig('ollama', '');
    process.env.DANTEFORGE_HOME = configDir;

    const mockFetch = makeMockFetch('ollama', 'Hello from Ollama mock');
    const result = await callLLM('test prompt', 'ollama', {
      _fetch: mockFetch,
      cwd: projectDir,
      recordMemory: false,
    });

    assert.equal(result, 'Hello from Ollama mock');
  });

  it('callLLM with _fetch handles HTTP error', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    const errorFetch: typeof globalThis.fetch = async () => {
      return new Response('Internal Server Error', { status: 500 });
    };

    await assert.rejects(
      () => callLLM('test prompt', 'openai', {
        _fetch: errorFetch,
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(err.message.includes('500') || err.message.includes('unavailable'));
        return true;
      },
    );
  });

  it('callLLM with _fetch handles network failure', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    const failFetch: typeof globalThis.fetch = async () => {
      throw new Error('Network error: connection refused');
    };

    await assert.rejects(
      () => callLLM('test prompt', 'openai', {
        _fetch: failFetch,
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(err.message.includes('Network error'));
        return true;
      },
    );
  });

  it('callLLM with _fetch respects budget fence exceeded', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    let fetchCalled = false;
    const spyFetch: typeof globalThis.fetch = async (...args) => {
      fetchCalled = true;
      return makeMockFetch('openai', 'should not reach')(...args);
    };

    const fence = {
      agentRole: 'test-agent',
      maxBudgetUsd: 1.0,
      currentSpendUsd: 1.5, // Already exceeded
      isExceeded: true,
      warningThresholdPercent: 80,
    };

    await assert.rejects(
      () => callLLM('test prompt', 'openai', {
        _fetch: spyFetch,
        cwd: projectDir,
        recordMemory: false,
        budgetFence: fence,
      }),
      (err: Error) => {
        assert.ok(err.message.includes('Budget fence exceeded'));
        return true;
      },
    );

    assert.equal(fetchCalled, false, '_fetch should not be called when budget exceeded');
  });

  it('callLLM with _fetch retries on transient failure then succeeds', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    let attempt = 0;
    const retryFetch: typeof globalThis.fetch = async (input, init) => {
      attempt++;
      if (attempt === 1) {
        return new Response('Service Unavailable', { status: 503 });
      }
      return makeMockFetch('openai', 'retry success')(input as string, init);
    };

    const result = await callLLM('test prompt', 'openai', {
      _fetch: retryFetch,
      cwd: projectDir,
      recordMemory: false,
    });

    assert.equal(result, 'retry success');
    assert.ok(attempt >= 2, 'should have retried at least once');
  });

  it('CallLLMOptions._fetch is optional (backward compat)', async () => {
    // Verify the type allows omitting _fetch
    const opts: CallLLMOptions = { recordMemory: false };
    assert.equal(opts._fetch, undefined);
  });

  it('setLLMFetch/resetLLMFetch affects callLLM without _fetch option', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    const mockFetch = makeMockFetch('openai', 'via setLLMFetch');
    setLLMFetch(mockFetch);
    try {
      const result = await callLLM('test prompt', 'openai', {
        cwd: projectDir,
        recordMemory: false,
      });
      assert.equal(result, 'via setLLMFetch');
    } finally {
      resetLLMFetch();
    }
  });

  it('_llmFetch is cleaned up after callLLM with _fetch option', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-123');
    process.env.DANTEFORGE_HOME = configDir;

    const mockFetch = makeMockFetch('openai', 'from _fetch option');
    // Call with _fetch option
    const result = await callLLM('test prompt', 'openai', {
      _fetch: mockFetch,
      cwd: projectDir,
      recordMemory: false,
    });
    assert.equal(result, 'from _fetch option');

    // After callLLM returns, the module-level fetch should be restored
    // We can verify by using setLLMFetch with a different mock
    const secondMock = makeMockFetch('openai', 'second mock');
    setLLMFetch(secondMock);
    try {
      const result2 = await callLLM('test', 'openai', {
        cwd: projectDir,
        recordMemory: false,
      });
      assert.equal(result2, 'second mock', 'module-level fetch should be restored after _fetch usage');
    } finally {
      resetLLMFetch();
    }
  });

  it('callLLM with _fetch reports usage for all 4 providers', async () => {
    // Test that usage metadata flows correctly through onUsage for each provider shape
    const providers = ['openai', 'claude', 'gemini', 'ollama'] as const;

    for (const provider of providers) {
      resetAllCircuits(); // Reset between providers to avoid circuit breaker cross-contamination
      const configDir = await createTempConfig(provider, provider === 'ollama' ? '' : `fake-${provider}-key`);
      process.env.DANTEFORGE_HOME = configDir;

      const reports: LLMUsageMetadata[] = [];
      const mockFetch = makeMockFetch(provider, `${provider} response`, { input: 10, output: 20 });

      await callLLM('test', provider, {
        _fetch: mockFetch,
        cwd: projectDir,
        recordMemory: false,
        onUsage: (u) => reports.push(u),
      });

      assert.equal(reports.length, 1, `${provider} should report usage`);
      assert.equal(reports[0].provider, provider);
      assert.ok(reports[0].inputTokens >= 0, `${provider} inputTokens`);
      assert.ok(reports[0].outputTokens >= 0, `${provider} outputTokens`);
    }
  });
});
