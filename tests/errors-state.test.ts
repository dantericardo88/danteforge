// errors-state.test.ts — StateError class and state error codes (v0.19.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateError, DanteError, type DanteErrorCode } from '../src/core/errors.js';

describe('StateError', () => {
  it('extends DanteError', () => {
    const err = new StateError('test message');
    assert.ok(err instanceof DanteError, 'StateError should extend DanteError');
    assert.ok(err instanceof Error);
  });

  it('name is StateError', () => {
    const err = new StateError('msg');
    assert.equal(err.name, 'StateError');
  });

  it('defaults code to STATE_CORRUPT when no code given', () => {
    const err = new StateError('corrupt');
    assert.equal(err.code, 'STATE_CORRUPT');
  });

  it('accepts STATE_LOCK_FAILED code', () => {
    const err = new StateError('lock failed', 'STATE_LOCK_FAILED', 'wait and retry');
    assert.equal(err.code, 'STATE_LOCK_FAILED');
    assert.equal(err.remedy, 'wait and retry');
  });

  it('accepts STATE_WRITE_FAILED code', () => {
    const err = new StateError('write failed', 'STATE_WRITE_FAILED');
    assert.equal(err.code, 'STATE_WRITE_FAILED');
  });

  it('accepts STATE_READ_FAILED code', () => {
    const err = new StateError('read failed', 'STATE_READ_FAILED');
    assert.equal(err.code, 'STATE_READ_FAILED');
  });

  it('default remedy message references danteforge init', () => {
    const err = new StateError('msg');
    assert.ok(err.remedy.includes('danteforge init'), `remedy should mention "danteforge init", got: ${err.remedy}`);
  });

  it('all 4 state error codes are valid DanteErrorCode values', () => {
    const codes: DanteErrorCode[] = [
      'STATE_CORRUPT',
      'STATE_LOCK_FAILED',
      'STATE_WRITE_FAILED',
      'STATE_READ_FAILED',
    ];
    for (const code of codes) {
      const err = new StateError('test', code as ConstructorParameters<typeof StateError>[1]);
      assert.equal(err.code, code);
    }
  });

  it('message is accessible as err.message', () => {
    const err = new StateError('this is the message', 'STATE_CORRUPT');
    assert.equal(err.message, 'this is the message');
  });
});
