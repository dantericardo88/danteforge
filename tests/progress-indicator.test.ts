// Progress indicator tests — Node built-in test runner (no Jest/Vitest)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startProgress, withProgress } from '../src/core/progress-indicator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCollector(): { lines: string[]; write: (msg: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    write: (msg: string) => lines.push(msg),
  };
}

// ---------------------------------------------------------------------------
// startProgress — non-TTY mode (clean, line-based output)
// ---------------------------------------------------------------------------

describe('startProgress (non-TTY)', () => {
  it('prints a [START] line when created', () => {
    const col = makeCollector();
    startProgress('Building', { _writeFn: col.write, _isTTY: false });
    assert.ok(
      col.lines.some((l) => l.includes('[START]') && l.includes('Building')),
      'expected [START] Building line',
    );
  });

  it('update() prints a progress line', () => {
    const col = makeCollector();
    const handle = startProgress('Compiling', { _writeFn: col.write, _isTTY: false });
    handle.update('processing files');
    const found = col.lines.some(
      (l) => l.includes('Compiling') && l.includes('processing files'),
    );
    assert.ok(found, 'expected update line with label and message');
  });

  it('done() prints a [DONE] line', () => {
    const col = makeCollector();
    const handle = startProgress('Installing', { _writeFn: col.write, _isTTY: false });
    handle.done('all packages installed');
    const found = col.lines.some(
      (l) => l.includes('[DONE]') && l.includes('Installing'),
    );
    assert.ok(found, 'expected [DONE] line');
  });

  it('fail() prints a [FAIL] line', () => {
    const col = makeCollector();
    const handle = startProgress('Linting', { _writeFn: col.write, _isTTY: false });
    handle.fail('syntax error on line 42');
    const found = col.lines.some(
      (l) => l.includes('[FAIL]') && l.includes('Linting') && l.includes('syntax error'),
    );
    assert.ok(found, 'expected [FAIL] line with error message');
  });

  it('does not write additional lines after done() is called', () => {
    const col = makeCollector();
    const handle = startProgress('Deploying', { _writeFn: col.write, _isTTY: false });
    handle.done();
    const countBeforeExtra = col.lines.length;
    handle.update('this should be ignored');
    handle.done('again — should also be ignored');
    assert.equal(col.lines.length, countBeforeExtra, 'no extra lines after done()');
  });

  it('does not write additional lines after fail() is called', () => {
    const col = makeCollector();
    const handle = startProgress('Testing', { _writeFn: col.write, _isTTY: false });
    handle.fail('test suite crashed');
    const countBeforeFail = col.lines.length;
    handle.update('ignored');
    handle.fail('double-fail — ignored');
    assert.equal(col.lines.length, countBeforeFail, 'no extra lines after fail()');
  });
});

// ---------------------------------------------------------------------------
// withProgress
// ---------------------------------------------------------------------------

describe('withProgress', () => {
  it('returns the value resolved by the wrapped function', async () => {
    const col = makeCollector();
    const result = await withProgress(
      'Computing',
      async (_handle) => 42,
      { _writeFn: col.write, _isTTY: false },
    );
    assert.equal(result, 42);
  });

  it('marks done automatically when the function resolves', async () => {
    const col = makeCollector();
    await withProgress(
      'Syncing',
      async (_handle) => 'ok',
      { _writeFn: col.write, _isTTY: false },
    );
    assert.ok(
      col.lines.some((l) => l.includes('[DONE]') && l.includes('Syncing')),
      'should have [DONE] line after resolve',
    );
  });

  it('marks fail and re-throws when the function rejects', async () => {
    const col = makeCollector();
    await assert.rejects(
      () =>
        withProgress(
          'Deploying',
          async (_handle) => {
            throw new Error('network error');
          },
          { _writeFn: col.write, _isTTY: false },
        ),
      /network error/,
    );
    assert.ok(
      col.lines.some((l) => l.includes('[FAIL]') && l.includes('Deploying')),
      'should have [FAIL] line after rejection',
    );
  });

  it('passes the handle to the wrapped function for intermediate updates', async () => {
    const col = makeCollector();
    await withProgress(
      'Bundling',
      async (handle) => {
        handle.update('step 1');
        handle.update('step 2');
        return 'done';
      },
      { _writeFn: col.write, _isTTY: false },
    );
    const updateLines = col.lines.filter((l) => l.includes('step'));
    assert.equal(updateLines.length, 2, 'expected 2 update lines');
  });
});
