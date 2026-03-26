// Error hierarchy tests — DanteError, LLMError, BudgetError, isRetryableError
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DanteError, LLMError, BudgetError, isRetryableError } from '../src/core/errors.js';

describe('DanteError hierarchy', () => {
  it('DanteError has correct name, code, and retryable', () => {
    const err = new DanteError('test message', 'LLM_TIMEOUT', true);
    assert.equal(err.name, 'DanteError');
    assert.equal(err.code, 'LLM_TIMEOUT');
    assert.equal(err.retryable, true);
    assert.equal(err.message, 'test message');
    assert.ok(err instanceof Error);
  });

  it('DanteError defaults retryable to false', () => {
    const err = new DanteError('msg', 'LLM_AUTH_FAILED');
    assert.equal(err.retryable, false);
  });

  it('LLMError extends DanteError with provider and status', () => {
    const err = new LLMError('auth failed', 'LLM_AUTH_FAILED', 'openai', 401);
    assert.equal(err.name, 'LLMError');
    assert.equal(err.code, 'LLM_AUTH_FAILED');
    assert.equal(err.provider, 'openai');
    assert.equal(err.status, 401);
    assert.equal(err.retryable, false);
    assert.ok(err instanceof DanteError);
    assert.ok(err instanceof Error);
  });

  it('LLMError supports retryable flag', () => {
    const err = new LLMError('timeout', 'LLM_TIMEOUT', 'ollama', 408, true);
    assert.equal(err.retryable, true);
  });

  it('BudgetError has agentRole, currentSpendUsd, maxBudgetUsd', () => {
    const err = new BudgetError('over budget', 'researcher', 5.50, 5.00);
    assert.equal(err.name, 'BudgetError');
    assert.equal(err.code, 'BUDGET_EXCEEDED');
    assert.equal(err.agentRole, 'researcher');
    assert.equal(err.currentSpendUsd, 5.50);
    assert.equal(err.maxBudgetUsd, 5.00);
    assert.equal(err.retryable, false);
    assert.ok(err instanceof DanteError);
    assert.ok(err instanceof Error);
  });

  it('instanceof hierarchy: LLMError → DanteError → Error', () => {
    const err = new LLMError('msg', 'LLM_UNAVAILABLE', 'claude', 503, true);
    assert.ok(err instanceof LLMError);
    assert.ok(err instanceof DanteError);
    assert.ok(err instanceof Error);
  });
});

describe('isRetryableError', () => {
  it('recognizes DanteError with retryable=true', () => {
    const err = new DanteError('retry me', 'LLM_TIMEOUT', true);
    assert.equal(isRetryableError(err), true);
  });

  it('rejects DanteError with retryable=false', () => {
    const err = new DanteError('no retry', 'LLM_AUTH_FAILED', false);
    assert.equal(isRetryableError(err), false);
  });

  it('recognizes LLMError with retryable=true', () => {
    const err = new LLMError('rate limited', 'LLM_RATE_LIMITED', 'grok', 429, true);
    assert.equal(isRetryableError(err), true);
  });

  it('still recognizes string patterns (backward compat)', () => {
    assert.equal(isRetryableError(new Error('ECONNRESET')), true);
    assert.equal(isRetryableError(new Error('ECONNREFUSED')), true);
    assert.equal(isRetryableError(new Error('ETIMEDOUT')), true);
    assert.equal(isRetryableError(new Error('socket hang up')), true);
    assert.equal(isRetryableError(new Error('fetch failed')), true);
    assert.equal(isRetryableError(new Error('rate limit exceeded')), true);
    assert.equal(isRetryableError(new Error('HTTP 429')), true);
    assert.equal(isRetryableError(new Error('HTTP 503')), true);
    assert.equal(isRetryableError(new Error('HTTP 502')), true);
  });

  it('rejects non-retryable plain errors', () => {
    assert.equal(isRetryableError(new Error('Not found')), false);
    assert.equal(isRetryableError(new Error('syntax error')), false);
  });

  it('rejects non-Error values', () => {
    assert.equal(isRetryableError('string'), false);
    assert.equal(isRetryableError(42), false);
    assert.equal(isRetryableError(null), false);
    assert.equal(isRetryableError(undefined), false);
  });
});
