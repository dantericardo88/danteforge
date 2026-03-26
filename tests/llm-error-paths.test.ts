// llm-error-paths.test.ts — tests for llm.ts error branches via _fetch injection
// Covers: normalizeProviderError (HTTP status codes), fetchProviderJson edge cases,
// per-provider empty response text, requireApiKey, unknown provider dispatch.
//
// All tests use the existing CallLLMOptions._fetch injection seam — no source changes.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';

import { callLLM } from '../src/core/llm.js';
import { saveState } from '../src/core/state.js';
import type { DanteState } from '../src/core/state.js';
import { resetAllCircuits } from '../src/core/circuit-breaker.js';

// ---------------------------------------------------------------------------
// Helpers (mirror of llm-fetch-integration.test.ts setup)
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
let originalDanteforgeHome: string | undefined;
let projectDir: string;

async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-llm-err-'));
  tempDirs.push(dir);
  const stateDir = path.join(dir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(stateDir, 'reports'), { recursive: true });
  await fs.mkdir(path.join(stateDir, 'scores'), { recursive: true });

  const state: DanteState = {
    project: 'llm-err-test',
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

async function createTempConfig(provider: string, apiKey: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cfg-err-'));
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  resetAllCircuits();
  projectDir = await createTempProject();
  originalDanteforgeHome = process.env.DANTEFORGE_HOME;
});

beforeEach(() => { resetAllCircuits(); });

after(async () => {
  resetAllCircuits();
  if (originalDanteforgeHome !== undefined) {
    process.env.DANTEFORGE_HOME = originalDanteforgeHome;
  } else {
    delete process.env.DANTEFORGE_HOME;
  }
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Group A: HTTP status codes → normalizeProviderError
// ---------------------------------------------------------------------------
// Non-retryable: 401, 403, 404 → rejected immediately
// Retryable: 408, 429, 502 → retried (MAX_RETRIES=2) then rejected; ~3s each

describe('normalizeProviderError — HTTP status codes', () => {
  it('HTTP 401 → rejects with auth failure message', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-401');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      });

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.includes('401') || err.message.toLowerCase().includes('auth'),
          `expected auth error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('HTTP 403 → rejects with auth failure message', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-403');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'content-type': 'application/json' },
      });

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.includes('403') || err.message.toLowerCase().includes('auth'),
          `expected auth/403 error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('HTTP 404 → rejects with model/endpoint not found message', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-404');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.includes('404') || err.message.toLowerCase().includes('not found'),
          `expected 404/not-found error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('HTTP 408 → rejects after retries (retryable timeout)', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-408');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response('Request Timeout', {
        status: 408, headers: { 'content-type': 'text/plain' },
      });

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.includes('408') || err.message.toLowerCase().includes('timed out') ||
          err.message.toLowerCase().includes('timeout'),
          `expected 408/timeout error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('HTTP 429 → rejects after retries (retryable rate limit)', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-429');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response('Too Many Requests', {
        status: 429, headers: { 'content-type': 'text/plain' },
      });

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.includes('429') || err.message.toLowerCase().includes('rate limit') ||
          err.message.toLowerCase().includes('circuit'),
          `expected 429/rate-limit error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('HTTP 502 → rejects after retries (retryable unavailable)', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-502');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response('Bad Gateway', {
        status: 502, headers: { 'content-type': 'text/plain' },
      });

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.includes('502') || err.message.toLowerCase().includes('unavailable') ||
          err.message.toLowerCase().includes('circuit'),
          `expected 502/unavailable error, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Group B: fetchProviderJson edge cases
// ---------------------------------------------------------------------------

describe('fetchProviderJson edge cases', () => {
  it('empty response body (status 200) → eventually rejects with empty response error', async () => {
    // fetchProviderJson returns {} for empty body; extractOpenAICompatibleText({}) = '' → LLM_EMPTY_RESPONSE
    const configDir = await createTempConfig('openai', 'fake-key-empty');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response('', { status: 200, headers: { 'content-type': 'application/json' } });

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes('empty'),
          `expected empty-response error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('invalid JSON body (status 200) → rejects with invalid JSON error', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-json');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response('not-valid{{json', { status: 200, headers: { 'content-type': 'application/json' } });

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes('json') || err.message.toLowerCase().includes('invalid'),
          `expected JSON parse error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('AbortError thrown by fetch → rejects with timeout error', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-abort');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () => {
      const err = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      throw err;
    };

    await assert.rejects(
      () => callLLM('test', 'openai', {
        _fetch: mock,
        _retryDelays: [0, 0],
        _sleep: async () => {},
        cwd: projectDir,
        recordMemory: false,
      }),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes('timed out') || err.message.toLowerCase().includes('timeout') ||
          err.message.toLowerCase().includes('abort'),
          `expected timeout/abort error, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Group C: Empty response text per provider
// ---------------------------------------------------------------------------

describe('empty response text per provider → LLM_EMPTY_RESPONSE', () => {
  it('openai: choices array absent → rejects with empty response', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-openai-empty');
    process.env.DANTEFORGE_HOME = configDir;

    // extractOpenAICompatibleText({ id: 'test' }) → choices undefined → not Array → returns ''
    const mock: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ id: 'test' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });

    await assert.rejects(
      () => callLLM('test', 'openai', { _fetch: mock, cwd: projectDir, recordMemory: false }),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes('empty'),
          `expected empty response error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('ollama: message content empty string → rejects with empty response', async () => {
    const configDir = await createTempConfig('ollama', '');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      // Satisfy the /api/tags model listing probe
      if (url.includes('/api/tags')) {
        return new Response(
          JSON.stringify({ models: [{ name: 'llama3', model: 'llama3' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // Main chat call: message with empty content
      return new Response(
        JSON.stringify({ message: { role: 'assistant', content: '' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await assert.rejects(
      () => callLLM('test', 'ollama', { _fetch: mock, cwd: projectDir, recordMemory: false }),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes('empty'),
          `expected empty response error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('claude: content array absent → rejects with empty response', async () => {
    const configDir = await createTempConfig('claude', 'fake-claude-key');
    process.env.DANTEFORGE_HOME = configDir;

    // extractClaudeText({ id: 'msg-1' }) → content undefined → not Array → returns ''
    const mock: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ id: 'msg-1', type: 'message' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });

    await assert.rejects(
      () => callLLM('test', 'claude', { _fetch: mock, cwd: projectDir, recordMemory: false }),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes('empty'),
          `expected empty response error, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('gemini: candidates array absent → rejects with empty response', async () => {
    const configDir = await createTempConfig('gemini', 'fake-gemini-key');
    process.env.DANTEFORGE_HOME = configDir;

    // extractGeminiText({ promptFeedback: {} }) → candidates undefined → not Array → returns ''
    const mock: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ promptFeedback: {} }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });

    await assert.rejects(
      () => callLLM('test', 'gemini', { _fetch: mock, cwd: projectDir, recordMemory: false }),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes('empty'),
          `expected empty response error, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Group D: Misc uncovered branches
// ---------------------------------------------------------------------------

describe('misc llm.ts uncovered paths', () => {
  it('unknown provider string → rejects with LLM_UNKNOWN_PROVIDER', async () => {
    const configDir = await createTempConfig('openai', 'fake-key-unknown');
    process.env.DANTEFORGE_HOME = configDir;

    await assert.rejects(
      () => callLLM('test', 'unknown-provider' as Parameters<typeof callLLM>[1], { cwd: projectDir, recordMemory: false }),
      (err: Error) => {
        assert.equal((err as Error & { code?: string }).code, 'LLM_UNKNOWN_PROVIDER');
        assert.match(err.message, /Unknown provider: unknown-provider/i);
        return true;
      },
    );
  });

  it('missing apiKey in provider config → rejects with CONFIG_MISSING_KEY error', async () => {
    // Config with no apiKey (empty string fails requireApiKey)
    const configDir = await createTempConfig('openai', '');
    process.env.DANTEFORGE_HOME = configDir;

    const mock: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });

    await assert.rejects(
      () => callLLM('test', 'openai', { _fetch: mock, cwd: projectDir, recordMemory: false }),
      (err: Error) => {
        assert.ok(
          err.message.toLowerCase().includes('api key') || err.message.toLowerCase().includes('key') ||
          err.message.toLowerCase().includes('config'),
          `expected missing-key error, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});
