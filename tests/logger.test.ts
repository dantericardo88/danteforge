import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import { logger } from '../src/core/logger.js';
import type { LogLevel } from '../src/core/logger.js';

afterEach(() => {
  logger.setLevel('info');
  logger.setStderr(false);
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

describe('logger — setStderr (stderr mode)', () => {
  let stderrChunks: string[] = [];
  let stdoutChunks: string[] = [];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origStdoutWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    stderrChunks = [];
    stdoutChunks = [];
    // @ts-expect-error — capturing writes for assertion
    process.stderr.write = (chunk: string) => { stderrChunks.push(String(chunk)); return true; };
    // @ts-expect-error — capturing writes for assertion
    process.stdout.write = (chunk: string) => { stdoutChunks.push(String(chunk)); return true; };
    logger.setStderr(false);
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    process.stdout.write = origStdoutWrite;
    logger.setStderr(false);
    logger.setLevel('info');
  });

  it('exports setStderr function', () => {
    assert.strictEqual(typeof logger.setStderr, 'function');
  });

  it('by default, info/success/warn go to stdout', () => {
    logger.info('test-info');
    logger.success('test-success');
    assert.ok(stdoutChunks.some(c => c.includes('test-info')));
    assert.ok(stdoutChunks.some(c => c.includes('test-success')));
    assert.ok(!stderrChunks.some(c => c.includes('test-info')));
  });

  it('setStderr(true) redirects info to stderr instead of stdout', () => {
    logger.setStderr(true);
    logger.info('redirected-info');
    assert.ok(stderrChunks.some(c => c.includes('redirected-info')));
    assert.ok(!stdoutChunks.some(c => c.includes('redirected-info')));
  });

  it('setStderr(true) redirects success and warn to stderr', () => {
    logger.setStderr(true);
    logger.success('redir-success');
    logger.warn('redir-warn');
    assert.ok(stderrChunks.some(c => c.includes('redir-success')));
    assert.ok(stderrChunks.some(c => c.includes('redir-warn')));
    assert.ok(!stdoutChunks.some(c => c.includes('redir-success')));
    assert.ok(!stdoutChunks.some(c => c.includes('redir-warn')));
  });

  it('setStderr(false) restores stdout routing', () => {
    logger.setStderr(true);
    logger.setStderr(false);
    logger.info('restored-stdout');
    assert.ok(stdoutChunks.some(c => c.includes('restored-stdout')));
    assert.ok(!stderrChunks.some(c => c.includes('restored-stdout')));
  });

  it('setLevel silent suppresses output even in stderr mode', () => {
    logger.setStderr(true);
    logger.setLevel('silent');
    logger.info('silent-in-stderr-mode');
    logger.warn('also-silent');
    assert.ok(!stderrChunks.some(c => c.includes('silent-in-stderr-mode')));
    assert.ok(!stderrChunks.some(c => c.includes('also-silent')));
  });
});
