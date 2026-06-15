// Phase-0 regression pin: `compete --report` crashed with "Cannot read properties of undefined
// (reading 'length')" on any matrix containing a dimension without a sprint_history field (universe /
// competitor-derived dims and hand-edited matrices omit it). actionReport now null-guards all three
// sprint_history reads. (Kept in its own file so it stays well under the 750-line cap.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { actionReport } from '../src/cli/commands/compete-reports.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';
import type { CompeteOptions } from '../src/cli/commands/compete.js';

function dim(over: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id: 'a', label: 'A', weight: 1, category: 'quality', frequency: 'medium',
    scores: { self: 6, cursor: 8 }, gap_to_leader: 2, leader: 'cursor',
    gap_to_closed_source_leader: 2, closed_source_leader: 'cursor',
    gap_to_oss_leader: 0, oss_leader: 'unknown', status: 'in-progress',
    sprint_history: [], next_sprint_target: 7,
    ...over,
  } as MatrixDimension;
}

function matrixWith(d: MatrixDimension): CompeteMatrix {
  return {
    project: 'TestProject', competitors: ['cursor'], competitors_closed_source: ['cursor'],
    competitors_oss: [], lastUpdated: '2026-06-15T00:00:00.000Z', overallSelfScore: 6,
    dimensions: [d],
  } as CompeteMatrix;
}

describe('actionReport — null-safe over a dimension missing sprint_history (Phase-0 crash fix)', () => {
  it('does not crash when sprint_history is undefined; still produces a report', async () => {
    const d = dim();
    delete (d as Partial<MatrixDimension>).sprint_history; // the field universe/derived dims omit
    let written = '';
    const r = await actionReport(
      { _loadMatrix: async () => matrixWith(d), _writeReport: async (c: string) => { written = c; } } as unknown as CompeteOptions,
      '/tmp/does-not-matter',
    );
    assert.strictEqual(r.action, 'report');
    assert.ok(written.includes('Gap Matrix'), 'a report was still produced');
    assert.ok(/sprints completed/.test(written), 'sprint count rendered without throwing');
  });

  it('a dimension WITH sprint_history still renders the trend + history', async () => {
    const d = dim({ sprint_history: [{ date: '2026-06-10', before: 5, after: 6, commit: 'abc1234' }] as MatrixDimension['sprint_history'] });
    let written = '';
    await actionReport(
      { _loadMatrix: async () => matrixWith(d), _writeReport: async (c: string) => { written = c; } } as unknown as CompeteOptions,
      '/tmp/does-not-matter',
    );
    assert.ok(/Sprint History/.test(written));
    assert.ok(written.includes('abc1234'), 'the sprint commit is rendered');
  });
});
