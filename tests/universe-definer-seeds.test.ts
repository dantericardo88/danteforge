// universe-definer-seeds.test.ts — the cold-repo bootstrap seeds (ascend-frontier Phase A).
// seedProjectDescription / seedCompetitors must flow into the competitor scan non-interactively,
// and explicit state.competitors must always win over discovered seeds.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineUniverse, type UniverseDefinerOptions } from '../src/core/universe-definer.js';
import type { CompetitorComparison, CompetitorScanOptions } from '../src/core/competitor-scanner.js';
import type { ScoringDimension } from '../src/core/harsh-scorer.js';

const DIMS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security', 'uxPolish',
  'documentation', 'performance', 'maintainability', 'developerExperience',
  'autonomy', 'planningQuality', 'selfImprovement', 'specDrivenPipeline',
  'convergenceSelfHealing', 'tokenEconomy', 'ecosystemMcp',
  'enterpriseReadiness', 'communityAdoption',
  'contextEconomy', 'causalCoherence',
];

function makeComparison(): CompetitorComparison {
  const ourDimensions = Object.fromEntries(DIMS.map(d => [d, 50])) as Record<ScoringDimension, number>;
  const scores = Object.fromEntries(DIMS.map(d => [d, 60])) as Record<ScoringDimension, number>;
  return {
    projectName: 'my-project',
    competitors: [{ name: 'ToolA', url: '', description: 'Tool A', source: 'hardcoded' as const, scores }],
    ourDimensions,
    leaderboard: [{ name: 'ToolA', avgScore: 60, rank: 1 }],
    gapReport: DIMS.map(d => ({
      dimension: d, ourScore: 50, bestScore: 60, bestCompetitor: 'ToolA', delta: 10, severity: 'minor' as const,
    })),
    overallGap: 10,
    competitorSource: 'dev-tool-default',
    analysisTimestamp: new Date().toISOString(),
  };
}

function baseOpts(stateCompetitors: string[], capture: (o: CompetitorScanOptions) => void): UniverseDefinerOptions {
  return {
    cwd: '/tmp/universe-seeds-test',
    interactive: false,
    _loadState: async () => ({ project: 'my-project', competitors: stateCompetitors } as never),
    _scanCompetitors: async (o) => { capture(o); return makeComparison(); },
    _saveMatrix: async () => {},
    _loadMatrix: async () => null,
    _buildFeatureUniverse: async () => ({ generatedAt: '', projectName: 'my-project', competitors: [], features: [] } as never),
    _saveFeatureUniverse: async () => {},
  };
}

describe('defineUniverse — non-interactive bootstrap seeds', () => {
  it('seedProjectDescription + seedCompetitors flow into the competitor scan when state has none', async () => {
    let seen: CompetitorScanOptions | null = null;
    await defineUniverse({
      ...baseOpts([], (o) => { seen = o; }),
      seedProjectDescription: 'A CLI that forges agents',
      seedCompetitors: ['aider', 'continue.dev'],
    });
    assert.ok(seen, 'the scan ran');
    assert.equal(seen!.projectContext?.projectDescription, 'A CLI that forges agents');
    assert.deepEqual(seen!.projectContext?.userDefinedCompetitors, ['aider', 'continue.dev']);
  });

  it('explicit state.competitors WIN over seedCompetitors (configuration beats discovery)', async () => {
    let seen: CompetitorScanOptions | null = null;
    await defineUniverse({
      ...baseOpts(['cursor'], (o) => { seen = o; }),
      seedCompetitors: ['aider'],
    });
    assert.deepEqual(seen!.projectContext?.userDefinedCompetitors, ['cursor'],
      'discovered seeds must never override what the user configured');
  });

  it('without seeds, behavior is unchanged (description falls back to project name)', async () => {
    let seen: CompetitorScanOptions | null = null;
    await defineUniverse(baseOpts([], (o) => { seen = o; }));
    assert.equal(seen!.projectContext?.projectDescription, 'my-project');
    assert.equal(seen!.projectContext?.userDefinedCompetitors, undefined);
  });
});
