import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineUniverse, type UniverseDefinerOptions } from '../src/core/universe-definer.js';
import { computeUnweightedComposite, HUMAN_ACTION_DIMENSION_IDS, type CompeteMatrix } from '../src/core/compete-matrix.js';
import { MARKET_DIM_SPECS } from '../src/core/default-market-dims.js';
import type { CompetitorComparison } from '../src/core/competitor-scanner.js';
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

describe('defineUniverse: 50-dim matrix', () => {
  it('matrix has exactly 50 dimensions after defineUniverse', async () => {
    const matrix = await defineUniverse(noopOpts());
    assert.equal(matrix.dimensions.length, 50);
  });

  it('contextEconomy and causalCoherence are present', async () => {
    const matrix = await defineUniverse(noopOpts());
    const ids = matrix.dimensions.map(d => d.id);
    assert.ok(ids.includes('context_economy'), 'contextEconomy missing');
    assert.ok(ids.includes('causal_coherence'), 'causalCoherence missing');
  });

  it('all 30 market dim IDs are present', async () => {
    const matrix = await defineUniverse(noopOpts());
    const ids = new Set(matrix.dimensions.map(d => d.id));
    for (const spec of MARKET_DIM_SPECS) {
      assert.ok(ids.has(spec.id), `market dim "${spec.id}" missing from matrix`);
    }
  });

  it('market dims with closingStrategy=human are in HUMAN_ACTION_DIMENSION_IDS', async () => {
    const humanSpecIds = MARKET_DIM_SPECS
      .filter(s => s.closingStrategy === 'human')
      .map(s => s.id);
    for (const id of humanSpecIds) {
      assert.ok(HUMAN_ACTION_DIMENSION_IDS.has(id), `${id} not in HUMAN_ACTION_DIMENSION_IDS`);
    }
  });

  it('code dims have selfDefault > 0 (no silent zeros)', async () => {
    const codeDims = MARKET_DIM_SPECS.filter(s => !s.closingStrategy || s.closingStrategy === 'code');
    const zeroDims = codeDims.filter(s => s.selfDefault === 0 && s.id !== 'voice_interface');
    assert.equal(zeroDims.length, 0, `unexpected zero selfDefault on: ${zeroDims.map(d => d.id).join(', ')}`);
  });

  it('unweighted composite is honest (< 6.0) for a fresh project', async () => {
    const matrix = await defineUniverse(noopOpts());
    const composite = computeUnweightedComposite(matrix);
    assert.ok(composite < 6.0, `composite ${composite} should be < 6.0 for fresh project`);
  });

  it('new market dims have ceiling set for human-action dims', async () => {
    const matrix = await defineUniverse(noopOpts());
    const humanDims = matrix.dimensions.filter(d =>
      MARKET_DIM_SPECS.some(s => s.id === d.id && s.closingStrategy === 'human'),
    );
    for (const dim of humanDims) {
      assert.ok(dim.ceiling !== undefined, `human dim "${dim.id}" missing ceiling`);
    }
  });

  it('market dims are idempotent — calling defineUniverse again keeps 50 dims', async () => {
    let savedMatrix: CompeteMatrix | null = null;
    const opts: UniverseDefinerOptions = {
      ...noopOpts(),
      _saveMatrix: async (m) => { savedMatrix = m; },
      _loadMatrix: async () => savedMatrix,
    };
    const first = await defineUniverse(opts);
    assert.equal(first.dimensions.length, 50);
    const second = await defineUniverse({ ...opts, _loadMatrix: async () => savedMatrix });
    assert.equal(second.dimensions.length, 50);
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
