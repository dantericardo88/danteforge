// Tests for src/core/retry-policy.ts — Node.js built-in test runner
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, withRetryDetailed, computeDelay } from '../src/core/retry-policy.js';
import { RateLimitError, TimeoutError, ConfigError } from '../src/core/error-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Instant delay shim — never actually sleeps. Tracks calls. */
function noDelay(): (ms: number) => Promise<void> {
  const delays: number[] = [];
  const fn = (ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  };
  (fn as unknown as { delays: number[] }).delays = delays;
  return fn;
}

function makeCounter(succeedOnAttempt: number, err: Error = new RateLimitError('test')) {
  let attempt = 0;
  return async () => {
    attempt++;
    if (attempt < succeedOnAttempt) throw err;
    return `ok-${attempt}`;
  };
}

// ---------------------------------------------------------------------------
// withRetry — basic success
// ---------------------------------------------------------------------------

describe('withRetry — succeeds on first attempt', () => {
  it('returns the result immediately', async () => {
    const result = await withRetry(async () => 'hello', { _delayFn: noDelay() });
    assert.equal(result, 'hello');
  });

  it('does not call the delay function on clean success', async () => {
    const delay = noDelay();
    await withRetry(async () => 42, { _delayFn: delay });
    assert.equal((delay as unknown as { delays: number[] }).delays.length, 0);
  });
});

// ---------------------------------------------------------------------------
// withRetry — retry on retryable error
// ---------------------------------------------------------------------------

describe('withRetry — retries on retryable error and succeeds', () => {
  it('retries once and returns result on second attempt', async () => {
    const fn = makeCounter(2); // fail attempt 1, succeed attempt 2
    const result = await withRetry(fn, {
      maxAttempts: 3,
      jitter: false,
      _delayFn: noDelay(),
    });
    assert.equal(result, 'ok-2');
  });

  it('retries twice when first two attempts fail', async () => {
    const fn = makeCounter(3); // fail 1+2, succeed 3
    const result = await withRetry(fn, {
      maxAttempts: 3,
      jitter: false,
      _delayFn: noDelay(),
    });
    assert.equal(result, 'ok-3');
  });

  it('calls delay function between retries', async () => {
    const delay = noDelay();
    const fn = makeCounter(2);
    await withRetry(fn, { maxAttempts: 3, jitter: false, _delayFn: delay });
    const dl = (delay as unknown as { delays: number[] }).delays;
    assert.equal(dl.length, 1, 'exactly one delay call for one retry');
  });
});

// ---------------------------------------------------------------------------
// withRetry — exhausts attempts
// ---------------------------------------------------------------------------

describe('withRetry — throws after maxAttempts exhausted', () => {
  it('throws the last error when all attempts fail', async () => {
    const err = new RateLimitError('openai');
    const fn = async () => { throw err; };
    await assert.rejects(
      () => withRetry(fn, { maxAttempts: 3, jitter: false, _delayFn: noDelay() }),
      (thrown: unknown) => thrown === err,
    );
  });

  it('makes exactly maxAttempts total calls', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new TimeoutError('ollama', 1000);
    };
    await assert.rejects(
      () => withRetry(fn, { maxAttempts: 4, jitter: false, _delayFn: noDelay() }),
    );
    assert.equal(calls, 4);
  });
});

// ---------------------------------------------------------------------------
// withRetry — non-retryable errors are thrown immediately
// ---------------------------------------------------------------------------

describe('withRetry — non-retryable error bypasses retry', () => {
  it('throws immediately without retrying', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new ConfigError('bad config'); // not retryable
    };
    await assert.rejects(
      () => withRetry(fn, { maxAttempts: 5, jitter: false, _delayFn: noDelay() }),
      (e: unknown) => e instanceof ConfigError,
    );
    assert.equal(calls, 1, 'should NOT have retried a non-retryable error');
  });

  it('custom retryIf prevents retry for specific errors', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new RateLimitError('anthropic');
    };
    await assert.rejects(
      () => withRetry(fn, {
        maxAttempts: 5,
        jitter: false,
        _delayFn: noDelay(),
        retryIf: () => false, // never retry
      }),
    );
    assert.equal(calls, 1);
  });

  it('custom retryIf allows selective retries', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new ConfigError('bad'); // normally not retryable
    };
    await assert.rejects(
      () => withRetry(fn, {
        maxAttempts: 3,
        jitter: false,
        _delayFn: noDelay(),
        retryIf: (e) => e instanceof ConfigError, // treat it as retryable
      }),
    );
    assert.equal(calls, 3, 'should have retried 3 times');
  });
});

// ---------------------------------------------------------------------------
// computeDelay — exponential backoff
// ---------------------------------------------------------------------------

describe('computeDelay — exponential progression', () => {
  const opts = { baseDelayMs: 1000, maxDelayMs: 30_000, factor: 2, jitter: false };

  it('attempt 0 returns baseDelayMs (no jitter)', () => {
    assert.equal(computeDelay(0, opts), 1000);
  });

  it('attempt 1 returns 2× base (no jitter)', () => {
    assert.equal(computeDelay(1, opts), 2000);
  });

  it('attempt 2 returns 4× base (no jitter)', () => {
    assert.equal(computeDelay(2, opts), 4000);
  });

  it('delay is capped at maxDelayMs', () => {
    const delay = computeDelay(20, opts);
    assert.ok(delay <= 30_000, `delay ${delay} should not exceed maxDelayMs`);
  });
});

describe('computeDelay — jitter', () => {
  it('jitter adds randomness (delay differs across calls with jitter=true)', () => {
    const opts = { baseDelayMs: 10_000, maxDelayMs: 60_000, factor: 2, jitter: true };
    const delays = new Set<number>();
    for (let i = 0; i < 20; i++) {
      delays.add(computeDelay(2, opts));
    }
    // With ±20% jitter across 20 samples, we almost certainly get >1 unique value
    assert.ok(delays.size > 1, 'jitter should produce different delays across calls');
  });

  it('jitter keeps delay within ±20% of the base value', () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 30_000, factor: 2, jitter: true };
    const base = 1000; // attempt 0: 1000 * 2^0 = 1000
    for (let i = 0; i < 50; i++) {
      const d = computeDelay(0, opts);
      assert.ok(d >= base * 0.8 - 1, `delay ${d} below 80% of base`);
      assert.ok(d <= base * 1.2 + 1, `delay ${d} above 120% of base`);
    }
  });
});

// ---------------------------------------------------------------------------
// withRetryDetailed
// ---------------------------------------------------------------------------

describe('withRetryDetailed — metadata', () => {
  it('returns attempt count = 1 on first-attempt success', async () => {
    const { attempts } = await withRetryDetailed(async () => 'x', {
      _delayFn: noDelay(),
    });
    assert.equal(attempts, 1);
  });

  it('returns attempt count = 2 after one retry', async () => {
    const fn = makeCounter(2);
    const { attempts } = await withRetryDetailed(fn, {
      maxAttempts: 3,
      jitter: false,
      _delayFn: noDelay(),
    });
    assert.equal(attempts, 2);
  });

  it('returns correct result along with metadata', async () => {
    const { result, attempts, totalDelayMs } = await withRetryDetailed(
      async () => 99,
      { _delayFn: noDelay() },
    );
    assert.equal(result, 99);
    assert.equal(attempts, 1);
    assert.equal(totalDelayMs, 0);
  });

  it('totalDelayMs accumulates across retries', async () => {
    const delay = noDelay();
    const fn = makeCounter(3); // 2 retries
    const { totalDelayMs } = await withRetryDetailed(fn, {
      maxAttempts: 3,
      baseDelayMs: 500,
      jitter: false,
      _delayFn: delay,
    });
    // delay 0 = 500ms, delay 1 = 1000ms → total = 1500ms
    assert.equal(totalDelayMs, 1500);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('withRetry — edge cases', () => {
  it('maxAttempts: 1 means no retries', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new RateLimitError('x');
    };
    await assert.rejects(
      () => withRetry(fn, { maxAttempts: 1, _delayFn: noDelay() }),
    );
    assert.equal(calls, 1);
  });

  it('works with async functions that return complex objects', async () => {
    const obj = { a: 1, b: [2, 3] };
    const result = await withRetry(async () => obj, { _delayFn: noDelay() });
    assert.deepEqual(result, obj);
  });
});
