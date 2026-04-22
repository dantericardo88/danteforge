import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIMPLE_CONSTITUTION_TEMPLATE,
  quickstart,
  type QuickstartOptions,
} from '../src/cli/commands/quickstart.js';

describe('SIMPLE_CONSTITUTION_TEMPLATE', () => {
  it('includes the project name', () => {
    const tmpl = SIMPLE_CONSTITUTION_TEMPLATE('my-project');
    assert.ok(tmpl.includes('my-project'));
  });

  it('starts with # Project Constitution heading', () => {
    const tmpl = SIMPLE_CONSTITUTION_TEMPLATE('test-app');
    assert.ok(tmpl.includes('# Project Constitution'));
  });

  it('mentions test coverage', () => {
    const tmpl = SIMPLE_CONSTITUTION_TEMPLATE('app');
    assert.ok(tmpl.toLowerCase().includes('test'));
  });

  it('returns non-empty string for empty project name', () => {
    const tmpl = SIMPLE_CONSTITUTION_TEMPLATE('');
    assert.ok(tmpl.length > 0);
  });

  it('is deterministic', () => {
    const a = SIMPLE_CONSTITUTION_TEMPLATE('foo');
    const b = SIMPLE_CONSTITUTION_TEMPLATE('foo');
    assert.equal(a, b);
  });
});

describe('quickstart', () => {
  function makeOpts(overrides: Partial<QuickstartOptions> = {}): QuickstartOptions {
    return {
      nonInteractive: true,
      simple: true,
      projectName: 'test-project',
      idea: 'Build a todo app',
      _isTTY: false,
      _isLLMAvailable: async () => false,
      _runInit: async () => {},
      _runConstitution: async () => {},
      _runSpark: async (_goal) => {},
      _readFile: async () => '{"name":"test-project"}',
      _scoreArtifacts: async () => 75,
      _writeFile: async () => {},
      _stdout: () => {},
      ...overrides,
    };
  }

  it('completes without throwing in non-interactive simple mode', async () => {
    await assert.doesNotReject(() => quickstart(makeOpts()));
  });

  it('calls _writeFile for constitution in simple mode', async () => {
    let writtenPath = '';
    await quickstart(makeOpts({
      _writeFile: async (p) => { writtenPath = p; },
    }));
    assert.ok(writtenPath.includes('CONSTITUTION.md'));
  });

  it('calls _runInit in non-simple mode', async () => {
    let initCalled = false;
    await quickstart(makeOpts({
      simple: false,
      nonInteractive: true,
      _runInit: async () => { initCalled = true; },
    }));
    assert.ok(initCalled);
  });

  it('calls _runConstitution in non-simple mode', async () => {
    let constitutionCalled = false;
    await quickstart(makeOpts({
      simple: false,
      nonInteractive: true,
      _runConstitution: async () => { constitutionCalled = true; },
    }));
    assert.ok(constitutionCalled);
  });

  it('handles _runInit failure gracefully in non-simple mode', async () => {
    await assert.doesNotReject(() =>
      quickstart(makeOpts({
        simple: false,
        nonInteractive: true,
        _runInit: async () => { throw new Error('init failed'); },
      }))
    );
  });

  it('calls _runSpark with idea in non-simple non-interactive mode', async () => {
    let sparkGoal = '';
    await quickstart(makeOpts({
      simple: false,
      nonInteractive: true,
      idea: 'Build a weather app',
      _runSpark: async (goal) => { sparkGoal = goal; },
    }));
    assert.ok(sparkGoal.includes('weather'));
  });
});
