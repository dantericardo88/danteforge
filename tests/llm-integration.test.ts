import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callLLM } from '../src/core/llm.js';
import { loadMemoryStore } from '../src/core/memory-store.js';

const tempRoots: string[] = [];

function makeOpenAIResponse(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content: text } }],
    }),
  } as Response;
}

describe('LLM integration', () => {
  let originalHome: string | undefined;
  let originalFetch: typeof global.fetch | undefined;
  let workspaceRoot: string;
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-llm-int-'));
    cwd = path.join(workspaceRoot, 'project');
    home = path.join(workspaceRoot, 'home');
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(path.join(home, '.danteforge'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.danteforge', 'config.yaml'),
      [
        'defaultProvider: openai',
        'providers:',
        '  openai:',
        '    apiKey: test-key',
        '    model: gpt-4o',
        '    baseUrl: https://example.test/v1',
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

  it('injects prior context into outgoing prompts when enrichContext is enabled', async () => {
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, '.danteforge', 'memory.json'),
      JSON.stringify({
        version: '1.0.0',
        entries: [
          {
            id: 'mem-1',
            timestamp: new Date().toISOString(),
            sessionId: 'sess-1',
            category: 'correction',
            summary: 'Always sanitize HTML',
            detail: 'Prior correction',
            tags: ['sanitize', 'html'],
            relatedCommands: ['forge'],
            tokenCount: 12,
          },
        ],
      }, null, 2),
      'utf8',
    );

    let capturedPrompt = '';
    global.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content?: string }> };
      capturedPrompt = body.messages?.[0]?.content ?? '';
      return makeOpenAIResponse('ok');
    };

    await (callLLM as unknown as (prompt: string, providerOverride?: unknown, options?: { enrichContext?: boolean; cwd?: string }) => Promise<string>)(
      'Build a safe login form',
      undefined,
      { enrichContext: true, cwd },
    );

    assert.match(capturedPrompt, /Prior Context \(auto-injected\)/);
    assert.match(capturedPrompt, /Always sanitize HTML/);
  });

  it('records successful llm responses to persistent memory by default', async () => {
    global.fetch = async () => makeOpenAIResponse('generated response');

    await (callLLM as unknown as (prompt: string, providerOverride?: unknown, options?: { cwd?: string }) => Promise<string>)(
      'Generate a plan',
      undefined,
      { cwd },
    );

    const store = await loadMemoryStore(cwd);
    assert.ok(store.entries.length > 0);
    assert.ok(store.entries.some(entry => entry.category === 'command' && /openai/i.test(entry.summary)));
  });
});
