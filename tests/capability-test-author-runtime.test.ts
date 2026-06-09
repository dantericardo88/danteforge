import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chooseTestScaffold, isProductionSrc, authorYardstickForDim, type AuthorRuntimeOptions } from '../src/matrix/engines/capability-test-author-runtime.js';

describe('chooseTestScaffold — deterministic, system-chosen (not agent-chosen) test + command', () => {
  test('JS/TS modules get a tsx test scaffold', () => {
    const s = chooseTestScaffold('src/core/foo.ts', 'planning_quality')!;
    assert.equal(s.testFilePath, 'tests/planning_quality.capability.test.ts');
    assert.match(s.command, /npx tsx --test tests\/planning_quality\.capability\.test\.ts/);
  });
  test('Rust/Python return null (honestly unsupported, not faked)', () => {
    assert.equal(chooseTestScaffold('src/endpoint/src/memory_inject.rs', 'd'), null);
    assert.equal(chooseTestScaffold('agent/foo.py', 'd'), null);
  });
});

describe('isProductionSrc — what the examiner is forbidden to touch', () => {
  test('production src is flagged; tests/config/state are not', () => {
    assert.equal(isProductionSrc('src/core/foo.ts'), true);
    assert.equal(isProductionSrc('packages/core/src/bar.rs'), true);
    assert.equal(isProductionSrc('tests/x.capability.test.ts'), false);
    assert.equal(isProductionSrc('src/core/foo.test.ts'), false);
    assert.equal(isProductionSrc('.danteforge/compete/matrix.json'), false);
  });
});

describe('authorYardstickForDim — real executor orchestration', () => {
  function opts(over: Partial<AuthorRuntimeOptions> = {}): AuthorRuntimeOptions {
    return {
      dimId: 'planning_quality', cwd: '/x', ladderBar: 'frontier bar', targetModule: 'src/core/foo.ts',
      wired: new Set(['foo']), hasLadder: true,
      dispatchExaminer: async () => ({ ranOk: true }),
      gitChanged: async () => ['tests/planning_quality.capability.test.ts'], // examiner wrote ONLY the test
      installCommand: async () => {},
      _exists: async () => true,          // the examiner produced the test
      _removeFile: async () => {},
      _run: async () => ({ exitCode: 1, output: 'AssertionError: expected behavior not implemented' }), // RED for a real reason
      ...over,
    };
  }

  test('installs when the examiner writes a real RED test touching no production code', async () => {
    let installed = '';
    const r = await authorYardstickForDim(opts({ installCommand: async (_d, c) => { installed = c; } }));
    assert.equal(r.installed, true, r.reason);
    assert.match(installed, /capability\.test\.ts/);
  });

  test('REJECTS + reverts when the examiner edited production code (isolation)', async () => {
    let removed = false;
    const r = await authorYardstickForDim(opts({
      gitChanged: async () => ['tests/planning_quality.capability.test.ts', 'src/core/foo.ts'],
      _removeFile: async () => { removed = true; },
    }));
    assert.equal(r.installed, false);
    assert.equal(removed, true);
    assert.match(r.reason, /production code/);
  });

  test('no install when the examiner produced no test file', async () => {
    const r = await authorYardstickForDim(opts({ _exists: async () => false }));
    assert.equal(r.installed, false);
  });

  test('unsupported language → honest decline, no dispatch', async () => {
    let dispatched = false;
    const r = await authorYardstickForDim(opts({ targetModule: 'src/x.rs', dispatchExaminer: async () => { dispatched = true; return { ranOk: true }; } }));
    assert.equal(r.installed, false);
    assert.equal(dispatched, false);
    assert.match(r.reason, /not yet supported/);
  });

  test('REJECTS a GREEN candidate (examiner wrote a test that already passes)', async () => {
    const r = await authorYardstickForDim(opts({ _run: async () => ({ exitCode: 0, output: '' }) }));
    assert.equal(r.installed, false);
  });
});
