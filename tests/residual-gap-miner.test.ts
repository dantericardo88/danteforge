import { describe, it } from 'node:test';
import assert from 'node:assert';
import { analyzeResidualGaps } from '../src/core/residual-gap-miner.js';

describe('ResidualGapMiner', () => {
  it('should detect missing evidence', () => {
    const bundle = {
      reads: [],
      writes: [],
      commands: [],
      tests: [],
      gates: [],
      plan: {},
      verdict: { status: 'success' }
    } as any;

    const state = {} as any;

    const report = analyzeResidualGaps(bundle, state);

    assert(report.analysis.confirmedGaps.length > 0);
    assert(report.analysis.score < 50);
    assert(report.recommendations.length > 0);
  });

  it('should pass complete evidence', () => {
    const bundle = {
      reads: [{ path: '/file1' }],
      writes: [{ path: '/file2' }],
      commands: [{ exitCode: 0 }],
      tests: [{ status: 'pass' }],
      gates: [{ status: 'pass' }],
      plan: { tasks: ['task1'] },
      verdict: { status: 'success' }
    } as any;

    const state = {} as any;

    const report = analyzeResidualGaps(bundle, state);

    assert.strictEqual(report.analysis.confirmedGaps.length, 0);
    assert(report.analysis.score >= 80);
  });

  it('should detect failing tests', () => {
    const bundle = {
      reads: [{ path: '/file1' }],
      writes: [{ path: '/file2' }],
      commands: [{ exitCode: 0 }],
      tests: [{ status: 'fail' }, { status: 'pass' }],
      gates: [{ status: 'pass' }],
      plan: { tasks: ['task1'] },
      verdict: { status: 'success' }
    } as any;

    const state = {} as any;

    const report = analyzeResidualGaps(bundle, state);

    assert(report.analysis.confirmedGaps.some(gap => gap.includes('test pass rate')));
    assert(report.analysis.score < 80);
  });
});