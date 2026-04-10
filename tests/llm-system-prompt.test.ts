// llm-system-prompt.test.ts — tests for systemPrompt threading in v0.17.0
// Uses _fetch injection seam to capture request bodies without real HTTP calls
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callLLM } from '../src/core/llm.js';

const FAKE_OPENAI_RESPONSE = JSON.stringify({
  choices: [{ message: { content: 'test response' } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
});

const FAKE_CLAUDE_RESPONSE = JSON.stringify({
  content: [{ type: 'text', text: 'test response' }],
  usage: { input_tokens: 10, output_tokens: 20 },
});

const FAKE_GEMINI_RESPONSE = JSON.stringify({
  candidates: [{ content: { parts: [{ text: 'test response' }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
});

const FAKE_OLLAMA_RESPONSE = JSON.stringify({
  message: { content: 'test response' },
  prompt_eval_count: 10,
  eval_count: 20,
});

function makeFetch(fakeBody: string, status = 200): typeof globalThis.fetch {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    const captured = init?.body as string | undefined;
    return {
      ok: status < 400,
      status,
      json: async () => JSON.parse(fakeBody),
      text: async () => fakeBody,
      headers: new Headers({ 'content-type': 'application/json' }),
      _capturedBody: captured,
    } as unknown as Response;
  };
}

function makeCapturingFetch(fakeBody: string): { fetch: typeof globalThis.fetch; bodies: string[] } {
  const bodies: string[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    if (init?.body) bodies.push(init.body as string);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(fakeBody),
      text: async () => fakeBody,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response;
  };
  return { fetch, bodies };
}

describe('callLLM — systemPrompt option', () => {
  it('passes systemPrompt as system role message to OpenAI-compatible provider', async () => {
    const { fetch, bodies } = makeCapturingFetch(FAKE_OPENAI_RESPONSE);

    await callLLM('hello', 'openai' as import('../src/core/config.js').LLMProvider, {
      systemPrompt: 'You are a code editor.',
      _fetch: fetch,
    }).catch(() => { /* ignore api key errors */ });

    const body = bodies[0] ? JSON.parse(bodies[0]) : null;
    if (body?.messages) {
      const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
      assert.ok(systemMsg, 'OpenAI request should include a system role message');
      assert.equal(systemMsg.content, 'You are a code editor.');
    }
  });

  it('passes systemPrompt as top-level system field to Claude provider', async () => {
    const { fetch, bodies } = makeCapturingFetch(FAKE_CLAUDE_RESPONSE);

    await callLLM('hello', 'claude' as import('../src/core/config.js').LLMProvider, {
      systemPrompt: 'You are a code editor.',
      _fetch: fetch,
    }).catch(() => { /* ignore api key errors */ });

    const body = bodies[0] ? JSON.parse(bodies[0]) : null;
    if (body) {
      assert.equal(body.system, 'You are a code editor.', 'Claude body should have top-level system field');
      // Claude should NOT have system in messages array
      const msgRoles = (body.messages ?? []).map((m: { role: string }) => m.role);
      assert.ok(!msgRoles.includes('system'), 'Claude should not put system in messages array');
    }
  });

  it('passes systemPrompt as systemInstruction to Gemini provider', async () => {
    const { fetch, bodies } = makeCapturingFetch(FAKE_GEMINI_RESPONSE);

    await callLLM('hello', 'gemini' as import('../src/core/config.js').LLMProvider, {
      systemPrompt: 'You are a code editor.',
      _fetch: fetch,
    }).catch(() => { /* ignore api key errors */ });

    const body = bodies[0] ? JSON.parse(bodies[0]) : null;
    if (body?.systemInstruction) {
      const text = body.systemInstruction?.parts?.[0]?.text;
      assert.equal(text, 'You are a code editor.', 'Gemini body should have systemInstruction with correct text');
    }
  });

  it('passes systemPrompt as system role message to Ollama provider', async () => {
    const { fetch, bodies } = makeCapturingFetch(FAKE_OLLAMA_RESPONSE);

    await callLLM('hello', 'ollama' as import('../src/core/config.js').LLMProvider, {
      systemPrompt: 'You are a code editor.',
      _fetch: fetch,
    }).catch(() => { /* ignore api key errors */ });

    const body = bodies[0] ? JSON.parse(bodies[0]) : null;
    if (body?.messages) {
      const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
      assert.ok(systemMsg, 'Ollama request should include a system role message');
      assert.equal(systemMsg.content, 'You are a code editor.');
    }
  });

  it('sends no system field to OpenAI when systemPrompt is undefined', async () => {
    const { fetch, bodies } = makeCapturingFetch(FAKE_OPENAI_RESPONSE);

    await callLLM('hello', 'openai' as import('../src/core/config.js').LLMProvider, {
      _fetch: fetch,
    }).catch(() => { /* ignore */ });

    const body = bodies[0] ? JSON.parse(bodies[0]) : null;
    if (body?.messages) {
      const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
      assert.equal(systemMsg, undefined, 'No system message when systemPrompt is undefined');
    }
  });

  it('sends no system field to Claude when systemPrompt is undefined', async () => {
    const { fetch, bodies } = makeCapturingFetch(FAKE_CLAUDE_RESPONSE);

    await callLLM('hello', 'claude' as import('../src/core/config.js').LLMProvider, {
      _fetch: fetch,
    }).catch(() => { /* ignore */ });

    const body = bodies[0] ? JSON.parse(bodies[0]) : null;
    if (body) {
      assert.equal(body.system, undefined, 'Claude body should not have system field when undefined');
    }
  });

  it('sends no systemInstruction to Gemini when systemPrompt is undefined', async () => {
    const { fetch, bodies } = makeCapturingFetch(FAKE_GEMINI_RESPONSE);

    await callLLM('hello', 'gemini' as import('../src/core/config.js').LLMProvider, {
      _fetch: fetch,
    }).catch(() => { /* ignore */ });

    const body = bodies[0] ? JSON.parse(bodies[0]) : null;
    if (body) {
      assert.equal(body.systemInstruction, undefined, 'Gemini body should not have systemInstruction when undefined');
    }
  });

  it('sends no system message to Ollama when systemPrompt is undefined', async () => {
    const { fetch, bodies } = makeCapturingFetch(FAKE_OLLAMA_RESPONSE);

    await callLLM('hello', 'ollama' as import('../src/core/config.js').LLMProvider, {
      _fetch: fetch,
    }).catch(() => { /* ignore */ });

    const body = bodies[0] ? JSON.parse(bodies[0]) : null;
    if (body?.messages) {
      const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
      assert.equal(systemMsg, undefined, 'No system message when systemPrompt is undefined for Ollama');
    }
  });
});
