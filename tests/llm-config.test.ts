import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LLM_RETRIES,
  LLM_RETRY_DELAYS_MS,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  AUDIT_STATE_CACHE_TTL_MS,
} from '../src/core/llm-config.js';

describe('llm-config constants', () => {
  it('all constants are positive numbers or arrays of positive numbers', () => {
    assert.ok(MAX_LLM_RETRIES > 0, 'MAX_LLM_RETRIES should be positive');
    assert.ok(Array.isArray(LLM_RETRY_DELAYS_MS), 'LLM_RETRY_DELAYS_MS should be an array');
    assert.ok(LLM_RETRY_DELAYS_MS.every(d => d > 0), 'All retry delays should be positive');
    assert.ok(DEFAULT_LLM_TIMEOUT_MS > 0, 'DEFAULT_LLM_TIMEOUT_MS should be positive');
    assert.ok(DEFAULT_OLLAMA_TIMEOUT_MS > 0, 'DEFAULT_OLLAMA_TIMEOUT_MS should be positive');
    assert.ok(AUDIT_STATE_CACHE_TTL_MS > 0, 'AUDIT_STATE_CACHE_TTL_MS should be positive');
  });

  it('MAX_LLM_RETRIES matches retry delays array length', () => {
    assert.equal(LLM_RETRY_DELAYS_MS.length, MAX_LLM_RETRIES, 'Retry delays array should have one entry per retry');
  });

  it('Ollama timeout is greater than standard LLM timeout', () => {
    assert.ok(
      DEFAULT_OLLAMA_TIMEOUT_MS > DEFAULT_LLM_TIMEOUT_MS,
      'Ollama (local) timeout should be larger than remote API timeout',
    );
  });
});
