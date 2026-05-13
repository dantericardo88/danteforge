// Tests for src/matrix/courts/verify-test-config.ts
//
// Pure injection-seam tests — no real fs needed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadVerifyTestConfig,
  buildSkipPatternEnv,
  getDefaultVerifyTestConfig,
} from '../src/matrix/courts/verify-test-config.js';

describe('loadVerifyTestConfig', () => {
  it('returns defaults when the file does not exist', async () => {
    const result = await loadVerifyTestConfig({
      cwd: '/fake/cwd',
      _readFile: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    });
    assert.deepEqual(result.knownFlaky, []);
    assert.ok(result.alwaysRun.includes('tests/matrix-golden-flow.test.ts'));
    assert.equal(result.scopeToDiff, false);
  });

  it('merges parsed JSON with defaults', async () => {
    const result = await loadVerifyTestConfig({
      cwd: '/fake/cwd',
      _readFile: async () => JSON.stringify({
        knownFlaky: ['tests/foo.test.ts > flaky case'],
        scopeToDiff: true,
      }),
    });
    assert.deepEqual(result.knownFlaky, ['tests/foo.test.ts > flaky case']);
    assert.equal(result.scopeToDiff, true);
    assert.ok(result.alwaysRun.includes('tests/command-skill-coverage.test.ts'), 'falls back to default alwaysRun');
  });

  it('honors caller-provided alwaysRun (does not auto-merge)', async () => {
    const result = await loadVerifyTestConfig({
      cwd: '/fake/cwd',
      _readFile: async () => JSON.stringify({
        alwaysRun: ['tests/critical.test.ts'],
      }),
    });
    assert.deepEqual(result.alwaysRun, ['tests/critical.test.ts']);
  });

  it('throws a clear error on malformed JSON', async () => {
    await assert.rejects(
      loadVerifyTestConfig({
        cwd: '/fake/cwd',
        _readFile: async () => '{ this is not json',
      }),
      /not valid JSON/,
    );
  });

  it('handles partial JSON gracefully', async () => {
    const result = await loadVerifyTestConfig({
      cwd: '/fake/cwd',
      _readFile: async () => '{}',
    });
    assert.deepEqual(result, getDefaultVerifyTestConfig());
  });
});

describe('buildSkipPatternEnv', () => {
  it('returns empty string when no skips configured', () => {
    const config = getDefaultVerifyTestConfig();
    assert.equal(buildSkipPatternEnv(config), '');
  });

  it('joins multiple patterns with pipe', () => {
    const config = { knownFlaky: ['pattern1', 'pattern2', 'pattern3'], alwaysRun: [], scopeToDiff: false };
    assert.equal(buildSkipPatternEnv(config), 'pattern1|pattern2|pattern3');
  });
});
