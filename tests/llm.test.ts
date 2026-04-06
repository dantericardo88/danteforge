import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import {
  isLLMAvailable,
  extractOpenAIUsage,
  extractClaudeUsage,
  extractGeminiUsage,
  extractOllamaUsage,
} from '../src/core/llm.js';
import type { LLMUsageMetadata } from '../src/core/llm.js';

describe('LLM module', () => {
  it('exports callLLM and isLLMAvailable', async () => {
    const mod = await import('../src/core/llm.js');
    assert.strictEqual(typeof mod.callLLM, 'function');
    assert.strictEqual(typeof mod.isLLMAvailable, 'function');
  });

  it('isLLMAvailable returns a boolean', async () => {
    const result = await isLLMAvailable();
    assert.strictEqual(typeof result, 'boolean');
  });

  it('uses fetch-based provider transports instead of optional SDK imports', async () => {
    const source = await fs.readFile('src/core/llm.ts', 'utf8');

    // fetchProviderJson uses _llmFetch (module-level, lazy resolution via ?? globalThis.fetch) — verify the pattern
    assert.match(source, /_llmFetch\s*\?\?/);
    assert.match(source, /globalThis\.fetch/); // lazy fallback in fetchProviderJson
    assert.doesNotMatch(source, /import\('openai'\)/);
    assert.doesNotMatch(source, /import\('@anthropic-ai\/sdk'\)/);
    assert.doesNotMatch(source, /import\('@google\/generative-ai'\)/);
    assert.doesNotMatch(source, /import\('ollama'\)/);
  });
});

// ---------------------------------------------------------------------------
// Token usage extraction — v0.9.0 hardening Wave E
// ---------------------------------------------------------------------------

describe('extractOpenAIUsage', () => {
  it('extracts usage from OpenAI-shaped response', () => {
    const payload = { usage: { prompt_tokens: 150, completion_tokens: 42 } };
    const result = extractOpenAIUsage(payload);
    assert.deepStrictEqual(result, { inputTokens: 150, outputTokens: 42 });
  });

  it('returns undefined for missing usage field', () => {
    assert.strictEqual(extractOpenAIUsage({}), undefined);
    assert.strictEqual(extractOpenAIUsage(null), undefined);
    assert.strictEqual(extractOpenAIUsage(undefined), undefined);
  });

  it('returns undefined when both counts are zero', () => {
    const payload = { usage: { prompt_tokens: 0, completion_tokens: 0 } };
    assert.strictEqual(extractOpenAIUsage(payload), undefined);
  });
});

describe('extractClaudeUsage', () => {
  it('extracts usage from Claude-shaped response', () => {
    const payload = { usage: { input_tokens: 200, output_tokens: 80 } };
    const result = extractClaudeUsage(payload);
    assert.deepStrictEqual(result, { inputTokens: 200, outputTokens: 80 });
  });

  it('returns undefined for missing usage field', () => {
    assert.strictEqual(extractClaudeUsage({}), undefined);
    assert.strictEqual(extractClaudeUsage(null), undefined);
  });

  it('returns undefined when both counts are zero', () => {
    const payload = { usage: { input_tokens: 0, output_tokens: 0 } };
    assert.strictEqual(extractClaudeUsage(payload), undefined);
  });
});

describe('extractGeminiUsage', () => {
  it('extracts usage from Gemini-shaped response', () => {
    const payload = { usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 120 } };
    const result = extractGeminiUsage(payload);
    assert.deepStrictEqual(result, { inputTokens: 300, outputTokens: 120 });
  });

  it('returns undefined for missing usageMetadata', () => {
    assert.strictEqual(extractGeminiUsage({}), undefined);
    assert.strictEqual(extractGeminiUsage(null), undefined);
  });

  it('returns undefined when both counts are zero', () => {
    const payload = { usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } };
    assert.strictEqual(extractGeminiUsage(payload), undefined);
  });
});

describe('extractOllamaUsage', () => {
  it('extracts usage from Ollama-shaped response', () => {
    const payload = { prompt_eval_count: 500, eval_count: 200 };
    const result = extractOllamaUsage(payload);
    assert.deepStrictEqual(result, { inputTokens: 500, outputTokens: 200 });
  });

  it('returns undefined for missing fields', () => {
    assert.strictEqual(extractOllamaUsage({}), undefined);
    assert.strictEqual(extractOllamaUsage(null), undefined);
  });

  it('returns undefined when both counts are zero', () => {
    const payload = { prompt_eval_count: 0, eval_count: 0 };
    assert.strictEqual(extractOllamaUsage(payload), undefined);
  });
});

describe('LLMUsageMetadata type contract', () => {
  it('usage extraction functions all return same shape', () => {
    const openai = extractOpenAIUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const claude = extractClaudeUsage({ usage: { input_tokens: 10, output_tokens: 5 } });
    const gemini = extractGeminiUsage({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
    const ollama = extractOllamaUsage({ prompt_eval_count: 10, eval_count: 5 });

    for (const result of [openai, claude, gemini, ollama]) {
      assert.ok(result, 'extraction should return a result');
      assert.strictEqual(typeof result!.inputTokens, 'number');
      assert.strictEqual(typeof result!.outputTokens, 'number');
      assert.strictEqual(result!.inputTokens, 10);
      assert.strictEqual(result!.outputTokens, 5);
    }
  });

  it('exports LLMUsageMetadata and onUsage callback in CallLLMOptions', async () => {
    // Definitions moved to llm-pipeline.ts; llm.ts re-exports via `export type { ... }`
    const pipelineSource = await fs.readFile('src/core/llm-pipeline.ts', 'utf8');
    assert.match(pipelineSource, /export interface LLMUsageMetadata/);
    assert.match(pipelineSource, /onUsage\?\s*:\s*\(usage:\s*LLMUsageMetadata\)/);
    const llmSource = await fs.readFile('src/core/llm.ts', 'utf8');
    assert.match(llmSource, /export type\s*\{[^}]*LLMUsageMetadata/);
  });
});
