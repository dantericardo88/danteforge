import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { logger } from '../src/core/logger.js';
import type { LogLevel } from '../src/core/logger.js';

afterEach(() => {
  logger.setLevel('info');
});

describe('logger', () => {
  it('exports all log methods', () => {
    assert.strictEqual(typeof logger.info, 'function');
    assert.strictEqual(typeof logger.success, 'function');
    assert.strictEqual(typeof logger.warn, 'function');
    assert.strictEqual(typeof logger.error, 'function');
    assert.strictEqual(typeof logger.verbose, 'function');
  });

  it('exports level control methods', () => {
    assert.strictEqual(typeof logger.setLevel, 'function');
    assert.strictEqual(typeof logger.getLevel, 'function');
  });

  it('defaults to info level', () => {
    assert.strictEqual(logger.getLevel(), 'info');
  });

  it('can change log level', () => {
    logger.setLevel('error');
    assert.strictEqual(logger.getLevel(), 'error');
  });

  it('accepts all valid log levels', () => {
    const levels: LogLevel[] = ['silent', 'error', 'warn', 'info', 'verbose'];
    for (const level of levels) {
      logger.setLevel(level);
      assert.strictEqual(logger.getLevel(), level);
    }
  });
});
