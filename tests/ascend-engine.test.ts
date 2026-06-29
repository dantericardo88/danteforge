// tests/ascend-engine.test.ts — Unit tests for ascend-engine internals and compete-matrix additions

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classifyDimensions,
  getNextSprintDimension,
  bootstrapMatrixFromComparison,
  KNOWN_CEILINGS,
  HUMAN_ACTION_DIMENSION_IDS,
  type CompeteMatrix,
  type MatrixDimension,
} from '../src/core/compete-matrix.js';
import { mapDimIdToScoringDimension, buildAscendReport, type AscendResult } from '../src/core/ascend-engine.js';
import { readWaveLedger, reconcileReceipts } from '../src/core/wave-ledger.js';
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
    'convergenceSelfHealing', 'tokenEconomy', 'contextEconomy', 'ecosystemMcp',
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

  it('enterpriseReadiness ceiling is 9.0', () => {
    assert.equal(KNOWN_CEILINGS['enterpriseReadiness']?.ceiling, 9.0);
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
    assert.equal(mapDimIdToScoringDimension('context_economy'), 'contextEconomy');
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
    assert.equal(entDim?.ceiling, 9.0);
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

describe('AscendEngineOptions — Sprint 49 executeMode', () => {
  it('executeMode seams present in AscendEngineOptions interface', () => {
    const opts: import('../src/core/ascend-engine.js').AscendEngineOptions = {
      executeMode: 'forge',
      _setWorkflowStage: async (_stage: string, _cwd: string) => {},
    };
    assert.strictEqual(opts.executeMode, 'forge');
    assert.ok(typeof opts._setWorkflowStage === 'function');
  });

  it('executeMode: advisory does NOT call _executeCommand (default behavior preserved)', async () => {
    const { runAscend } = await import('../src/core/ascend-engine.js');

    // Isolated cwd: the Phase-E proposal flow deliberately materializes the matrix to DISK at cwd
    // (ensureMatrixOnDisk bypasses _saveMatrix — "proposal flow is the single writer"), and
    // saveMatrix's test-isolation guard rightly refuses to write the live repo matrix from a test.
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'df-ascend-adv-'));
    const executeCalls: string[] = [];
    await runAscend({
      yes: true,
      cwd,
      executeMode: 'advisory',
      maxCycles: 1,
      _loadMatrix: async () => ({
        project: 'test', competitors: [], oss_competitors: [], closed_source_competitors: [],
        dimensions: [{
          id: 'testing', label: 'Testing', weight: 1.0, category: 'quality', frequency: 'high' as const,
          scores: { self: 5.0, Cursor: 9.0 }, gap_to_leader: 4.0, leader: 'Cursor',
          gap_to_closed_source_leader: 4.0, closed_source_leader: 'Cursor',
          gap_to_oss_leader: 0, oss_leader: 'unknown', status: 'in-progress' as const,
          sprint_history: [], next_sprint_target: 7.0,
        }],
        overallSelfScore: 5.0, lastUpdated: new Date().toISOString(),
      }),
      _saveMatrix: async () => {},
      _harshScore: async () => ({ displayScore: 5.0, displayDimensions: { testing: 5 }, rawScores: {}, summary: '', recommendations: [] } as never),
      _computeStrictDims: async () => ({ autonomy: 50, selfImprovement: 50, tokenEconomy: 50 }),
      _loadState: async () => ({ project: 'test', workflowStage: 'forge', tasks: {}, auditLog: [] } as never),
      _saveState: async () => {},
      _confirmMatrix: async () => true,
      _isLLMAvailable: async () => true,
      _bootstrapHarvest: async () => {},
      _runVerify: async () => {},
      _runLoop: async (ctx) => ctx,
      _executeCommand: async (cmd: string) => { executeCalls.push(cmd); return { success: true }; },
    });

    // In advisory mode, _executeCommand should NOT be called directly by the executeMode fork
    // (it may be passed to _runLoop but advisory mode won't call it from the forge fork)
    const forgeCalls = executeCalls.filter(c => c.startsWith('forge '));
    assert.strictEqual(forgeCalls.length, 0, 'advisory mode should not call forge via executeMode fork');
  });

  it('executeMode: forge calls _executeCommand with forge goal string', async () => {
    const { runAscend } = await import('../src/core/ascend-engine.js');

    // Isolated cwd — same reason as the advisory test above.
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'df-ascend-forge-'));
    const executeCalls: string[] = [];
    await runAscend({
      yes: true,
      cwd,
      executeMode: 'forge',
      maxCycles: 1,
      _loadMatrix: async () => ({
        project: 'test', competitors: [], oss_competitors: [], closed_source_competitors: [],
        dimensions: [{
          id: 'testing', label: 'Testing', weight: 1.0, category: 'quality', frequency: 'high' as const,
          scores: { self: 5.0, Cursor: 9.0 }, gap_to_leader: 4.0, leader: 'Cursor',
          gap_to_closed_source_leader: 4.0, closed_source_leader: 'Cursor',
          gap_to_oss_leader: 0, oss_leader: 'unknown', status: 'in-progress' as const,
          sprint_history: [], next_sprint_target: 7.0,
        }],
        overallSelfScore: 5.0, lastUpdated: new Date().toISOString(),
      }),
      _saveMatrix: async () => {},
      _harshScore: async () => ({ displayScore: 5.0, displayDimensions: { testing: 5 }, rawScores: {}, summary: '', recommendations: [] } as never),
      _computeStrictDims: async () => ({ autonomy: 50, selfImprovement: 50, tokenEconomy: 50 }),
      _loadState: async () => ({ project: 'test', workflowStage: 'forge', tasks: {}, auditLog: [] } as never),
      _saveState: async () => {},
      _confirmMatrix: async () => true,
      _isLLMAvailable: async () => true,
      _bootstrapHarvest: async () => {},
      _runVerify: async () => {},
      _runLoop: async (ctx) => ctx,
      _setWorkflowStage: async () => {},
      _executeCommand: async (cmd: string) => { executeCalls.push(cmd); return { success: true }; },
    });

    const forgeCalls = executeCalls.filter(c => c.startsWith('forge '));
    assert.ok(forgeCalls.length >= 1, `Expected at least one forge call, got: ${JSON.stringify(executeCalls)}`);
    assert.ok(forgeCalls[0]!.includes('Testing'), 'Forge goal should mention dimension label');
  });
});

// ── depth_doctrine: ascend drives the shared WAVE LEDGER (CH-021 loop #3) ────────
describe('runAscend — emits durable wave receipts (depth_doctrine rung-8, CH-021)', () => {
  it('a real ascend cycle appends a COMPLETED ascend wave with the canonical schema', async () => {
    const { runAscend } = await import('../src/core/ascend-engine.js');
    const cwd = path.join(os.tmpdir(), `ascend-wave-ledger-${process.pid}-${Date.now()}`);
    await fs.mkdir(cwd, { recursive: true });
    try {
      await runAscend({
        yes: true, cwd, executeMode: 'forge', maxCycles: 1,
        _loadMatrix: async () => ({
          project: 'test', competitors: [], oss_competitors: [], closed_source_competitors: [],
          dimensions: [{
            id: 'testing', label: 'Testing', weight: 1.0, category: 'quality', frequency: 'high' as const,
            scores: { self: 5.0, Cursor: 9.0 }, gap_to_leader: 4.0, leader: 'Cursor',
            gap_to_closed_source_leader: 4.0, closed_source_leader: 'Cursor',
            gap_to_oss_leader: 0, oss_leader: 'unknown', status: 'in-progress' as const,
            sprint_history: [], next_sprint_target: 7.0,
          }],
          overallSelfScore: 5.0, lastUpdated: new Date().toISOString(),
        }),
        _saveMatrix: async () => {},
        _harshScore: async () => ({ displayScore: 5.0, displayDimensions: { testing: 5 }, rawScores: {}, summary: '', recommendations: [] } as never),
        _computeStrictDims: async () => ({ autonomy: 50, selfImprovement: 50, tokenEconomy: 50 }),
        _loadState: async () => ({ project: 'test', workflowStage: 'forge', tasks: {}, auditLog: [] } as never),
        _saveState: async () => {},
        _confirmMatrix: async () => true,
        _isLLMAvailable: async () => true,
        _bootstrapHarvest: async () => {},
        _runVerify: async () => {},
        _runLoop: async (ctx) => ctx,
        _setWorkflowStage: async () => {},
        _executeCommand: async () => ({ success: true }),
      });
      const rows = await readWaveLedger(cwd);
      const done = reconcileReceipts(rows).find(r => r.loopName === 'ascend' && r.status === 'completed');
      assert.ok(done, 'ascend genuinely drove the SHARED wave ledger — a receipt, not a hypothesis');
      assert.strictEqual(done!.dimensionId, 'testing');
      assert.strictEqual(done!.scoreBefore, 5.0, 'real scoreBefore (0-10 matrix score)');
      // Byte-comparable to harden-crusade + autoforge: the same canonical key-set.
      for (const k of ['waveId', 'runId', 'loopName', 'waveIndex', 'waveType', 'scoreCeiling', 'allowedActions', 'scoreBefore', 'scoreAfter', 'commandsRun', 'status', 'startedAt', 'completedAt']) {
        assert.ok(done && k in done, `ascend receipt carries the canonical field "${k}"`);
      }
    } finally {
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ── Tests: rescore bug fix — non-harsh-scorer dims keep beforeScore ───────────

describe('market dim guard — non-scorer dims skip forge cycle', () => {
  it('dim not in harsh-scorer hits the market dim guard: no forge cycle, score stays at beforeScore', async () => {
    const { runAscend } = await import('../src/core/ascend-engine.js');

    // 'ocr_text_extraction' is not a known ScoringDimension — mapDimIdToScoringDimension returns null.
    // The market dim guard fires immediately: no forge cycle runs, no score inflation possible.
    const executeCalls: string[] = [];
    let matrixAfter: CompeteMatrix | null = null;
    await runAscend({
      yes: true,
      executeMode: 'forge',
      maxCycles: 2,
      _loadMatrix: async () => ({
        project: 'test', competitors: ['Cursor'], competitors_closed_source: ['Cursor'], competitors_oss: [],
        dimensions: [{
          id: 'ocr_text_extraction', label: 'OCR Text Extraction', weight: 1.0,
          category: 'features', frequency: 'medium' as const,
          scores: { self: 1.0, Cursor: 8.5 }, gap_to_leader: 7.5, leader: 'Cursor',
          gap_to_closed_source_leader: 7.5, closed_source_leader: 'Cursor',
          gap_to_oss_leader: 0, oss_leader: 'unknown',
          status: 'not-started' as const, sprint_history: [], next_sprint_target: 3.0,
        }],
        overallSelfScore: 1.0, lastUpdated: new Date().toISOString(),
      }),
      _saveMatrix: async (m) => { matrixAfter = m; },
      _harshScore: async () => ({
        displayScore: 7.0,
        displayDimensions: { functionality: 7.0, testing: 7.0 },
        rawScore: 70, harshScore: 70, dimensions: {}, penalties: [],
        stubsDetected: [], fakeCompletionRisk: 'low', verdict: 'acceptable',
        maturityAssessment: {} as never, timestamp: new Date().toISOString(),
      } as never),
      _computeStrictDims: async () => ({ autonomy: 50, selfImprovement: 50, tokenEconomy: 50 }),
      _loadState: async () => ({ project: 'test', workflowStage: 'forge', tasks: {}, auditLog: [] } as never),
      _saveState: async () => {},
      _confirmMatrix: async () => true,
      _isLLMAvailable: async () => true,
      _bootstrapHarvest: async () => {},
      _runVerify: async () => {},
      _setWorkflowStage: async () => {},
      _executeCommand: async (cmd: string) => { executeCalls.push(cmd); return { success: true }; },
    });

    // Market dim guard prevents any forge cycle from running for this dim
    assert.strictEqual(executeCalls.filter(c => c.startsWith('forge')).length, 0,
      'No forge calls should be made for a market dim with no auto-scorer');
    // Score in matrix must not be inflated to displayScore (7.0)
    if (matrixAfter) {
      const dim = (matrixAfter as CompeteMatrix).dimensions.find(d => d.id === 'ocr_text_extraction');
      if (dim) {
        assert.ok((dim.scores['self'] ?? 0) <= 1.5,
          `Score must not be inflated beyond beforeScore (1.0), got ${dim.scores['self']}`);
      }
    }
  });
});

// ── Tests: human-action loop branch ──────────────────────────────────────────

describe('runAscend — human-action dims skip forge cycle', () => {
  it('dims with closingStrategy=human produce no forge calls', async () => {
    const { runAscend } = await import('../src/core/ascend-engine.js');

    const executeCalls: string[] = [];
    await runAscend({
      yes: true,
      executeMode: 'forge',
      maxCycles: 2,
      _loadMatrix: async () => ({
        project: 'test', competitors: ['Cursor'], competitors_closed_source: ['Cursor'], competitors_oss: [],
        dimensions: [{
          id: 'code_signing', label: 'Code Signing', weight: 1.0,
          category: 'reliability', frequency: 'low' as const,
          scores: { self: 0.0, Cursor: 9.0 }, gap_to_leader: 9.0, leader: 'Cursor',
          gap_to_closed_source_leader: 9.0, closed_source_leader: 'Cursor',
          gap_to_oss_leader: 0, oss_leader: 'unknown',
          status: 'not-started' as const, sprint_history: [], next_sprint_target: 2.0,
          closingStrategy: 'human' as const,
        }],
        overallSelfScore: 0.0, lastUpdated: new Date().toISOString(),
      }),
      _saveMatrix: async () => {},
      _harshScore: async () => ({
        displayScore: 5.0, displayDimensions: {},
        rawScore: 50, harshScore: 50, dimensions: {}, penalties: [],
        stubsDetected: [], fakeCompletionRisk: 'low', verdict: 'acceptable',
        maturityAssessment: {} as never, timestamp: new Date().toISOString(),
      } as never),
      _computeStrictDims: async () => ({ autonomy: 50, selfImprovement: 50, tokenEconomy: 50 }),
      _loadState: async () => ({ project: 'test', workflowStage: 'forge', tasks: {}, auditLog: [] } as never),
      _saveState: async () => {},
      _confirmMatrix: async () => true,
      _isLLMAvailable: async () => true,
      _bootstrapHarvest: async () => {},
      _runVerify: async () => {},
      _setWorkflowStage: async () => {},
      _executeCommand: async (cmd: string) => { executeCalls.push(cmd); return { success: true }; },
    });

    const forgeCalls = executeCalls.filter(c => c.startsWith('forge '));
    assert.strictEqual(forgeCalls.length, 0, 'No forge calls for human-action dim');
  });

  it('known HUMAN_ACTION_DIMENSION_IDS set is non-empty', () => {
    assert.ok(HUMAN_ACTION_DIMENSION_IDS.size > 0, 'HUMAN_ACTION_DIMENSION_IDS must contain at least one entry');
    assert.ok(HUMAN_ACTION_DIMENSION_IDS.has('community_adoption'));
    assert.ok(HUMAN_ACTION_DIMENSION_IDS.has('code_signing'));
  });
});

describe('buildManualAction / market dim guard', () => {
  it('mapDimIdToScoringDimension returns null for a market dim (no harsh-scorer mapping)', () => {
    assert.strictEqual(mapDimIdToScoringDimension('semantic_memory'), null);
    assert.strictEqual(mapDimIdToScoringDimension('agent_reasoning_loop'), null);
    assert.strictEqual(mapDimIdToScoringDimension('ide_integration'), null);
  });

  it('mapDimIdToScoringDimension returns a value for all 20 harsh-scorer dims', () => {
    const harshIds = [
      'functionality', 'testing', 'error_handling', 'security', 'ux_polish',
      'documentation', 'performance', 'maintainability', 'developer_experience',
      'autonomy', 'planning_quality', 'self_improvement', 'spec_driven_pipeline',
      'convergence_self_healing', 'token_economy', 'context_economy', 'causal_coherence',
      'ecosystem_mcp', 'enterprise_readiness', 'community_adoption',
    ];
    for (const id of harshIds) {
      assert.notStrictEqual(mapDimIdToScoringDimension(id), null, `${id} should map to a ScoringDimension`);
    }
  });

  it('causalCoherence is now in ALL_SCORING_DIMENSIONS (regression — was missing)', () => {
    assert.notStrictEqual(mapDimIdToScoringDimension('causal_coherence'), null);
  });
});

describe('buildAscendReport — market dim checklist', () => {
  function makeAscendResult(overrides: Partial<AscendResult> = {}): AscendResult {
    return {
      cyclesRun: 1,
      dimensionsImproved: 0,
      dimensionsAtTarget: 0,
      ceilingReports: [],
      finalScore: 5.0,
      success: false,
      ...overrides,
    };
  }

  function makeReportMatrix(dims: Partial<MatrixDimension>[]): CompeteMatrix {
    return {
      project: 'TestProject',
      competitors: ['Cursor'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: [],
      lastUpdated: new Date().toISOString(),
      overallSelfScore: 5.0,
      dimensions: dims.map((d, i) => ({
        id: d.id ?? `dim_${i}`,
        label: d.label ?? `Dim ${i}`,
        weight: d.weight ?? 1.0,
        category: d.category ?? 'quality',
        frequency: d.frequency ?? 'medium',
        scores: d.scores ?? { self: 5.0, Cursor: 8.0 },
        gap_to_leader: d.gap_to_leader ?? 3.0,
        leader: d.leader ?? 'Cursor',
        gap_to_closed_source_leader: d.gap_to_closed_source_leader ?? 3.0,
        closed_source_leader: d.closed_source_leader ?? 'Cursor',
        gap_to_oss_leader: d.gap_to_oss_leader ?? 0,
        oss_leader: d.oss_leader ?? 'unknown',
        status: d.status ?? 'not-started',
        sprint_history: d.sprint_history ?? [],
        next_sprint_target: d.next_sprint_target ?? 7.0,
        ceiling: d.ceiling,
        ceilingReason: d.ceilingReason,
      } as MatrixDimension)),
    };
  }

  it('includes market dim checklist when market dims are below target', () => {
    const matrix = makeReportMatrix([
      // harsh-scorer dim (functionality → in ALL_SCORING_DIMENSIONS)
      { id: 'functionality', label: 'Functionality', scores: { self: 8.0, Cursor: 9.0 } },
      // market dim (semantic_memory → NOT in ALL_SCORING_DIMENSIONS, below target)
      { id: 'semantic_memory', label: 'Semantic Memory', scores: { self: 2.0, Cursor: 7.0 } },
    ]);
    const report = buildAscendReport(matrix, makeAscendResult(), 9.0, {});
    assert.ok(report.includes('Market Dims Needing Manual Update'), 'should include market dim section heading');
    assert.ok(report.includes('semantic_memory'), 'should list the market dim id');
    assert.ok(report.includes('--amend semantic_memory=<score>'), 'should include the --amend command');
    assert.ok(!report.includes('functionality'), 'should not include the auto-scored dim');
  });

  it('omits market dim section when all market dims are at or above target', () => {
    const matrix = makeReportMatrix([
      { id: 'functionality', label: 'Functionality', scores: { self: 8.0, Cursor: 9.0 } },
      // semantic_memory at 9.0 — already at target
      { id: 'semantic_memory', label: 'Semantic Memory', scores: { self: 9.0, Cursor: 9.0 } },
    ]);
    const report = buildAscendReport(matrix, makeAscendResult(), 9.0, {});
    assert.ok(!report.includes('Market Dims Needing Manual Update'), 'section should be omitted when all market dims at target');
  });

  it('omits market dim section when matrix has only harsh-scorer dims', () => {
    const matrix = makeReportMatrix([
      { id: 'functionality', label: 'Functionality', scores: { self: 7.0, Cursor: 9.0 } },
      { id: 'testing', label: 'Testing', scores: { self: 6.0, Cursor: 9.0 } },
    ]);
    const report = buildAscendReport(matrix, makeAscendResult(), 9.0, {});
    assert.ok(!report.includes('Market Dims Needing Manual Update'), 'section should be absent when no market dims');
  });
});
