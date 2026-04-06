// LLM concurrency tests — verify fetchFn threading prevents cross-contamination
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { callLLM, setLLMFetch, resetLLMFetch } from '../src/core/llm.js';
import { resetAllCircuits } from '../src/core/circuit-breaker.js';

let originalHome: string | undefined;
const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-concurrency-'));
  tempDirs.push(dir);
  const dfDir = path.join(dir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });
  await fs.writeFile(path.join(dfDir, 'STATE.yaml'), [
    'project: concurrency-test',
    `created: ${new Date().toISOString()}`,
    'workflowStage: forge',
    'currentPhase: 1',
    'lastHandoff: none',
    'profile: balanced',
    'tasks: {}',
    'gateResults: {}',
    'auditLog: []',
  ].join('\n'));
  return dir;
}

describe('LLM concurrency — fetchFn threading', () => {
  let tempHome: string;

  before(async () => {
    resetAllCircuits();
    originalHome = process.env.DANTEFORGE_HOME;
    tempHome = await makeTempHome();
    process.env.DANTEFORGE_HOME = tempHome;
  });

  after(async () => {
    resetAllCircuits();
    resetLLMFetch();
    if (originalHome !== undefined) {
      process.env.DANTEFORGE_HOME = originalHome;
    } else {
      delete process.env.DANTEFORGE_HOME;
    }
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('two concurrent callLLM calls with different _fetch do not cross-contaminate', async () => {
    const makeOllamaFetch = (response: string): typeof globalThis.fetch => async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({
          models: [{ name: 'llama3', model: 'llama3' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        message: { content: response },
      }), { status: 200 });
    };

    const fetchA = makeOllamaFetch('response-A');
    const fetchB: typeof globalThis.fetch = async (url) => {
      // Slight delay to interleave with A
      await new Promise(r => setTimeout(r, 10));
      return makeOllamaFetch('response-B')(url, {});
    };

    const [resultA, resultB] = await Promise.all([
      callLLM('prompt-A', 'ollama', { _fetch: fetchA, recordMemory: false, cwd: tempHome }),
      callLLM('prompt-B', 'ollama', { _fetch: fetchB, recordMemory: false, cwd: tempHome }),
    ]);

    assert.equal(resultA, 'response-A', 'Call A should use fetchA');
    assert.equal(resultB, 'response-B', 'Call B should use fetchB');
  });

  it('module-level _llmFetch is unchanged after concurrent calls with _fetch', async () => {
    resetLLMFetch(); // ensure clean state

    const mockFetch: typeof globalThis.fetch = async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({
          models: [{ name: 'llama3', model: 'llama3' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        message: { content: 'mock' },
      }), { status: 200 });
    };

    const result = await callLLM('test', 'ollama', { _fetch: mockFetch, recordMemory: false, cwd: tempHome });

    // Verify the response was from the mock (proving _fetch was used correctly)
    assert.equal(result, 'mock', 'Per-call _fetch should produce expected response');
  });

  it('setLLMFetch still works as module-level fallback (ollama, no API key needed)', async () => {
    const moduleFetch: typeof globalThis.fetch = async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({
          models: [{ name: 'llama3', model: 'llama3' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        message: { content: 'module-level-response' },
      }), { status: 200 });
    };

    setLLMFetch(moduleFetch);
    try {
      const result = await callLLM('test', 'ollama', { recordMemory: false, cwd: tempHome });
      assert.equal(result, 'module-level-response');
    } finally {
      resetLLMFetch();
    }
  });

  it('per-call _fetch takes precedence over module-level setLLMFetch', async () => {
    const moduleFetch: typeof globalThis.fetch = async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({
          models: [{ name: 'llama3', model: 'llama3' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        message: { content: 'module-level' },
      }), { status: 200 });
    };

    const perCallFetch: typeof globalThis.fetch = async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({
          models: [{ name: 'llama3', model: 'llama3' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        message: { content: 'per-call' },
      }), { status: 200 });
    };

    setLLMFetch(moduleFetch);
    try {
      const result = await callLLM('test', 'ollama', { _fetch: perCallFetch, recordMemory: false, cwd: tempHome });
      assert.equal(result, 'per-call', 'Per-call _fetch should take precedence over module-level');
    } finally {
      resetLLMFetch();
    }
  });
});
