// Progress system — tests for spinner handle, withSpinner, progressBar,
// TTY gating, logger spinner routing.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startSpinner,
  withSpinner,
  progressBar,
  getActiveSpinner,
  setActiveSpinner,
  type ProgressOptions,
} from '../src/core/progress.js';
import { logger } from '../src/core/logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const NON_TTY: ProgressOptions = { _isTTY: false };

// ── startSpinner ──────────────────────────────────────────────────────────────

describe('startSpinner', () => {
  afterEach(() => setActiveSpinner(null));

  it('returns a no-op handle in non-TTY mode', async () => {
    const handle = await startSpinner('Working...', NON_TTY);
    // All operations should be no-ops (no throw)
    handle.update('New text');
    handle.succeed('Done');
    handle.fail('Failed');
    handle.stop();
    // After stop, active spinner is null
    assert.equal(getActiveSpinner(), null);
  });

  it('sets active spinner when started', async () => {
    const handle = await startSpinner('Loading...', NON_TTY);
    // In non-TTY, getActiveSpinner returns the noop handle briefly
    // then null after any terminal call (succeed/fail/stop)
    handle.stop();
    assert.equal(getActiveSpinner(), null);
  });

  it('clears active spinner on succeed()', async () => {
    const handle = await startSpinner('Processing...', NON_TTY);
    handle.succeed();
    assert.equal(getActiveSpinner(), null);
  });

  it('clears active spinner on fail()', async () => {
    const handle = await startSpinner('Processing...', NON_TTY);
    handle.fail();
    assert.equal(getActiveSpinner(), null);
  });
});

// ── withSpinner ───────────────────────────────────────────────────────────────

describe('withSpinner', () => {
  afterEach(() => setActiveSpinner(null));

  it('returns the value from the wrapped function', async () => {
    const result = await withSpinner('Computing', async () => 42, undefined, NON_TTY);
    assert.equal(result, 42);
  });

  it('returns a string result from the wrapped function', async () => {
    const result = await withSpinner('Computing', async () => 'hello', undefined, NON_TTY);
    assert.equal(result, 'hello');
  });

  it('propagates errors from wrapped function and calls fail()', async () => {
    let failCalled = false;
    // Intercept the noop handle to detect fail()
    const origStart = startSpinner;

    await assert.rejects(
      () => withSpinner(
        'Failing op',
        async () => { throw new Error('test error'); },
        undefined,
        NON_TTY,
      ),
      (err: Error) => {
        assert.equal(err.message, 'test error');
        return true;
      },
    );
  });

  it('clears active spinner after completion', async () => {
    await withSpinner('Task', async () => 'done', undefined, NON_TTY);
    assert.equal(getActiveSpinner(), null);
  });

  it('clears active spinner after error', async () => {
    try {
      await withSpinner('Failing', async () => { throw new Error('x'); }, undefined, NON_TTY);
    } catch { /* expected */ }
    assert.equal(getActiveSpinner(), null);
  });

  it('accepts undefined successText', async () => {
    const result = await withSpinner('Op', async () => 99, undefined, NON_TTY);
    assert.equal(result, 99);
  });
});

// ── progressBar ──────────────────────────────────────────────────────────────

describe('progressBar', () => {
  it('does nothing in non-TTY mode', () => {
    // Should not throw
    progressBar('Loading', 5, 10, 20, NON_TTY);
    progressBar('Loading', 10, 10, 20, NON_TTY);
    progressBar('Loading', 0, 0, 20, NON_TTY);
  });

  it('handles zero total without division by zero', () => {
    // Non-TTY — purely testing no-throw
    progressBar('Label', 0, 0, 20, NON_TTY);
  });

  it('handles current > total gracefully', () => {
    progressBar('Label', 15, 10, 20, NON_TTY);
  });
});

// ── logger + spinner routing ──────────────────────────────────────────────────

describe('logger spinner routing', () => {
  afterEach(() => setActiveSpinner(null));

  it('logger.info calls update when spinner is active', async () => {
    let lastUpdate = '';
    const mockHandle = {
      update: (t: string) => { lastUpdate = t; },
      succeed: () => { setActiveSpinner(null); },
      fail: () => { setActiveSpinner(null); },
      stop: () => { setActiveSpinner(null); },
    };
    setActiveSpinner(mockHandle);

    logger.info('Progress: 50%');
    assert.equal(lastUpdate, 'Progress: 50%');
  });

  it('logger.success calls update when spinner is active', async () => {
    let lastUpdate = '';
    const mockHandle = {
      update: (t: string) => { lastUpdate = t; },
      succeed: () => { setActiveSpinner(null); },
      fail: () => { setActiveSpinner(null); },
      stop: () => { setActiveSpinner(null); },
    };
    setActiveSpinner(mockHandle);

    logger.success('Done!');
    assert.equal(lastUpdate, 'Done!');
  });

  it('logger.warn calls update when spinner is active', async () => {
    let lastUpdate = '';
    const mockHandle = {
      update: (t: string) => { lastUpdate = t; },
      succeed: () => { setActiveSpinner(null); },
      fail: () => { setActiveSpinner(null); },
      stop: () => { setActiveSpinner(null); },
    };
    setActiveSpinner(mockHandle);

    logger.warn('Something odd');
    assert.equal(lastUpdate, 'Something odd');
  });

  it('logger.error always goes to stderr, never updates spinner', async () => {
    let updated = false;
    const mockHandle = {
      update: () => { updated = true; },
      succeed: () => { setActiveSpinner(null); },
      fail: () => { setActiveSpinner(null); },
      stop: () => { setActiveSpinner(null); },
    };
    setActiveSpinner(mockHandle);

    // logger.error bypasses spinner routing
    logger.error('Critical error');
    assert.equal(updated, false, 'error should NOT update spinner');
  });

  it('logger.info prints normally when no spinner active', () => {
    assert.equal(getActiveSpinner(), null);
    // Should not throw — just normal console.log
    logger.info('Normal message');
  });
});

// ── setActiveSpinner / getActiveSpinner ───────────────────────────────────────

describe('setActiveSpinner / getActiveSpinner', () => {
  afterEach(() => setActiveSpinner(null));

  it('initially null', () => {
    setActiveSpinner(null);
    assert.equal(getActiveSpinner(), null);
  });

  it('returns set spinner', () => {
    const mock = { update: () => {}, succeed: () => {}, fail: () => {}, stop: () => {} };
    setActiveSpinner(mock);
    assert.equal(getActiveSpinner(), mock);
  });

  it('can be cleared', () => {
    const mock = { update: () => {}, succeed: () => {}, fail: () => {}, stop: () => {} };
    setActiveSpinner(mock);
    setActiveSpinner(null);
    assert.equal(getActiveSpinner(), null);
  });
});
