import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withErrorBoundary } from '../src/core/cli-error-boundary.js';
import { DanteError, ConfigError, NetworkError } from '../src/core/errors.js';
import { GateError } from '../src/core/gates.js';

function makeCapturingLogger() {
  const calls: { level: string; msg: string }[] = [];
  return {
    logger: {
      error: (msg: string) => calls.push({ level: 'error', msg }),
      verbose: (msg: string) => calls.push({ level: 'verbose', msg }),
      info: (msg: string) => calls.push({ level: 'info', msg }),
      warn: (msg: string) => calls.push({ level: 'warn', msg }),
      success: (msg: string) => calls.push({ level: 'success', msg }),
      setLevel: () => {},
      getLevel: () => 'info' as const,
    },
    calls,
  };
}

describe('withErrorBoundary', () => {
  let savedExitCode: number | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  it('success path — no error, exitCode not set', async () => {
    const { logger } = makeCapturingLogger();
    await withErrorBoundary('test-cmd', async () => {
      // no-op success
    }, { _logger: logger as any });

    assert.equal(process.exitCode, undefined);
    process.exitCode = savedExitCode;
  });

  it('GateError — logs gate message + remedy', async () => {
    const { logger, calls } = makeCapturingLogger();
    await withErrorBoundary('test-cmd', async () => {
      throw new GateError('spec missing', 'requireSpec', 'run danteforge specify');
    }, { _logger: logger as any });

    const errorMsgs = calls.filter(c => c.level === 'error');
    assert.ok(errorMsgs.some(c => c.msg.includes('Gate blocked')));
    assert.ok(errorMsgs.some(c => c.msg.includes('spec missing')));
    assert.ok(errorMsgs.some(c => c.msg.includes('Remedy')));
    assert.equal(process.exitCode, 1);
    process.exitCode = savedExitCode;
  });

  it('DanteError — logs code + message + remedy', async () => {
    const { logger, calls } = makeCapturingLogger();
    await withErrorBoundary('test-cmd', async () => {
      throw new ConfigError('missing key');
    }, { _logger: logger as any });

    const errorMsgs = calls.filter(c => c.level === 'error');
    assert.ok(errorMsgs.some(c => c.msg.includes('CONFIG_ERROR')));
    assert.ok(errorMsgs.some(c => c.msg.includes('missing key')));
    assert.ok(errorMsgs.some(c => c.msg.includes('Remedy')));
    assert.equal(process.exitCode, 1);
    process.exitCode = savedExitCode;
  });

  it('Generic Error — logs "Unexpected error in <name>"', async () => {
    const { logger, calls } = makeCapturingLogger();
    await withErrorBoundary('my-command', async () => {
      throw new Error('something went wrong');
    }, { _logger: logger as any });

    const errorMsgs = calls.filter(c => c.level === 'error');
    assert.ok(errorMsgs.some(c => c.msg.includes('Unexpected error in "my-command"')));
    assert.ok(errorMsgs.some(c => c.msg.includes('something went wrong')));
    assert.equal(process.exitCode, 1);
    process.exitCode = savedExitCode;
  });

  it('Non-Error throw — logs stringified value', async () => {
    const { logger, calls } = makeCapturingLogger();
    await withErrorBoundary('test-cmd', async () => {
      throw 'raw string error';
    }, { _logger: logger as any });

    const errorMsgs = calls.filter(c => c.level === 'error');
    assert.ok(errorMsgs.some(c => c.msg.includes('raw string error')));
    assert.equal(process.exitCode, 1);
    process.exitCode = savedExitCode;
  });

  it('sets process.exitCode = 1 on error', async () => {
    const { logger } = makeCapturingLogger();
    await withErrorBoundary('test-cmd', async () => {
      throw new NetworkError('offline');
    }, { _logger: logger as any });

    assert.equal(process.exitCode, 1);
    process.exitCode = savedExitCode;
  });

  it('shows stack in verbose mode', async () => {
    const { logger, calls } = makeCapturingLogger();
    await withErrorBoundary('test-cmd', async () => {
      throw new Error('boom');
    }, { _logger: logger as any, _verbose: true });

    const verboseMsgs = calls.filter(c => c.level === 'verbose');
    assert.ok(verboseMsgs.length > 0, 'should have verbose log entries');
    assert.ok(verboseMsgs.some(c => c.msg.includes('Error: boom')));
    assert.equal(process.exitCode, 1);
    process.exitCode = savedExitCode;
  });

  it('does not show stack when not verbose', async () => {
    const { logger, calls } = makeCapturingLogger();
    await withErrorBoundary('test-cmd', async () => {
      throw new Error('boom');
    }, { _logger: logger as any, _verbose: false });

    const verboseMsgs = calls.filter(c => c.level === 'verbose');
    assert.equal(verboseMsgs.length, 0, 'should have no verbose log entries');
    process.exitCode = savedExitCode;
  });

  it('DanteError with empty remedy does not log remedy line', async () => {
    const { logger, calls } = makeCapturingLogger();
    const err = new DanteError('test', 'CODE', '');
    await withErrorBoundary('test-cmd', async () => {
      throw err;
    }, { _logger: logger as any });

    const errorMsgs = calls.filter(c => c.level === 'error');
    assert.ok(errorMsgs.some(c => c.msg.includes('[CODE]')));
    assert.ok(!errorMsgs.some(c => c.msg.includes('Remedy')));
    process.exitCode = savedExitCode;
  });
});
