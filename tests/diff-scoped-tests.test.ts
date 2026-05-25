// Tests for src/matrix/courts/diff-scoped-tests.ts
//
// Pure injection-seam tests — no real fs walk needed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectTestsForDiff } from '../src/matrix/courts/diff-scoped-tests.js';

const FAKE_TESTS = [
  'tests/foo.test.ts',
  'tests/foo-edge.test.ts',
  'tests/bar.test.ts',
  'tests/matrix/baz.test.ts',
  'tests/matrix/critical-flow.test.ts',
  'tests/integration/wide-scope.test.ts',
  'tests/side-effect-import.test.ts',
  'tests/matrix-golden-flow.test.ts',
  'tests/command-skill-coverage.test.ts',
  'tests/unrelated.test.ts',
];

function fakeReader(map: Record<string, string>) {
  return async (p: string): Promise<string> => {
    const key = p.replace(/\\/g, '/').replace(/^.+?\/tests\//, 'tests/');
    if (map[key] !== undefined) return map[key];
    throw Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
  };
}

describe('selectTestsForDiff', () => {
  it('finds direct basename matches', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['src/core/foo.ts'],
      cwd: '/fake/cwd',
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({}),
    });
    assert.ok(result.includes('tests/foo.test.ts'), 'should match foo.test.ts');
  });

  it('finds prefix matches (foo-*.test.ts when foo.ts changed)', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['src/core/foo.ts'],
      cwd: '/fake/cwd',
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({}),
    });
    assert.ok(result.includes('tests/foo-edge.test.ts'), 'should match foo-edge.test.ts');
  });

  it('finds tests that import the changed source via import-graph', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['src/core/bar.ts'],
      cwd: '/fake/cwd',
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({
        'tests/integration/wide-scope.test.ts': `import { something } from '../../src/core/bar.js';\nimport assert from 'node:assert';`,
        'tests/unrelated.test.ts': `import { other } from '../src/core/other.js';`,
      }),
    });
    assert.ok(result.includes('tests/integration/wide-scope.test.ts'), 'should pull in integration test that imports bar');
    assert.ok(!result.includes('tests/unrelated.test.ts'), 'should NOT pull in unrelated test');
  });

  it('finds side-effect imports of changed source files', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['src/core/bootstrap.ts'],
      cwd: '/fake/cwd',
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({
        'tests/side-effect-import.test.ts': `import '../src/core/bootstrap.js';\nimport assert from 'node:assert/strict';`,
      }),
    });

    assert.ok(result.includes('tests/side-effect-import.test.ts'), 'should pull tests with static side-effect imports');
  });

  it('includes always-run patterns regardless of diff', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['src/core/foo.ts'],
      cwd: '/fake/cwd',
      alwaysRun: ['tests/matrix-golden-flow.test.ts', 'tests/command-skill-coverage.test.ts'],
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({}),
    });
    assert.ok(result.includes('tests/matrix-golden-flow.test.ts'));
    assert.ok(result.includes('tests/command-skill-coverage.test.ts'));
  });

  it('supports glob patterns in always-run entries', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['src/core/foo.ts'],
      cwd: '/fake/cwd',
      alwaysRun: ['tests/matrix/*.test.ts'],
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({}),
    });

    assert.ok(result.includes('tests/matrix/baz.test.ts'));
    assert.ok(result.includes('tests/matrix/critical-flow.test.ts'));
  });

  it('returns only always-run when changedFiles is empty', async () => {
    const result = await selectTestsForDiff({
      changedFiles: [],
      cwd: '/fake/cwd',
      alwaysRun: ['tests/matrix-golden-flow.test.ts'],
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({}),
    });
    assert.deepEqual(result, ['tests/matrix-golden-flow.test.ts']);
  });

  it('returns empty array when no diff and no always-run', async () => {
    const result = await selectTestsForDiff({
      changedFiles: [],
      cwd: '/fake/cwd',
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({}),
    });
    assert.deepEqual(result, []);
  });

  it('ignores .test.ts files in changedFiles (a test cannot be its own source)', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['tests/foo.test.ts'],
      cwd: '/fake/cwd',
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({}),
    });
    assert.deepEqual(result, [], 'changed test files do not generate basename matches against themselves');
  });

  it('ignores .d.ts and non-ts files', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['src/core/types.d.ts', 'README.md', 'src/core/foo.ts'],
      cwd: '/fake/cwd',
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({}),
    });
    assert.ok(result.includes('tests/foo.test.ts'));
    assert.equal(result.filter(r => r.includes('types')).length, 0);
  });

  it('deduplicates when a test matches both direct AND import-graph paths', async () => {
    const result = await selectTestsForDiff({
      changedFiles: ['src/core/foo.ts'],
      cwd: '/fake/cwd',
      _listTests: async () => FAKE_TESTS,
      _readFile: fakeReader({
        'tests/foo.test.ts': `import { foo } from '../src/core/foo.js';`,
      }),
    });
    const fooMatches = result.filter(r => r === 'tests/foo.test.ts');
    assert.equal(fooMatches.length, 1, 'should not duplicate');
  });
});
