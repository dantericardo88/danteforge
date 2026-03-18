import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { isLLMAvailable } from '../src/core/llm.js';

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

    assert.match(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /import\('openai'\)/);
    assert.doesNotMatch(source, /import\('@anthropic-ai\/sdk'\)/);
    assert.doesNotMatch(source, /import\('@google\/generative-ai'\)/);
    assert.doesNotMatch(source, /import\('ollama'\)/);
  });
});
