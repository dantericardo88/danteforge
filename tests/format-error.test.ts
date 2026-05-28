import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorToJson } from '../src/core/format-error.js';
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

    it('redacts DanteError messages and remedies', () => {
      const err = new DanteError(
        'provider failed with key=ABCDEFGHIJKLMNOPQRST',
        'TEST_CODE',
        'rotate Bearer abcdefghijklmnopqrstuvwxyz123456',
      );
      const result = errorToJson(err);
      assert.equal(result.message, 'provider failed with key=****');
      assert.equal(result.remedy, 'rotate Bearer ****');
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

    it('includes nested causes with stable codes', () => {
      const root = new Error('config.yaml missing');
      const mid = new Error('failed loading provider config', { cause: root });
      const top = new Error('startup failed', { cause: mid });

      const result = errorToJson(top);

      assert.equal(result.code, 'ERR_CONFIG_MISSING');
      assert.ok(Array.isArray(result.causes), 'causes should be an array');
      assert.deepEqual(
        (result.causes as Array<Record<string, unknown>>).map(cause => cause.message),
        ['failed loading provider config', 'config.yaml missing'],
      );
      assert.equal((result.causes as Array<Record<string, unknown>>)[1]?.code, 'ERR_CONFIG_MISSING');
    });

    it('promotes wrapped DanteError cause codes to the top-level JSON code', () => {
      const root = new DanteError('opaque provider boot failure', 'PROVIDER_BOOT_FAILED', 'restart provider');
      const top = new Error('startup failed', { cause: root });

      const result = errorToJson(top);

      assert.equal(result.code, 'PROVIDER_BOOT_FAILED');
      const causes = result.causes as Array<Record<string, unknown>>;
      assert.equal(causes[0]?.code, 'PROVIDER_BOOT_FAILED');
    });

    it('redacts secrets from error messages and cause messages', () => {
      const err = new Error('provider failed with key=ABCDEFGHIJKLMNOPQRST', {
        cause: new Error('Bearer abcdefghijklmnopqrstuvwxyz123456'),
      });

      const result = errorToJson(err);

      assert.equal(result.message, 'provider failed with key=****');
      const causes = result.causes as Array<Record<string, unknown>>;
      assert.equal(causes[0]?.message, 'Bearer ****');
    });

    it('formats non-Error', () => {
      const result = errorToJson('just a string');
      assert.equal(result.error, true);
      assert.equal(result.message, 'just a string');
    });
  });
});
