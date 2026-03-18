import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  callLLM,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS,
  isLLMAvailable,
  probeLLMProvider,
  resolveProviderRequestTimeoutMs,
} from '../src/core/llm.js';

const tempRoots: string[] = [];

function makeJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe('Ollama model resolution', () => {
  let originalHome: string | undefined;
  let originalFetch: typeof global.fetch | undefined;
  let workspaceRoot: string;
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-ollama-test-'));
    cwd = path.join(workspaceRoot, 'project');
    home = path.join(workspaceRoot, 'home');

    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(path.join(home, '.danteforge'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.danteforge', 'config.yaml'),
      [
        'defaultProvider: ollama',
        'ollamaModel: llama3',
        'providers: {}',
        '',
      ].join('\n'),
      'utf8',
    );

    tempRoots.push(workspaceRoot);
    originalHome = process.env.DANTEFORGE_HOME;
    process.env.DANTEFORGE_HOME = home;
    originalFetch = global.fetch;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.DANTEFORGE_HOME;
    } else {
      process.env.DANTEFORGE_HOME = originalHome;
    }
    if (originalFetch) {
      global.fetch = originalFetch;
    }
  });

  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  });

  it('resolves a unique tagged Ollama model before direct chat calls', async () => {
    let chatModel = '';

    global.fetch = async (url, init) => {
      const href = String(url);
      if (href.endsWith('/api/tags')) {
        return makeJsonResponse({
          models: [{ name: 'llama3:latest', model: 'llama3:latest' }],
        });
      }
      if (href.endsWith('/api/chat')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
        chatModel = body.model ?? '';
        return makeJsonResponse({ message: { content: 'DanteForge' } });
      }
      throw new Error(`Unexpected fetch url: ${href}`);
    };

    const available = await isLLMAvailable();
    const response = await callLLM('Reply with DanteForge', undefined, { cwd });

    assert.strictEqual(available, true);
    assert.strictEqual(response, 'DanteForge');
    assert.strictEqual(chatModel, 'llama3:latest');
  });

  it('treats ambiguous Ollama base aliases as unavailable until the exact tag is configured', async () => {
    global.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith('/api/tags')) {
        return makeJsonResponse({
          models: [
            { name: 'llama3:8b', model: 'llama3:8b' },
            { name: 'llama3:70b', model: 'llama3:70b' },
          ],
        });
      }
      throw new Error(`Unexpected fetch url: ${href}`);
    };

    const probe = await probeLLMProvider();

    assert.strictEqual(probe.ok, false);
    assert.match(probe.message, /exact ollama model|multiple ollama models/i);
  });

  it('uses longer default request timeouts for Ollama and allows overrides', () => {
    assert.strictEqual(resolveProviderRequestTimeoutMs('openai', {}), DEFAULT_LLM_REQUEST_TIMEOUT_MS);
    assert.strictEqual(resolveProviderRequestTimeoutMs('ollama', {}), DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS);
    assert.strictEqual(
      resolveProviderRequestTimeoutMs('gemini', { DANTEFORGE_LLM_TIMEOUT_MS: '45000' }),
      45_000,
    );
    assert.strictEqual(
      resolveProviderRequestTimeoutMs(
        'ollama',
        {
          DANTEFORGE_LLM_TIMEOUT_MS: '45000',
          OLLAMA_TIMEOUT_MS: '125000',
        } as NodeJS.ProcessEnv,
      ),
      125_000,
    );
  });
});
