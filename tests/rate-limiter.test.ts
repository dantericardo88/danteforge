import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RateLimiter,
  getMcpRateLimiter,
  setMcpRateLimiter,
} from '../src/core/rate-limiter.js';

function makeRateLimiter(opts = {}) {
  let t = 0;
  return new RateLimiter({
    capacity: 5,
    refillRate: 2,
    refillIntervalMs: 1000,
    _now: () => t++,
    ...opts,
  });
}

describe('RateLimiter: consume', () => {
  it('allows requests up to capacity', () => {
    const rl = makeRateLimiter({ capacity: 3 });
    assert.equal(rl.consume('user1').allowed, true);
    assert.equal(rl.consume('user1').allowed, true);
    assert.equal(rl.consume('user1').allowed, true);
  });

  it('blocks requests over capacity', () => {
    const rl = makeRateLimiter({ capacity: 2 });
    rl.consume('user1');
    rl.consume('user1');
    const result = rl.consume('user1');
    assert.equal(result.allowed, false);
  });

  it('returns remainingTokens', () => {
    const rl = makeRateLimiter({ capacity: 5 });
    const result = rl.consume('a');
    assert.equal(result.remainingTokens, 4);
  });

  it('returns retryAfterMs > 0 when blocked', () => {
    const rl = makeRateLimiter({ capacity: 1 });
    rl.consume('key');
    const blocked = rl.consume('key');
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0);
  });

  it('tracks separate buckets per key', () => {
    const rl = makeRateLimiter({ capacity: 2 });
    rl.consume('a');
    rl.consume('a');
    const blockedA = rl.consume('a');
    const allowedB = rl.consume('b');
    assert.equal(blockedA.allowed, false);
    assert.equal(allowedB.allowed, true);
  });

  it('refills tokens after interval', () => {
    let t = 0;
    const rl = new RateLimiter({
      capacity: 2,
      refillRate: 2,
      refillIntervalMs: 100,
      _now: () => t,
    });
    // drain the bucket
    rl.consume('key');
    rl.consume('key');
    assert.equal(rl.consume('key').allowed, false);

    // advance time past one interval
    t = 200;
    const refilled = rl.consume('key');
    assert.equal(refilled.allowed, true);
  });

  it('caps refill at capacity', () => {
    let t = 0;
    const rl = new RateLimiter({
      capacity: 3,
      refillRate: 10,
      refillIntervalMs: 100,
      _now: () => t,
    });
    rl.consume('key');
    t = 1000; // many intervals pass
    const result = rl.consume('key');
    assert.equal(result.allowed, true);
    assert.ok(result.remainingTokens <= 2);
  });
});

describe('RateLimiter: reset', () => {
  it('reset clears the bucket for a key', () => {
    const rl = makeRateLimiter({ capacity: 1 });
    rl.consume('key');
    const blocked = rl.consume('key');
    assert.equal(blocked.allowed, false);
    rl.reset('key');
    const allowed = rl.consume('key');
    assert.equal(allowed.allowed, true);
  });
});

describe('RateLimiter: cleanup', () => {
  it('cleanup does not throw', () => {
    const rl = makeRateLimiter();
    rl.consume('a');
    assert.doesNotThrow(() => rl.cleanup(0));
  });
});

describe('getMcpRateLimiter / setMcpRateLimiter', () => {
  it('getMcpRateLimiter returns a RateLimiter', () => {
    const rl = getMcpRateLimiter();
    assert.ok(rl instanceof RateLimiter);
  });

  it('setMcpRateLimiter replaces the singleton', () => {
    const old = getMcpRateLimiter();
    const custom = new RateLimiter({ capacity: 99, _now: () => 0 });
    setMcpRateLimiter(custom);
    assert.equal(getMcpRateLimiter(), custom);
    // restore
    setMcpRateLimiter(old);
  });

  it('setMcpRateLimiter(null) resets to default', () => {
    setMcpRateLimiter(null);
    const rl = getMcpRateLimiter();
    assert.ok(rl instanceof RateLimiter);
  });
});
