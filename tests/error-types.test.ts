// Tests for src/core/error-types.ts — Node.js built-in test runner
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DanteForgeError,
  ConfigError,
  ConfigMissingKeyError,
  StateError,
  StateCorruptError,
  LLMError,
  RateLimitError,
  TimeoutError,
  LLMUnavailableError,
  LLMAuthError,
  MatrixError,
  LeaseError,
  WorktreeError,
  ConflictError,
  GateError,
  SpecError,
  SpecMissingError,
  isDanteForgeError,
  isRetryable,
} from '../src/core/error-types.js';

// ---------------------------------------------------------------------------
// DanteForgeError — base class
// ---------------------------------------------------------------------------

describe('DanteForgeError', () => {
  it('stores code, message, and context', () => {
    const err = new DanteForgeError('MY_CODE', 'something went wrong', { detail: 42 });
    assert.equal(err.code, 'MY_CODE');
    assert.equal(err.message, 'something went wrong');
    assert.deepEqual(err.context, { detail: 42 });
  });

  it('defaults context to empty object when omitted', () => {
    const err = new DanteForgeError('BARE', 'bare error');
    assert.deepEqual(err.context, {});
  });

  it('is an instance of Error', () => {
    const err = new DanteForgeError('X', 'msg');
    assert.ok(err instanceof Error);
  });

  it('sets name to the concrete class name', () => {
    const err = new DanteForgeError('X', 'msg');
    assert.equal(err.name, 'DanteForgeError');
  });

  it('has a stack trace', () => {
    const err = new DanteForgeError('X', 'msg');
    assert.ok(typeof err.stack === 'string' && err.stack.length > 0);
  });
});

// ---------------------------------------------------------------------------
// isDanteForgeError type guard
// ---------------------------------------------------------------------------

describe('isDanteForgeError', () => {
  it('returns true for DanteForgeError instance', () => {
    assert.ok(isDanteForgeError(new DanteForgeError('X', 'msg')));
  });

  it('returns true for subclass instances', () => {
    assert.ok(isDanteForgeError(new ConfigError('bad config')));
    assert.ok(isDanteForgeError(new RateLimitError('anthropic')));
    assert.ok(isDanteForgeError(new LeaseError('lease expired')));
    assert.ok(isDanteForgeError(new GateError('TESTS', 'tests required')));
  });

  it('returns false for plain Error', () => {
    assert.ok(!isDanteForgeError(new Error('plain')));
  });

  it('returns false for null / undefined / string', () => {
    assert.ok(!isDanteForgeError(null));
    assert.ok(!isDanteForgeError(undefined));
    assert.ok(!isDanteForgeError('string error'));
  });
});

// ---------------------------------------------------------------------------
// ConfigError / ConfigMissingKeyError — code prefix CONFIG_*
// ---------------------------------------------------------------------------

describe('ConfigError', () => {
  it('has code starting with CONFIG_', () => {
    const err = new ConfigError('bad config');
    assert.ok(err.code.startsWith('CONFIG_'));
  });

  it('is an instance of DanteForgeError', () => {
    assert.ok(new ConfigError('x') instanceof DanteForgeError);
  });
});

describe('ConfigMissingKeyError', () => {
  it('stores the missing key in context', () => {
    const err = new ConfigMissingKeyError('apiKey');
    assert.equal(err.context['key'], 'apiKey');
  });

  it('has code CONFIG_MISSING_KEY', () => {
    const err = new ConfigMissingKeyError('apiKey');
    assert.equal(err.code, 'CONFIG_MISSING_KEY');
  });
});

// ---------------------------------------------------------------------------
// StateError / StateCorruptError — code prefix STATE_*
// ---------------------------------------------------------------------------

describe('StateError', () => {
  it('has code starting with STATE_', () => {
    const err = new StateError('bad state');
    assert.ok(err.code.startsWith('STATE_'));
  });

  it('is not retryable', () => {
    assert.ok(!isRetryable(new StateError('bad state')));
  });
});

describe('StateCorruptError', () => {
  it('stores path in context', () => {
    const err = new StateCorruptError('/path/to/STATE.yaml');
    assert.equal(err.context['path'], '/path/to/STATE.yaml');
  });

  it('has code STATE_CORRUPT', () => {
    const err = new StateCorruptError('/path');
    assert.equal(err.code, 'STATE_CORRUPT');
  });
});

// ---------------------------------------------------------------------------
// LLMError, RateLimitError, TimeoutError — code prefix LLM_*
// ---------------------------------------------------------------------------

describe('LLMError', () => {
  it('has custom code set by caller', () => {
    const err = new LLMError('LLM_EMPTY', 'empty response');
    assert.equal(err.code, 'LLM_EMPTY');
  });

  it('is an instance of DanteForgeError', () => {
    assert.ok(new LLMError('LLM_X', 'x') instanceof DanteForgeError);
  });
});

describe('RateLimitError', () => {
  it('has code LLM_RATE_LIMIT', () => {
    const err = new RateLimitError('openai');
    assert.equal(err.code, 'LLM_RATE_LIMIT');
  });

  it('stores provider in context', () => {
    const err = new RateLimitError('anthropic');
    assert.equal(err.context['provider'], 'anthropic');
  });

  it('isRetryable returns true', () => {
    assert.ok(isRetryable(new RateLimitError('openai')));
  });

  it('is an instance of LLMError', () => {
    assert.ok(new RateLimitError('x') instanceof LLMError);
  });
});

describe('TimeoutError', () => {
  it('has code LLM_TIMEOUT', () => {
    const err = new TimeoutError('ollama');
    assert.equal(err.code, 'LLM_TIMEOUT');
  });

  it('stores provider and timeoutMs in context', () => {
    const err = new TimeoutError('grok', 5000);
    assert.equal(err.context['provider'], 'grok');
    assert.equal(err.context['timeoutMs'], 5000);
  });

  it('isRetryable returns true', () => {
    assert.ok(isRetryable(new TimeoutError('ollama', 30000)));
  });

  it('is an instance of LLMError', () => {
    assert.ok(new TimeoutError('x') instanceof LLMError);
  });
});

describe('LLMUnavailableError', () => {
  it('has code LLM_UNAVAILABLE', () => {
    assert.equal(new LLMUnavailableError('ollama').code, 'LLM_UNAVAILABLE');
  });

  it('isRetryable returns true', () => {
    assert.ok(isRetryable(new LLMUnavailableError('ollama')));
  });
});

describe('LLMAuthError', () => {
  it('has code LLM_AUTH_FAILED', () => {
    assert.equal(new LLMAuthError('anthropic').code, 'LLM_AUTH_FAILED');
  });

  it('isRetryable returns false', () => {
    assert.ok(!isRetryable(new LLMAuthError('anthropic')));
  });
});

// ---------------------------------------------------------------------------
// MatrixError, LeaseError, WorktreeError — code prefix MATRIX_*
// ---------------------------------------------------------------------------

describe('MatrixError', () => {
  it('is an instance of DanteForgeError', () => {
    assert.ok(new MatrixError('MATRIX_X', 'x') instanceof DanteForgeError);
  });
});

describe('LeaseError', () => {
  it('has code MATRIX_LEASE_ERROR', () => {
    assert.equal(new LeaseError('expired').code, 'MATRIX_LEASE_ERROR');
  });

  it('is an instance of MatrixError', () => {
    assert.ok(new LeaseError('x') instanceof MatrixError);
  });
});

describe('WorktreeError', () => {
  it('has code MATRIX_WORKTREE_ERROR', () => {
    assert.equal(new WorktreeError('stale').code, 'MATRIX_WORKTREE_ERROR');
  });

  it('is an instance of MatrixError', () => {
    assert.ok(new WorktreeError('x') instanceof MatrixError);
  });
});

describe('ConflictError', () => {
  it('has code MATRIX_CONFLICT', () => {
    assert.equal(new ConflictError('overlap').code, 'MATRIX_CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// GateError — code prefix GATE_*
// ---------------------------------------------------------------------------

describe('GateError', () => {
  it('has code GATE_<GATE_NAME>', () => {
    const err = new GateError('tests', 'tests must pass');
    assert.equal(err.code, 'GATE_TESTS');
  });

  it('stores gate in context', () => {
    const err = new GateError('spec', 'spec required');
    assert.equal(err.context['gate'], 'spec');
  });

  it('is an instance of DanteForgeError', () => {
    assert.ok(new GateError('x', 'y') instanceof DanteForgeError);
  });

  it('isRetryable returns false', () => {
    assert.ok(!isRetryable(new GateError('tests', 'tests must pass')));
  });
});

// ---------------------------------------------------------------------------
// SpecError / SpecMissingError — code prefix SPEC_*
// ---------------------------------------------------------------------------

describe('SpecError', () => {
  it('has code starting with SPEC_', () => {
    assert.ok(new SpecError('no spec').code.startsWith('SPEC_'));
  });
});

describe('SpecMissingError', () => {
  it('has code SPEC_MISSING', () => {
    assert.equal(new SpecMissingError('SPEC.md').code, 'SPEC_MISSING');
  });

  it('stores artifact in context', () => {
    const err = new SpecMissingError('PLAN.md');
    assert.equal(err.context['artifact'], 'PLAN.md');
  });

  it('isRetryable returns false', () => {
    assert.ok(!isRetryable(new SpecMissingError('SPEC.md')));
  });
});

// ---------------------------------------------------------------------------
// isRetryable — generic network error patterns
// ---------------------------------------------------------------------------

describe('isRetryable — generic Error patterns', () => {
  it('returns true for ECONNRESET', () => {
    assert.ok(isRetryable(new Error('read ECONNRESET')));
  });

  it('returns true for "fetch failed"', () => {
    assert.ok(isRetryable(new Error('fetch failed')));
  });

  it('returns true for "502" in message', () => {
    assert.ok(isRetryable(new Error('HTTP 502 Bad Gateway')));
  });

  it('returns false for non-Error values', () => {
    assert.ok(!isRetryable(42));
    assert.ok(!isRetryable(null));
    assert.ok(!isRetryable('string'));
  });

  it('returns false for ConfigError', () => {
    assert.ok(!isRetryable(new ConfigError('bad config')));
  });

  it('returns false for GateError', () => {
    assert.ok(!isRetryable(new GateError('tests', 'tests required')));
  });
});
