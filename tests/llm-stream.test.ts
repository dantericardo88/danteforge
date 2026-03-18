import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callLLMWithProgress } from '../src/core/llm-stream.js';

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

describe('LLM streaming wrapper', () => {
  let originalHome: string | undefined;
  let originalFetch: typeof global.fetch | undefined;
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-llm-stream-'));
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
            summary: 'Prefer fail-closed workflow checks',
            detail: 'Prior correction',
            tags: ['workflow', 'fail-closed'],
            relatedCommands: ['verify'],
            tokenCount: 12,
          },
        ],
      }, null, 2),
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

  it('forwards llm options through the streaming wrapper', async () => {
    let capturedPrompt = '';
    const chunks: string[] = [];

    global.fetch = async (url, init) => {
      if (String(url).endsWith('/models')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: [{ id: 'gpt-4o' }],
          }),
        } as Response;
      }

      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content?: string }> };
      capturedPrompt = body.messages?.[0]?.content ?? '';
      return makeOpenAIResponse('streamed response');
    };

    const response = await callLLMWithProgress(
      'Verify the release candidate',
      chunk => chunks.push(chunk),
      undefined,
      { enrichContext: true, cwd },
    );

    assert.strictEqual(response, 'streamed response');
    assert.ok(chunks.length > 0);
    assert.strictEqual(chunks.join(''), 'streamed response');
    assert.match(capturedPrompt, /Prior Context \(auto-injected\)/);
    assert.match(capturedPrompt, /Prefer fail-closed workflow checks/);
  });
});
