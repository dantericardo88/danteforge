import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorToJson, formatAndLogError } from '../src/core/format-error.js';
import { DanteError } from '../src/core/errors.js';
import { GateError } from '../src/core/gates.js';

describe('format-error', () => {
  describe('errorToJson', () => {
    it('formats DanteError with code and remedy', () => {
      const err = new DanteError('test msg', 'TEST_CODE', 'fix it');
      const result = errorToJson(err);
      assert.equal(result.error, true);
      assert.equal(result.code, 'TEST_CODE');
      assert.equal(result.message, 'test msg');
      assert.equal(result.remedy, 'fix it');
    });

    it('formats GateError', () => {
      const err = new GateError('gate msg', 'testGate', 'run something');
      const result = errorToJson(err);
      assert.equal(result.error, true);
      assert.equal(result.message, 'gate msg');
    });

    it('formats generic Error', () => {
      const result = errorToJson(new Error('oops'));
      assert.equal(result.error, true);
      assert.equal(result.message, 'oops');
      assert.equal(result.name, 'Error');
    });

    it('formats non-Error', () => {
      const result = errorToJson('just a string');
      assert.equal(result.error, true);
      assert.equal(result.message, 'just a string');
    });
  });
});

describe('formatAndLogError', () => {
  it('handles GateError without throwing', () => {
    assert.doesNotThrow(() => formatAndLogError(new GateError('gate blocked', 'testGate', 'run fix')));
  });

  it('handles DanteError without throwing', () => {
    assert.doesNotThrow(() => formatAndLogError(new DanteError('dante msg', 'DANTE_CODE', 'fix it')));
  });

  it('handles Error with context prefix without throwing', () => {
    assert.doesNotThrow(() => formatAndLogError(new Error('something failed'), 'myCommand'));
  });

  it('handles Error without context without throwing', () => {
    assert.doesNotThrow(() => formatAndLogError(new Error('bare error')));
  });

  it('handles non-Error with context without throwing', () => {
    assert.doesNotThrow(() => formatAndLogError('string error message', 'someContext'));
  });

  it('handles non-Error without context without throwing', () => {
    assert.doesNotThrow(() => formatAndLogError('plain string error'));
  });
});
