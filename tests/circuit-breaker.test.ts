// Circuit breaker tests — per-provider state machine with exponential backoff
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCircuitState,
  shouldAllowRequest,
  recordSuccess,
  recordFailure,
  computeBackoffDelay,
  resetAllCircuits,
} from '../src/core/circuit-breaker.js';

describe('circuit-breaker', () => {
  beforeEach(() => { resetAllCircuits(); });

  it('starts in closed state', () => {
    assert.equal(getCircuitState('test-provider'), 'closed');
  });

  it('recordFailure × threshold transitions to open', () => {
    const config = { failureThreshold: 3, resetTimeoutMs: 30_000, halfOpenSuccessThreshold: 1 };
    recordFailure('p1', config);
    assert.equal(getCircuitState('p1'), 'closed');
    recordFailure('p1', config);
    assert.equal(getCircuitState('p1'), 'closed');
    recordFailure('p1', config);
    assert.equal(getCircuitState('p1'), 'open');
  });

  it('shouldAllowRequest returns false when open', () => {
    const config = { failureThreshold: 1, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 };
    recordFailure('p2', config);
    assert.equal(getCircuitState('p2'), 'open');
    assert.equal(shouldAllowRequest('p2', config), false);
  });

  it('shouldAllowRequest returns true after resetTimeout (transitions to half_open)', () => {
    const config = { failureThreshold: 1, resetTimeoutMs: 100, halfOpenSuccessThreshold: 1 };
    recordFailure('p3', config);
    assert.equal(getCircuitState('p3'), 'open');

    // Simulate time passing beyond resetTimeout
    const futureTime = Date.now() + 200;
    assert.equal(shouldAllowRequest('p3', config, futureTime), true);
    assert.equal(getCircuitState('p3'), 'half_open');
  });

  it('recordSuccess in half_open transitions to closed', () => {
    const config = { failureThreshold: 1, resetTimeoutMs: 100, halfOpenSuccessThreshold: 1 };
    recordFailure('p4', config);
    assert.equal(getCircuitState('p4'), 'open');

    // Transition to half_open
    shouldAllowRequest('p4', config, Date.now() + 200);
    assert.equal(getCircuitState('p4'), 'half_open');

    // Record success → should transition to closed
    recordSuccess('p4', config);
    assert.equal(getCircuitState('p4'), 'closed');
  });

  it('recordFailure in half_open transitions back to open', () => {
    const config = { failureThreshold: 1, resetTimeoutMs: 100, halfOpenSuccessThreshold: 1 };
    recordFailure('p5', config);
    shouldAllowRequest('p5', config, Date.now() + 200);
    assert.equal(getCircuitState('p5'), 'half_open');

    recordFailure('p5', config);
    assert.equal(getCircuitState('p5'), 'open');
  });

  it('computeBackoffDelay grows exponentially', () => {
    assert.equal(computeBackoffDelay(0, 1000), 1000);
    assert.equal(computeBackoffDelay(1, 1000), 2000);
    assert.equal(computeBackoffDelay(2, 1000), 4000);
    assert.equal(computeBackoffDelay(3, 1000), 8000);
  });

  it('computeBackoffDelay caps at maxDelay', () => {
    assert.equal(computeBackoffDelay(10, 1000, 5000), 5000);
    assert.equal(computeBackoffDelay(20, 1000, 30_000), 30_000);
  });

  it('resetAllCircuits clears all state', () => {
    const config = { failureThreshold: 1, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 };
    recordFailure('a', config);
    recordFailure('b', config);
    assert.equal(getCircuitState('a'), 'open');
    assert.equal(getCircuitState('b'), 'open');

    resetAllCircuits();
    assert.equal(getCircuitState('a'), 'closed');
    assert.equal(getCircuitState('b'), 'closed');
  });

  // ── Mutation-killing boundary tests ──────────────────────────────────────────

  it('Tmut1: exactly failureThreshold failures trips OPEN (not threshold-1)', () => {
    // Kills: condition `>= threshold` mutated to `> threshold`
    const config = { failureThreshold: 4, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 };
    for (let i = 0; i < 3; i++) recordFailure('mut1', config);
    assert.equal(getCircuitState('mut1'), 'closed', 'threshold-1 failures should NOT trip open');
    recordFailure('mut1', config);
    assert.equal(getCircuitState('mut1'), 'open', 'exactly threshold failures MUST trip open');
  });

  it('Tmut2: timeout boundary — open at resetTimeoutMs-1, half_open at resetTimeoutMs', () => {
    // Kills: `>= config.resetTimeoutMs` mutated to `> config.resetTimeoutMs`
    const config = { failureThreshold: 1, resetTimeoutMs: 1000, halfOpenSuccessThreshold: 1 };
    recordFailure('mut2', config);
    const openedAt = Date.now();

    // Just before timeout: still open
    assert.equal(shouldAllowRequest('mut2', config, openedAt + 999), false,
      'should still be open at resetTimeoutMs - 1ms');

    // At exactly resetTimeoutMs: should transition to half_open
    assert.equal(shouldAllowRequest('mut2', config, openedAt + 1000), true,
      'should allow request at exactly resetTimeoutMs');
    assert.equal(getCircuitState('mut2'), 'half_open');
  });

  it('Tmut3: exactly halfOpenSuccessThreshold successes closes circuit (not threshold-1)', () => {
    // Kills: `>= halfOpenSuccessThreshold` mutated to `> halfOpenSuccessThreshold`
    const config = { failureThreshold: 1, resetTimeoutMs: 100, halfOpenSuccessThreshold: 3 };
    recordFailure('mut3', config);
    shouldAllowRequest('mut3', config, Date.now() + 200); // → half_open

    recordSuccess('mut3', config);
    assert.equal(getCircuitState('mut3'), 'half_open', 'threshold-1 successes should NOT close');
    recordSuccess('mut3', config);
    assert.equal(getCircuitState('mut3'), 'half_open', 'threshold-1 successes should NOT close');
    recordSuccess('mut3', config);
    assert.equal(getCircuitState('mut3'), 'closed', 'exactly threshold successes MUST close');
  });
});
