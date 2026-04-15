// tests/ascend-engine.test.ts — Unit tests for ascend-engine internals and compete-matrix additions

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDimensions,
  getNextSprintDimension,
  bootstrapMatrixFromComparison,
  KNOWN_CEILINGS,
  type CompeteMatrix,
  type MatrixDimension,
} from '../src/core/compete-matrix.js';
import { mapDimIdToScoringDimension } from '../src/core/ascend-engine.js';
import type { CompetitorComparison } from '../src/core/competitor-scanner.js';
import type { ScoringDimension } from '../src/core/harsh-scorer.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDim(overrides: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id: 'functionality',
    label: 'Core Functionality',
    weight: 1.5,
    category: 'quality',
    frequency: 'high',
    scores: { self: 5.0, Cursor: 9.0 },
    gap_to_leader: 4.0,
    leader: 'Cursor',
    gap_to_closed_source_leader: 4.0,
    closed_source_leader: 'Cursor',
    gap_to_oss_leader: 2.0,
    oss_leader: 'Aider',
    status: 'not-started',
    sprint_history: [],
    next_sprint_target: 7.0,
    ...overrides,
  };
}

function makeMatrix(dims: MatrixDimension[] = []): CompeteMatrix {
  return {
    project: 'test-project',
    competitors: ['Cursor', 'Aider'],
    competitors_closed_source: ['Cursor'],
    competitors_oss: ['Aider'],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 5.0,
    dimensions: dims,
  };
}

function makeComparison(): CompetitorComparison {
  const dims: ScoringDimension[] = [
    'functionality', 'testing', 'errorHandling', 'security', 'uxPolish',
    'documentation', 'performance', 'maintainability', 'developerExperience',
    'autonomy', 'planningQuality', 'selfImprovement', 'specDrivenPipeline',
    'convergenceSelfHealing', 'tokenEconomy', 'ecosystemMcp',
    'enterpriseReadiness', 'communityAdoption',
  ];
  const ourDimensions = Object.fromEntries(dims.map(d => [d, 50])) as Record<ScoringDimension, number>;
  const cursorScores = Object.fromEntries(dims.map(d => [d, 90])) as Record<ScoringDimension, number>;
  const aiderScores = Object.fromEntries(dims.map(d => [d, 70])) as Record<ScoringDimension, number>;

  return {
    ourDimensions,
    projectName: 'test-project',
    competitors: [
      { name: 'Cursor', url: '', description: '', source: 'user-defined', scores: cursorScores },
      { name: 'Aider', url: '', description: '', source: 'user-defined', scores: aiderScores },
    ],
    leaderboard: [],
    gapReport: dims.map(d => ({
      dimension: d,
      ourScore: 50,
      bestScore: 90,
      bestCompetitor: 'Cursor',
      delta: 40,
      severity: 'major' as const,
    })),
    overallGap: 40,
    competitorSource: 'user-defined',
    analysisTimestamp: new Date().toISOString(),
  };
}

// ── Tests: classifyDimensions ──────────────────────────────────────────────────

describe('classifyDimensions()', () => {
  it('splits achievable vs atCeiling correctly', () => {
    const dims = [
      makeDim({ id: 'functionality', scores: { self: 5.0 } }),                        // achievable
      makeDim({ id: 'community_adoption', scores: { self: 4.0 }, ceiling: 4.0 }),     // at ceiling
      makeDim({ id: 'testing', scores: { self: 3.0 } }),                              // achievable
    ];
    const matrix = makeMatrix(dims);
    const { achievable, atCeiling } = classifyDimensions(matrix);
    assert.equal(achievable.length, 2);
    assert.equal(atCeiling.length, 1);
    assert.equal(atCeiling[0]!.id, 'community_adoption');
  });

  it('excludes closed dimensions from achievable', () => {
    const dims = [
      makeDim({ id: 'functionality', status: 'closed', scores: { self: 9.5 } }),
      makeDim({ id: 'testing', scores: { self: 5.0 } }),
    ];
    const { achievable } = classifyDimensions(makeMatrix(dims));
    assert.equal(achievable.length, 1);
    assert.equal(achievable[0]!.id, 'testing');
  });

  it('does not put closed dims in atCeiling', () => {
    const dims = [
      makeDim({ id: 'functionality', status: 'closed', scores: { self: 9.5 }, ceiling: 4.0 }),
    ];
    const { atCeiling } = classifyDimensions(makeMatrix(dims));
    // closed dims are excluded from atCeiling classification (they're done)
    assert.equal(atCeiling.length, 0);
  });

  it('returns empty arrays when all dims are closed', () => {
    const dims = [makeDim({ status: 'closed', scores: { self: 9.5 } })];
    const { achievable, atCeiling } = classifyDimensions(makeMatrix(dims));
    assert.equal(achievable.length, 0);
    assert.equal(atCeiling.length, 0);
  });

  it('classifies dim as atCeiling when ceiling < target even if current score < ceiling', () => {
    // communityAdoption: ceiling=4.0, target=9.0, score=1.5
    // ceiling (4.0) < target (9.0) → can never reach target via automation → must be ceiling dim
    const dims = [
      makeDim({ id: 'community_adoption', scores: { self: 1.5 }, ceiling: 4.0 }),
      makeDim({ id: 'testing', scores: { self: 5.0 } }),
    ];
    const { achievable, atCeiling } = classifyDimensions(makeMatrix(dims), 9.0);
    assert.equal(atCeiling.length, 1, 'community_adoption must be ceiling even at score=1.5');
    assert.equal(atCeiling[0]!.id, 'community_adoption');
    assert.equal(achievable.length, 1);
    assert.equal(achievable[0]!.id, 'testing');
  });

  it('dim with ceiling >= target is achievable when score < ceiling', () => {
    // ceiling=9.5 >= target=9.0, score=7.0 → achievable
    const dims = [
      makeDim({ id: 'performance', scores: { self: 7.0 }, ceiling: 9.5 }),
    ];
    const { achievable, atCeiling } = classifyDimensions(makeMatrix(dims), 9.0);
    assert.equal(achievable.length, 1);
    assert.equal(atCeiling.length, 0);
  });
});

// ── Tests: KNOWN_CEILINGS ──────────────────────────────────────────────────────

describe('KNOWN_CEILINGS', () => {
  it('communityAdoption ceiling is 4.0', () => {
    assert.equal(KNOWN_CEILINGS['communityAdoption']?.ceiling, 4.0);
  });

  it('enterpriseReadiness ceiling is 6.0', () => {
    assert.equal(KNOWN_CEILINGS['enterpriseReadiness']?.ceiling, 6.0);
  });

  it('each ceiling has a non-empty reason string', () => {
    for (const [key, val] of Object.entries(KNOWN_CEILINGS)) {
      assert.ok(val.reason.length > 0, `${key} has empty reason`);
    }
  });
});

// ── Tests: getNextSprintDimension — ceiling awareness ────────────────────────

describe('getNextSprintDimension() — ceiling-aware', () => {
  it('skips dimensions where self score >= ceiling', () => {
    const dims = [
      makeDim({ id: 'community_adoption', scores: { self: 4.0 }, ceiling: 4.0, gap_to_leader: 5.0, weight: 2.0 }),
      makeDim({ id: 'testing', scores: { self: 3.0 }, gap_to_leader: 2.0, weight: 1.0 }),
    ];
    const next = getNextSprintDimension(makeMatrix(dims));
    assert.equal(next?.id, 'testing'); // communityAdoption at ceiling, should skip
  });

  it('returns null when all dims are at ceiling or closed', () => {
    const dims = [
      makeDim({ id: 'community_adoption', scores: { self: 5.0 }, ceiling: 4.0, status: 'not-started' }),
      makeDim({ id: 'testing', status: 'closed', scores: { self: 9.5 } }),
    ];
    const next = getNextSprintDimension(makeMatrix(dims));
    assert.equal(next, null);
  });
});

// ── Tests: mapDimIdToScoringDimension ─────────────────────────────────────────

describe('mapDimIdToScoringDimension()', () => {
  it('converts snake_case to camelCase ScoringDimension', () => {
    assert.equal(mapDimIdToScoringDimension('spec_driven_pipeline'), 'specDrivenPipeline');
    assert.equal(mapDimIdToScoringDimension('community_adoption'), 'communityAdoption');
    assert.equal(mapDimIdToScoringDimension('ux_polish'), 'uxPolish');
    assert.equal(mapDimIdToScoringDimension('error_handling'), 'errorHandling');
  });

  it('returns known ScoringDimension as-is when already camelCase', () => {
    assert.equal(mapDimIdToScoringDimension('functionality'), 'functionality');
    assert.equal(mapDimIdToScoringDimension('testing'), 'testing');
  });

  it('returns null for unknown dimension ids', () => {
    assert.equal(mapDimIdToScoringDimension('totally_made_up_dimension'), null);
    assert.equal(mapDimIdToScoringDimension(''), null);
  });
});

// ── Tests: bootstrapMatrixFromComparison applies KNOWN_CEILINGS ───────────────

describe('bootstrapMatrixFromComparison() — ceiling application', () => {
  it('applies KNOWN_CEILINGS to communityAdoption dimension', () => {
    const comparison = makeComparison();
    const matrix = bootstrapMatrixFromComparison(comparison, 'test');
    const communityDim = matrix.dimensions.find(d => d.id === 'community_adoption');
    assert.ok(communityDim, 'communityAdoption dimension should exist');
    assert.equal(communityDim?.ceiling, 4.0);
    assert.ok(communityDim?.ceilingReason && communityDim.ceilingReason.length > 0);
  });

  it('applies KNOWN_CEILINGS to enterpriseReadiness dimension', () => {
    const comparison = makeComparison();
    const matrix = bootstrapMatrixFromComparison(comparison, 'test');
    const entDim = matrix.dimensions.find(d => d.id === 'enterprise_readiness');
    assert.ok(entDim, 'enterpriseReadiness dimension should exist');
    assert.equal(entDim?.ceiling, 6.0);
  });

  it('does not set ceiling on non-ceiling dimensions', () => {
    const comparison = makeComparison();
    const matrix = bootstrapMatrixFromComparison(comparison, 'test');
    const funcDim = matrix.dimensions.find(d => d.id === 'functionality');
    assert.equal(funcDim?.ceiling, undefined);
  });
});

describe('AscendEngineOptions — Sprint 48 seams present', () => {
  it('accepts all four Sprint 48 injection seams without TypeScript errors', () => {
    // This test is a type-level contract: if any seam is missing the import will error at compile time.
    const opts: import('../src/core/ascend-engine.js').AscendEngineOptions = {
      _isLLMAvailable: async () => true,
      _bootstrapHarvest: async (_cwd: string) => {},
      _runRetro: async (_cwd: string) => {},
      _runVerify: async (_cwd: string) => {},
      retroInterval: 5,
      autoHarvest: true,
      verifyLoop: true,
    };
    assert.ok(typeof opts._isLLMAvailable === 'function');
    assert.ok(typeof opts._bootstrapHarvest === 'function');
    assert.ok(typeof opts._runRetro === 'function');
    assert.ok(typeof opts._runVerify === 'function');
  });

  it('dryRun: true results in zero seam calls for bootstrap/retro/verify', async () => {
    const { runAscend } = await import('../src/core/ascend-engine.js');
    const { loadMatrix } = await import('../src/core/compete-matrix.js');

    const calls: string[] = [];
    await runAscend({
      dryRun: true,
      yes: true,
      _loadMatrix: async () => ({
        project: 'test', competitors: [], oss_competitors: [], closed_source_competitors: [],
        dimensions: [], overallSelfScore: 8.5, lastUpdated: new Date().toISOString(),
      }),
      _saveMatrix: async () => {},
      _harshScore: async () => ({ displayScore: 8.5, displayDimensions: {}, rawScores: {}, summary: '', recommendations: [] } as never),
      _computeStrictDims: async () => ({ autonomy: 80, selfImprovement: 70, tokenEconomy: 85 }),
      _confirmMatrix: async () => true,
      _isLLMAvailable: async () => { calls.push('llm'); return true; },
      _bootstrapHarvest: async () => { calls.push('harvest'); },
      _runVerify: async () => { calls.push('verify'); },
      _runRetro: async () => { calls.push('retro'); },
    });

    assert.ok(calls.includes('llm'), 'LLM check fires even in dryRun');
    assert.ok(!calls.includes('harvest'), 'harvest should NOT fire in dryRun');
    assert.ok(!calls.includes('verify'), 'verify should NOT fire in dryRun');
    assert.ok(!calls.includes('retro'), 'retro should NOT fire in dryRun');
  });
});
