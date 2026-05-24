import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startProgress, withProgress } from '../src/core/ux-progress.js';

describe('startProgress', () => {
  it('returns a handle with update/succeed/fail/stop methods', () => {
    const handle = startProgress('doing something');
    assert.equal(typeof handle.update, 'function');
    assert.equal(typeof handle.succeed, 'function');
    assert.equal(typeof handle.fail, 'function');
    assert.equal(typeof handle.stop, 'function');
    handle.stop();
  });

  it('does not throw when called in non-TTY environment', () => {
    // process.stdout.isTTY is undefined in test runner — noop path
    assert.doesNotThrow(() => {
      const h = startProgress('test');
      h.update('updated');
      h.succeed('done');
    });
  });
});

describe('withProgress', () => {
  it('passes through the return value of the wrapped function', async () => {
    const result = await withProgress('computing', async () => 42);
    assert.equal(result, 42);
  });

  it('re-throws errors from the wrapped function', async () => {
    await assert.rejects(
      () => withProgress('failing', async () => { throw new Error('boom'); }),
      (err: Error) => err.message === 'boom',
    );
  });

  it('provides a progress handle to the wrapped function', async () => {
    let handleReceived = false;
    await withProgress('with handle', async (handle) => {
      assert.equal(typeof handle.update, 'function');
      handle.update('step 2');
      handleReceived = true;
    });
    assert.ok(handleReceived);
  });

  it('resolves correctly when function calls succeed explicitly', async () => {
    const result = await withProgress('explicit succeed', async (handle) => {
      handle.succeed('all done');
      return 'ok';
    });
    assert.equal(result, 'ok');
  });
});
