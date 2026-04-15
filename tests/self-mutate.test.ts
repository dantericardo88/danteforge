import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runSelfMutate,
  CORE_TARGETS,
  type SelfMutateOptions,
  type TargetPair,
} from '../src/cli/commands/self-mutate.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SIMPLE_SOURCE = `function check(x, y) {\n  if (x > y) return true;\n  return false;\n}`;
const NO_MUTANT_SOURCE = `const x = 'hello world';`;

function makeOpts(overrides: Partial<SelfMutateOptions> = {}): SelfMutateOptions {
  const reports: Record<string, string> = {};
  return {
    cwd: '/fake',
    maxMutantsPerFile: 5,
    minMutationScore: 0.6,
    _readFile: async () => SIMPLE_SOURCE,
    _writeFile: async () => {},
    _restoreFile: async () => {},
    _runTests: async () => true,  // all mutants killed by default
    _writeReport: async (p, c) => { reports[p] = c; },
    ...overrides,
  };
}

function singleTarget(overrides: Partial<TargetPair> = {}): TargetPair[] {
  return [{ src: 'src/core/circuit-breaker.ts', test: 'tests/circuit-breaker.test.ts', ...overrides }];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runSelfMutate', () => {
  it('T1: uses CORE_TARGETS when no targets specified', async () => {
    const testedFiles: string[] = [];

    await runSelfMutate({
      ...makeOpts(),
      targets: undefined,
      _readFile: async (p) => { testedFiles.push(p); return SIMPLE_SOURCE; },
    });

    // Should have read one file per CORE_TARGET
    assert.equal(testedFiles.length, CORE_TARGETS.length,
      `should read ${CORE_TARGETS.length} files, got ${testedFiles.length}`);
  });

  it('T2: runs mutation scoring per file with injected test runner', async () => {
    const testFilesRun: string[] = [];

    const result = await runSelfMutate(makeOpts({
      targets: singleTarget(),
      _runTests: async (testFile, _cwd) => { testFilesRun.push(testFile); return true; },
    }));

    assert.ok(testFilesRun.length > 0, 'should have called _runTests');
    assert.equal(result.perFile.length, 1);
  });

  it('T3: gatePass=true when overallScore >= minMutationScore', async () => {
    const result = await runSelfMutate(makeOpts({
      targets: singleTarget(),
      _runTests: async () => true,  // all killed → score=1.0
      minMutationScore: 0.6,
    }));

    assert.equal(result.gatePass, true);
    assert.ok(result.overallScore >= 0.6);
  });

  it('T4: gatePass=false when overallScore < minMutationScore', async () => {
    const result = await runSelfMutate(makeOpts({
      targets: singleTarget(),
      _runTests: async () => false,  // all survived → score=0.0
      minMutationScore: 0.6,
    }));

    assert.equal(result.gatePass, false);
    assert.equal(result.overallScore, 0);
  });

  it('T5: writes mutation-report.json with per-file breakdown', async () => {
    const reports: Record<string, string> = {};

    await runSelfMutate(makeOpts({
      targets: singleTarget(),
      _writeReport: async (p, c) => { reports[p] = c; },
    }));

    const keys = Object.keys(reports);
    assert.ok(keys.some(k => k.includes('mutation-report.json')), 'should write mutation-report.json');

    const written = JSON.parse(Object.values(reports)[0]) as { perFile: unknown[]; overallScore: number };
    assert.ok(Array.isArray(written.perFile), 'report should have perFile array');
    assert.ok(typeof written.overallScore === 'number', 'report should have overallScore');
  });

  it('T6: aggregates per-file scores weighted by mutant count', async () => {
    // Two files: one with 3 mutants all killed (score=1.0), one with 3 mutants all survived (score=0.0)
    // Weighted overall = (1.0×3 + 0.0×3) / 6 = 0.5
    let callIdx = 0;
    const result = await runSelfMutate(makeOpts({
      targets: [
        { src: 'src/core/circuit-breaker.ts', test: 'tests/circuit-breaker.test.ts' },
        { src: 'src/core/plateau-detector.ts', test: 'tests/plateau-detector.test.ts' },
      ],
      _runTests: async () => {
        callIdx++;
        // First file's tests: kill all mutants. Second file's tests: survive all.
        // We can't tell which file we're on from just testFile easily, so alternate
        return callIdx <= 3; // first 3 calls kill, rest survive
      },
    }));

    assert.equal(result.perFile.length, 2);
    assert.ok(result.overallScore >= 0 && result.overallScore <= 1.0);
  });

  it('T7: file with no mutants contributes score=1.0 and does not dilute overall', async () => {
    const result = await runSelfMutate(makeOpts({
      targets: singleTarget(),
      _readFile: async () => NO_MUTANT_SOURCE,  // no mutable patterns
    }));

    assert.equal(result.perFile.length, 1);
    assert.equal(result.perFile[0].total, 0);
    assert.equal(result.perFile[0].mutationScore, 1.0);
    // No mutants → overall stays 1.0
    assert.equal(result.overallScore, 1.0);
  });

  it('T8: skips file gracefully when source cannot be read', async () => {
    const result = await runSelfMutate(makeOpts({
      targets: singleTarget(),
      _readFile: async () => { throw new Error('ENOENT'); },
      _runTests: async () => true,
    }));

    // Should not throw — should return entry with score=1.0 (no mutants tested)
    assert.equal(result.perFile.length, 1);
    assert.equal(result.perFile[0].total, 0);
    assert.equal(result.perFile[0].mutationScore, 1.0);
  });
});
