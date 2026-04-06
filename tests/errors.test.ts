import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DanteError,
  ConfigError,
  ValidationError,
  FileError,
  NetworkError,
  CLIError,
  LLMError,
  BudgetError,
} from '../src/core/errors.js';

describe('DanteError base class', () => {
  it('constructs with message, code, and remedy', () => {
    const err = new DanteError('something broke', 'TEST_CODE', 'fix it');
    assert.equal(err.message, 'something broke');
    assert.equal(err.code, 'TEST_CODE');
    assert.equal(err.remedy, 'fix it');
    assert.equal(err.name, 'DanteError');
  });

  it('is instanceof Error', () => {
    const err = new DanteError('msg', 'CODE', 'remedy');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof DanteError);
  });
});

describe('ConfigError', () => {
  it('has correct name and code', () => {
    const err = new ConfigError('bad config');
    assert.equal(err.name, 'ConfigError');
    assert.equal(err.code, 'CONFIG_ERROR');
  });

  it('uses default remedy', () => {
    const err = new ConfigError('bad config');
    assert.ok(err.remedy.includes('config.yaml'));
  });

  it('accepts custom remedy', () => {
    const err = new ConfigError('bad', 'try this');
    assert.equal(err.remedy, 'try this');
  });

  it('is instanceof DanteError and Error', () => {
    const err = new ConfigError('x');
    assert.ok(err instanceof DanteError);
    assert.ok(err instanceof Error);
  });
});

describe('ValidationError', () => {
  it('has correct name and code', () => {
    const err = new ValidationError('invalid input');
    assert.equal(err.name, 'ValidationError');
    assert.equal(err.code, 'VALIDATION_ERROR');
  });

  it('uses default remedy', () => {
    const err = new ValidationError('bad');
    assert.ok(err.remedy.includes('input'));
  });

  it('is instanceof DanteError', () => {
    assert.ok(new ValidationError('x') instanceof DanteError);
  });
});

describe('FileError', () => {
  it('has correct name and code', () => {
    const err = new FileError('not found', '/tmp/foo.txt');
    assert.equal(err.name, 'FileError');
    assert.equal(err.code, 'FILE_ERROR');
  });

  it('stores filePath', () => {
    const err = new FileError('not found', '/tmp/foo.txt');
    assert.equal(err.filePath, '/tmp/foo.txt');
  });

  it('builds default remedy from filePath', () => {
    const err = new FileError('not found', '/tmp/foo.txt');
    assert.ok(err.remedy.includes('/tmp/foo.txt'));
  });

  it('accepts custom remedy', () => {
    const err = new FileError('not found', '/x', 'create the file');
    assert.equal(err.remedy, 'create the file');
  });

  it('is instanceof DanteError', () => {
    assert.ok(new FileError('x', '/y') instanceof DanteError);
  });
});

describe('NetworkError', () => {
  it('has correct name and code', () => {
    const err = new NetworkError('timeout');
    assert.equal(err.name, 'NetworkError');
    assert.equal(err.code, 'NETWORK_ERROR');
  });

  it('uses default remedy', () => {
    const err = new NetworkError('timeout');
    assert.ok(err.remedy.includes('internet'));
  });

  it('is instanceof DanteError', () => {
    assert.ok(new NetworkError('x') instanceof DanteError);
  });
});

describe('CLIError', () => {
  it('has correct name and code', () => {
    const err = new CLIError('bad arg');
    assert.equal(err.name, 'CLIError');
    assert.equal(err.code, 'CLI_ERROR');
  });

  it('stores exitCode with default of 1', () => {
    const err = new CLIError('bad arg');
    assert.equal(err.exitCode, 1);
  });

  it('stores custom exitCode', () => {
    const err = new CLIError('bad arg', 2);
    assert.equal(err.exitCode, 2);
  });

  it('is instanceof DanteError', () => {
    assert.ok(new CLIError('x') instanceof DanteError);
  });
});

describe('LLMError', () => {
  it('has correct name and code', () => {
    const err = new LLMError('failed');
    assert.equal(err.name, 'LLMError');
    assert.equal(err.code, 'LLM_ERROR');
  });

  it('stores provider', () => {
    const err = new LLMError('failed', 'claude');
    assert.equal(err.provider, 'claude');
  });

  it('builds default remedy from provider', () => {
    const err = new LLMError('failed', 'grok');
    assert.ok(err.remedy.includes('grok'));
  });

  it('uses generic remedy when no provider', () => {
    const err = new LLMError('failed');
    assert.ok(err.remedy.includes('LLM'));
  });

  it('accepts custom remedy', () => {
    const err = new LLMError('failed', 'claude', 'restart');
    assert.equal(err.remedy, 'restart');
  });

  it('is instanceof DanteError', () => {
    assert.ok(new LLMError('x') instanceof DanteError);
  });
});

describe('BudgetError', () => {
  it('has correct name and code', () => {
    const err = new BudgetError('over budget');
    assert.equal(err.name, 'BudgetError');
    assert.equal(err.code, 'BUDGET_ERROR');
  });

  it('uses default remedy', () => {
    const err = new BudgetError('over budget');
    assert.ok(err.remedy.includes('ember'));
  });

  it('is instanceof DanteError', () => {
    assert.ok(new BudgetError('x') instanceof DanteError);
  });
});
