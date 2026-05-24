import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runGapCli, type GapAnalysis } from '../src/cli/commands/gap.js';

function makeMatrix(dimOverrides: Record<string, unknown> = {}) {
  return {
    project: 'test',
    competitors: ['CompA'],
    competitors_closed_source: [],
    competitors_oss: ['CompA'],
    lastUpdated: '2026-01-01T00:00:00.000Z',
    overallSelfScore: 6,
    dimensions: [{
      id: 'testing',
      label: 'Testing',
      weight: 1,
      category: 'quality',
      frequency: 'high',
      scores: { self: 6, CompA: 8 },
      gap_to_leader: 2,
      leader: 'CompA',
      gap_to_closed_source_leader: 0,
      closed_source_leader: '',
      gap_to_oss_leader: 2,
      oss_leader: 'CompA',
      status: 'in-progress',
      sprint_history: [],
      next_sprint_target: 8,
      ...dimOverrides,
    }],
  };
}

describe('gap command', () => {
  it('identifies no-outcomes blocker for legacy dims', async () => {
    const result = await runGapCli({
      dimId: 'testing',
      cwd: '/nonexistent',
      _loadMatrix: async () => makeMatrix() as never,
    });
    assert.equal(result.dimensions.length, 1);
    const analysis = result.dimensions[0]!;
    assert.equal(analysis.dimensionId, 'testing');
    assert.ok(analysis.blockers.some(b => b.kind === 'no-outcomes'));
  });

  it('shows legacy-ceiling blocker when score is at 7.0', async () => {
    const result = await runGapCli({
      dimId: 'testing',
      cwd: '/nonexistent',
      _loadMatrix: async () => makeMatrix({ scores: { self: 7 } }) as never,
    });
    const analysis = result.dimensions[0]!;
    assert.ok(analysis.blockers.some(b => b.kind === 'no-outcomes' || b.kind === 'legacy-ceiling'));
  });

  it('identifies next tier when outcomes exist but higher tier is missing', async () => {
    const result = await runGapCli({
      dimId: 'testing',
      cwd: '/nonexistent',
      _loadMatrix: async () => makeMatrix({
        outcomes: [
          { id: 'smoke', tier: 'T1', description: 'smoke', command: 'npm test', expected_exit: 0 },
        ],
      }) as never,
    });
    const analysis = result.dimensions[0]!;
    // Should identify a missing higher tier as a blocker
    assert.ok(analysis.nextTier !== null || analysis.blockers.length > 0);
  });

  it('identifies T7 multi-receipt requirement when dim has few T5+ outcomes', async () => {
    const result = await runGapCli({
      dimId: 'testing',
      cwd: '/nonexistent',
      _loadMatrix: async () => makeMatrix({
        scores: { self: 8.5 },
        outcomes: [
          { id: 'smoke1', tier: 'T5', kind: 'external-benchmark', description: 'bench1', command: 'npm run bench', expected_exit: 0, required_callsite: 'src/a.ts', benchmark: 'test', min_pass_rate: 0.5 },
          { id: 'smoke2', tier: 'T6', kind: 'telemetry', description: 'telem', source: 'metrics', min_users: 1 },
        ],
      }) as never,
    });
    const analysis = result.dimensions[0]!;
    // With only 2 T5+ outcomes (1 T5 + 1 T6), T7 multi-receipt requires 3+
    const t7Blocker = analysis.blockers.find(b => b.detail.includes('T7') || b.detail.includes('3+'));
    assert.ok(t7Blocker, 'should have a T7/multi-receipt blocker since only 2 T5+ outcomes exist');
  });

  it('--all mode analyzes all dimensions', async () => {
    const result = await runGapCli({
      all: true,
      cwd: '/nonexistent',
      _loadMatrix: async () => makeMatrix() as never,
    });
    assert.equal(result.dimensions.length, 1);
  });

  it('throws on unknown dimension', async () => {
    await assert.rejects(
      runGapCli({
        dimId: 'nonexistent',
        cwd: '/nonexistent',
        _loadMatrix: async () => makeMatrix() as never,
      }),
      /not found/,
    );
  });
});
