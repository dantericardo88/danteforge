import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineUniverse, type UniverseDefinerOptions } from '../src/core/universe-definer.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { CompetitorComparison } from '../src/core/competitor-scanner.js';
import type { ScoringDimension } from '../src/core/harsh-scorer.js';

const DIMS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security', 'uxPolish',
  'documentation', 'performance', 'maintainability', 'developerExperience',
  'autonomy', 'planningQuality', 'selfImprovement', 'specDrivenPipeline',
  'convergenceSelfHealing', 'tokenEconomy', 'ecosystemMcp',
  'enterpriseReadiness', 'communityAdoption',
];

function makeComparison(): CompetitorComparison {
  const ourDimensions = Object.fromEntries(DIMS.map(d => [d, 50])) as Record<ScoringDimension, number>;
  const scores = Object.fromEntries(DIMS.map(d => [d, 60])) as Record<ScoringDimension, number>;
  return {
    projectName: 'my-project',
    competitors: [{
      name: 'ToolA', url: '', description: 'Tool A', source: 'hardcoded' as const, scores,
    }],
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

function makeMinimalMatrix(project = 'test'): CompeteMatrix {
  return {
    project,
    competitors: ['ToolA'],
    competitors_closed_source: [],
    competitors_oss: ['ToolA'],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 5.0,
    dimensions: [],
  };
}

function noopOpts(matrixOverrides?: Partial<CompeteMatrix>): UniverseDefinerOptions {
  return {
    cwd: '/tmp/test',
    interactive: false,
    _loadState: async () => ({
      project: 'my-project',
      competitors: [],
      currentPhase: 1,
      workflowStage: 'tasks',
      tasks: {},
      auditLog: [],
      profile: '',
      lastHandoff: '',
    } as any),
    _scanCompetitors: async () => makeComparison(),
    _saveMatrix: async () => {},
    _loadMatrix: async () => makeMinimalMatrix(matrixOverrides?.project),
  };
}

describe('defineUniverse: non-interactive mode', () => {
  it('returns a CompeteMatrix object', async () => {
    const matrix = await defineUniverse(noopOpts());
    assert.ok(typeof matrix === 'object');
    assert.ok(typeof matrix.project === 'string');
    assert.ok(Array.isArray(matrix.dimensions));
  });

  it('uses project name from loaded state', async () => {
    const matrix = await defineUniverse(noopOpts());
    assert.equal(matrix.project, 'my-project');
  });

  it('calls saveMatrix to persist result', async () => {
    let saved = false;
    const opts: UniverseDefinerOptions = {
      ...noopOpts(),
      _saveMatrix: async () => { saved = true; },
    };
    await defineUniverse(opts);
    assert.ok(saved);
  });

  it('does not call _askQuestion in non-interactive mode', async () => {
    let asked = false;
    const opts: UniverseDefinerOptions = {
      ...noopOpts(),
      interactive: false,
      _askQuestion: async () => { asked = true; return 'answer'; },
    };
    await defineUniverse(opts);
    assert.ok(!asked);
  });

  it('matrix dimensions have expected shape', async () => {
    const matrix = await defineUniverse(noopOpts());
    assert.ok(Array.isArray(matrix.competitors));
    assert.ok(typeof matrix.lastUpdated === 'string');
    assert.ok(typeof matrix.overallSelfScore === 'number');
  });
});

describe('defineUniverse: interactive mode', () => {
  it('calls _askQuestion for each of 5 questions', async () => {
    let callCount = 0;
    const opts: UniverseDefinerOptions = {
      cwd: '/tmp/test',
      interactive: true,
      _askQuestion: async (_q, def) => { callCount++; return def ?? ''; },
      _loadState: async () => ({
        project: 'my-project',
        competitors: [],
        currentPhase: 1,
        workflowStage: 'tasks',
        tasks: {},
        auditLog: [],
        profile: '',
        lastHandoff: '',
      } as any),
      _scanCompetitors: async () => makeComparison(),
      _saveMatrix: async () => {},
      _loadMatrix: async () => null,
    };
    await defineUniverse(opts);
    assert.equal(callCount, 5);
  });
});
