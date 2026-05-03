import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { callLLM, isRetryableError } from '../src/core/llm.js';

test('Pass 49 — provider request timeout messages are retryable', () => {
  assert.equal(
    isRetryableError(new Error('Anthropic Claude request timed out after 120000ms.')),
    true,
  );
});

test('Pass 49 - provider empty-response messages are retryable', () => {
  assert.equal(
    isRetryableError(new Error('Anthropic Claude returned an empty response.')),
    true,
  );
});

test('Pass 49 - provider max tokens can be raised for long live transforms', async () => {
  const previousKey = process.env.DANTEFORGE_CLAUDE_API_KEY;
  const previousMaxTokens = process.env.DANTEFORGE_LLM_MAX_TOKENS;
  process.env.DANTEFORGE_CLAUDE_API_KEY = 'test-key';
  process.env.DANTEFORGE_LLM_MAX_TOKENS = '8192';

  let body: unknown;
  try {
    const result = await callLLM('transform this document', 'claude', {
      cwd: process.cwd(),
      recordMemory: false,
      _retryDelays: [],
      _fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body ?? '{}'));
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }), { status: 200 });
      },
    });

    assert.equal(result, 'ok');
    assert.equal((body as { max_tokens?: number }).max_tokens, 8192);
  } finally {
    if (previousKey === undefined) {
      delete process.env.DANTEFORGE_CLAUDE_API_KEY;
    } else {
      process.env.DANTEFORGE_CLAUDE_API_KEY = previousKey;
    }
    if (previousMaxTokens === undefined) {
      delete process.env.DANTEFORGE_LLM_MAX_TOKENS;
    } else {
      process.env.DANTEFORGE_LLM_MAX_TOKENS = previousMaxTokens;
    }
  }
});
