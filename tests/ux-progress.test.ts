import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startProgress, withProgress } from '../src/core/ux-progress.js';

function captureWriter() {
  const chunks: string[] = [];
  return {
    write: (chunk: string) => { chunks.push(chunk); },
    output: () => chunks.join(''),
  };
}

describe('startProgress', () => {
  it('returns a handle with update/succeed/fail/stop methods', () => {
    const handle = startProgress('doing something', { mode: 'silent' });
    assert.equal(typeof handle.update, 'function');
    assert.equal(typeof handle.succeed, 'function');
    assert.equal(typeof handle.fail, 'function');
    assert.equal(typeof handle.stop, 'function');
    handle.stop();
  });

  it('does not throw when called in non-TTY environment', () => {
    // process.stdout.isTTY is undefined in test runner — noop path
    const capture = captureWriter();
    assert.doesNotThrow(() => {
      const h = startProgress('test', { _isTTY: false, _write: capture.write });
      h.update('updated');
      h.succeed('done');
    });
  });

  it('renders deterministic plain progress in non-TTY mode', () => {
    const capture = captureWriter();
    const handle = startProgress('Cloning repo', {
      _isTTY: false,
      _write: capture.write,
      _now: () => 1_000,
    });

    handle.update('Running tests');
    handle.succeed('Complete');

    assert.equal(
      capture.output(),
      '[progress] Cloning repo\n[progress] Running tests\n[done] Complete (0s)\n',
    );
  });

  it('can be silenced explicitly for machine-readable callers', () => {
    const capture = captureWriter();
    const handle = startProgress('Hidden', {
      mode: 'silent',
      _isTTY: false,
      _write: capture.write,
    });

    handle.update('Still hidden');
    handle.fail('Failed');

    assert.equal(capture.output(), '');
  });

  it('sanitizes control characters from rendered labels', () => {
    const capture = captureWriter();
    const handle = startProgress('Start\n\x1b[31mred', {
      _isTTY: false,
      _write: capture.write,
      _now: () => 1_000,
    });

    handle.update('Next\rline');
    handle.fail();

    assert.equal(
      capture.output(),
      '[progress] Start red\n[progress] Next line\n[failed] Next line (0s)\n',
    );
  });

  it('truncates TTY render lines to the configured terminal width', () => {
    const capture = captureWriter();
    const handle = startProgress('A very long operation label that should not wrap', {
      mode: 'spinner',
      _isTTY: true,
      _columns: 28,
      _write: capture.write,
      _now: () => 1_000,
      _setInterval: () => ({}) as NodeJS.Timeout,
      _clearInterval: () => {},
    });

    handle.stop();

    const firstLine = capture.output().split('\r')[1] ?? '';
    assert.ok(firstLine.length <= 28, `line was ${firstLine.length} chars: ${firstLine}`);
  });
});

describe('withProgress', () => {
  it('passes through the return value of the wrapped function', async () => {
    const result = await withProgress('computing', async () => 42, { mode: 'silent' });
    assert.equal(result, 42);
  });

  it('emits a completion line when the wrapped function succeeds', async () => {
    const capture = captureWriter();

    const result = await withProgress('computing', async () => 42, {
      _isTTY: false,
      _write: capture.write,
      _now: () => 1_000,
    });

    assert.equal(result, 42);
    assert.equal(capture.output(), '[progress] computing\n[done] computing (0s)\n');
  });

  it('re-throws errors from the wrapped function', async () => {
    await assert.rejects(
      () => withProgress('failing', async () => { throw new Error('boom'); }, { mode: 'silent' }),
      (err: Error) => err.message === 'boom',
    );
  });

  it('provides a progress handle to the wrapped function', async () => {
    let handleReceived = false;
    await withProgress('with handle', async (handle) => {
      assert.equal(typeof handle.update, 'function');
      handle.update('step 2');
      handleReceived = true;
    }, { mode: 'silent' });
    assert.ok(handleReceived);
  });

  it('resolves correctly when function calls succeed explicitly', async () => {
    const capture = captureWriter();
    const result = await withProgress('explicit succeed', async (handle) => {
      handle.succeed('all done');
      return 'ok';
    }, {
      _isTTY: false,
      _write: capture.write,
      _now: () => 1_000,
    });
    assert.equal(result, 'ok');
    assert.equal(capture.output(), '[progress] explicit succeed\n[done] all done (0s)\n');
  });

  it('does not emit a second terminal event after explicit failure', async () => {
    const capture = captureWriter();

    await assert.rejects(
      () => withProgress('explicit fail', async (handle) => {
        handle.fail('already failed');
        throw new Error('boom');
      }, {
        _isTTY: false,
        _write: capture.write,
        _now: () => 1_000,
      }),
      (err: Error) => err.message === 'boom',
    );

    assert.equal(capture.output(), '[progress] explicit fail\n[failed] already failed (0s)\n');
  });
});
