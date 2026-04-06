import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callLLMWithProgress, supportsStreaming } from '../src/core/llm-stream.js';

const tempRoots: string[] = [];

// Helper to create a mock ReadableStream from NDJSON lines
function makeNdJsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
}

// Helper to create mock SSE stream
function makeSseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event + '\n'));
      }
      controller.close();
    },
  });
}

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

describe('llm-stream real streaming', () => {
  it('supportsStreaming returns true for ollama and claude', () => {
    assert.strictEqual(supportsStreaming('ollama'), true);
    assert.strictEqual(supportsStreaming('claude'), true);
  });

  it('supportsStreaming returns false for grok, openai', () => {
    assert.strictEqual(supportsStreaming('grok'), false);
    assert.strictEqual(supportsStreaming('openai'), false);
  });

  it('callLLMWithProgress falls back to simulation for unsupported provider', async () => {
    const chunks: string[] = [];
    const result = await callLLMWithProgress(
      'hello',
      (c) => chunks.push(c),
      undefined,
      undefined,
      {
        _callLLM: async () => 'hello world response',
        _loadConfig: async () => ({ defaultProvider: 'grok', ollamaModel: 'llama3', providers: {} } as any),
        _fetchStream: async () => { throw new Error('should not call fetch'); },
      },
    );
    assert.ok(chunks.length > 0, 'Should have called onChunk');
    assert.strictEqual(result, 'hello world response');
  });

  it('streamOllama parses NDJSON done: false lines correctly', async () => {
    const chunks: string[] = [];
    const ndJsonLines = [
      JSON.stringify({ response: 'Hello', done: false }),
      JSON.stringify({ response: ' world', done: false }),
      JSON.stringify({ response: '', done: true }),
    ];

    const mockFetch = async (_url: string, _opts: unknown) => ({
      ok: true,
      body: makeNdJsonStream(ndJsonLines),
    });

    const result = await callLLMWithProgress(
      'hi',
      (c) => chunks.push(c),
      'ollama',
      undefined,
      {
        _fetchStream: mockFetch as unknown as typeof fetch,
        _loadConfig: async () => ({
          defaultProvider: 'ollama',
          ollamaModel: 'llama3',
          providers: { ollama: { baseUrl: 'http://localhost:11434', model: 'llama3' } },
        } as any),
      },
    );
    assert.ok(chunks.includes('Hello'));
    assert.ok(chunks.includes(' world'));
    assert.strictEqual(result, 'Hello world');
  });

  it('streamClaude parses SSE content_block_delta events', async () => {
    const chunks: string[] = [];
    const sseEvents = [
      'data: ' + JSON.stringify({ type: 'message_start', message: {} }),
      'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Claude' } }),
      'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' says hi' } }),
      'data: ' + JSON.stringify({ type: 'message_stop' }),
    ];

    const mockFetch = async (_url: string, _opts: unknown) => ({
      ok: true,
      body: makeSseStream(sseEvents),
    });

    const result = await callLLMWithProgress(
      'hi',
      (c) => chunks.push(c),
      'claude',
      undefined,
      {
        _fetchStream: mockFetch as unknown as typeof fetch,
        _loadConfig: async () => ({
          defaultProvider: 'claude',
          ollamaModel: 'llama3',
          providers: { claude: { apiKey: 'test-key', model: 'claude-haiku-4-5-20251001' } },
        } as any),
      },
    );
    assert.ok(chunks.includes('Claude'));
    assert.ok(chunks.includes(' says hi'));
    assert.strictEqual(result, 'Claude says hi');
  });

  it('streamClaude ignores message_start and ping events', async () => {
    const chunks: string[] = [];
    const sseEvents = [
      'data: ' + JSON.stringify({ type: 'ping' }),
      'data: ' + JSON.stringify({ type: 'message_start', message: {} }),
      'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'real' } }),
    ];

    const mockFetch = async (_url: string, _opts: unknown) => ({
      ok: true,
      body: makeSseStream(sseEvents),
    });

    const result = await callLLMWithProgress(
      'test',
      (c) => chunks.push(c),
      'claude',
      undefined,
      {
        _fetchStream: mockFetch as unknown as typeof fetch,
        _loadConfig: async () => ({
          defaultProvider: 'claude',
          ollamaModel: 'llama3',
          providers: { claude: { apiKey: 'test-key', model: 'claude-haiku-4-5-20251001' } },
        } as any),
      },
    );
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(result, 'real');
  });

  it('callLLMWithProgress calls onChunk at least once', async () => {
    const chunks: string[] = [];
    await callLLMWithProgress(
      'test',
      (c) => chunks.push(c),
      undefined,
      undefined,
      {
        _callLLM: async () => 'response text',
        _loadConfig: async () => ({ defaultProvider: 'grok', ollamaModel: 'llama3', providers: {} } as any),
      },
    );
    assert.ok(chunks.length > 0);
  });

  it('callLLMWithProgress returns full accumulated text', async () => {
    const result = await callLLMWithProgress(
      'test',
      () => {},
      undefined,
      undefined,
      {
        _callLLM: async () => 'full response text',
        _loadConfig: async () => ({ defaultProvider: 'grok', ollamaModel: 'llama3', providers: {} } as any),
      },
    );
    assert.strictEqual(result, 'full response text');
  });
});
