// Harsh Scorer — tests for penalty calculation, stub detection, plateau detection,
// fake-completion risk, dimension scoring, and history persistence.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';
import type { DanteState } from '../src/core/state.js';
import {
  computeHarshScore,
  computeHarshVerdict,
  computeFakeCompletionRisk,
  computeWeightedScore,
  computePlanningQualityScore,
  computeSelfImprovementScore,
  computeDeveloperExperienceScore,
  computeAutonomyScore,
  computeEnterpriseReadinessScore,
  formatDimensionBar,
  readAssessmentHistory,
  writeAssessmentHistory,
  HARSH_THRESHOLDS,
  type HarshScorerOptions,
  type ScoringDimension,
  type AssessmentHistoryEntry,
} from '../src/core/harsh-scorer.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

// ── Test factories ────────────────────────────────────────────────────────────

function makeMaturityAssessment(overrides: Partial<MaturityAssessment> = {}): MaturityAssessment {
  return {
    currentLevel: 4,
    targetLevel: 5,
    overallScore: 72,
    dimensions: {
      functionality: 75,
      testing: 80,
      errorHandling: 65,
      security: 70,
      uxPolish: 60,
      documentation: 72,
      performance: 68,
      maintainability: 74,
    },
    gaps: [],
    founderExplanation: 'Beta-level quality.',
    recommendation: 'refine',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test',
    lastHandoff: '',
    workflowStage: 'verify',
    currentPhase: 1,
    tasks: { 1: [{ name: 'task1' }], 2: [{ name: 'task2' }], 3: [{ name: 'task3' }] },
    auditLog: Array(25).fill('audit entry'),
    profile: 'budget',
    lastVerifyStatus: 'pass',
    autoforgeEnabled: true,
    retroDelta: 5,
    autoforgeFailedAttempts: 0,
    ...overrides,
  };
}

function makeScoreResult(score: number): ScoreResult {
  return {
    artifact: 'SPEC',
    score,
    dimensions: { completeness: 15, clarity: 15, testability: 15, constitutionAlignment: 15, integrationFitness: 8, freshness: 7 },
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: 'advance',
    hasCEOReviewBonus: false,
  };
}

function makeOptions(overrides: Partial<HarshScorerOptions> = {}): HarshScorerOptions {
  const assessment = makeMaturityAssessment();
  const state = makeState();
  return {
    cwd: '/fake/project',
    targetLevel: 5,
    _loadState: async () => state,
    _scoreAllArtifacts: async () => ({
      CONSTITUTION: makeScoreResult(80),
      SPEC: makeScoreResult(75),
      CLARIFY: makeScoreResult(70),
      PLAN: makeScoreResult(72),
      TASKS: makeScoreResult(68),
    }),
    _assessMaturity: async () => assessment,
    _readFile: async () => 'const x = 1;', // clean file — no stubs
    _listSourceFiles: async () => ['src/index.ts'],
    _readHistory: async () => [],
    _writeHistory: async () => {},
    ...overrides,
  };
}

// ── computeHarshScore integration tests ──────────────────────────────────────

describe('computeHarshScore', () => {
  it('returns a valid HarshScoreResult with all required fields', async () => {
    const result = await computeHarshScore(makeOptions());
    assert.ok(result.rawScore >= 0 && result.rawScore <= 100, 'rawScore in range');
    assert.ok(result.harshScore >= 0 && result.harshScore <= 100, 'harshScore in range');
    assert.ok(result.displayScore >= 0 && result.displayScore <= 10, 'displayScore in range');
    assert.ok(Array.isArray(result.penalties), 'penalties is array');
    assert.ok(Array.isArray(result.stubsDetected), 'stubsDetected is array');
    assert.ok(['low', 'medium', 'high'].includes(result.fakeCompletionRisk));
    assert.ok(['blocked', 'needs-work', 'acceptable', 'excellent'].includes(result.verdict));
    assert.ok(result.timestamp.length > 0);
  });

  it('displayScore is rawScore/10 rounded to 1 decimal', async () => {
    const result = await computeHarshScore(makeOptions());
    const expected = Math.round(result.harshScore / 10 * 10) / 10;
    assert.equal(result.displayScore, expected);
  });

  it('has all 19 dimensions', async () => {
    const result = await computeHarshScore(makeOptions());
    const expected: ScoringDimension[] = [
      'functionality', 'testing', 'errorHandling', 'security',
      'uxPolish', 'documentation', 'performance', 'maintainability',
      'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
      'specDrivenPipeline', 'convergenceSelfHealing', 'tokenEconomy',
      'contextEconomy', 'ecosystemMcp', 'enterpriseReadiness', 'communityAdoption',
    ];
    for (const dim of expected) {
      assert.ok(dim in result.dimensions, `Missing dimension: ${dim}`);
      assert.ok(dim in result.displayDimensions, `Missing displayDimension: ${dim}`);
    }
  });

  it('applies stub penalty when stubs detected', async () => {
    const result = await computeHarshScore(makeOptions({
      _readFile: async () => '// TO\u0044O: implement this function',
      _listSourceFiles: async () => ['src/a.ts', 'src/b.ts'],
    }));
    const stubPenalty = result.penalties.find((p) => p.category === 'stub-detection');
    assert.ok(stubPenalty, 'stub penalty applied');
    assert.ok(stubPenalty!.deduction >= 10, 'deduction >= 10');
    assert.ok(result.stubsDetected.length > 0, 'stubs detected');
    assert.ok(result.harshScore < result.rawScore, 'harshScore < rawScore after penalty');
  });

  it('caps stub penalty at 30 across many files', async () => {
    const manyFiles = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts`);
    const result = await computeHarshScore(makeOptions({
      _readFile: async () => '// TO\u0044O: fix this',
      _listSourceFiles: async () => manyFiles,
    }));
    const stubPenalty = result.penalties.find((p) => p.category === 'stub-detection');
    assert.ok(stubPenalty!.deduction <= 30, 'stub penalty capped at 30');
  });

  it('applies fake-completion high penalty when completion >= 95% but maturity below target', async () => {
    const result = await computeHarshScore(makeOptions({
      _assessMaturity: async () => makeMaturityAssessment({ overallScore: 30, currentLevel: 2, targetLevel: 5 }),
      _computeCompletionTracker: () => ({
        overall: 97,
        phases: {
          planning: { score: 95, complete: true, artifacts: {} as never },
          execution: { score: 97, complete: true, currentPhase: 3, wavesComplete: 10, totalWaves: 10 },
          verification: { score: 97, complete: true, qaScore: 90, testsPassing: true },
          synthesis: { score: 95, complete: true, retroDelta: null },
        },
        lastUpdated: new Date().toISOString(),
        projectedCompletion: 'done',
      }),
    }));
    const fakePenalty = result.penalties.find((p) => p.category === 'fake-completion');
    assert.ok(fakePenalty, 'fake completion penalty applied');
    assert.equal(result.fakeCompletionRisk, 'high');
  });

  it('applies test coverage penalty when testing dimension < 70', async () => {
    const result = await computeHarshScore(makeOptions({
      _assessMaturity: async () => makeMaturityAssessment({
        dimensions: {
          functionality: 75, testing: 55, errorHandling: 65,
          security: 70, uxPolish: 60, documentation: 72,
          performance: 68, maintainability: 74,
        },
      }),
    }));
    const coveragePenalty = result.penalties.find((p) => p.category === 'test-coverage');
    assert.ok(coveragePenalty, 'test coverage penalty applied');
    assert.equal(coveragePenalty!.deduction, 15);
  });

  it('applies plateau penalty when last 3 scores within ±2', async () => {
    const history: AssessmentHistoryEntry[] = [
      { timestamp: '', harshScore: 71, displayScore: 7.1, dimensions: {} as never, penaltyTotal: 0 },
      { timestamp: '', harshScore: 72, displayScore: 7.2, dimensions: {} as never, penaltyTotal: 0 },
      { timestamp: '', harshScore: 71, displayScore: 7.1, dimensions: {} as never, penaltyTotal: 0 },
    ];
    const result = await computeHarshScore(makeOptions({
      _readHistory: async () => history,
    }));
    const plateauPenalty = result.penalties.find((p) => p.category === 'plateau');
    assert.ok(plateauPenalty, 'plateau penalty applied');
    assert.equal(plateauPenalty!.deduction, 5);
  });

  it('no plateau penalty when last 3 scores vary > 2 points', async () => {
    const history: AssessmentHistoryEntry[] = [
      { timestamp: '', harshScore: 60, displayScore: 6.0, dimensions: {} as never, penaltyTotal: 0 },
      { timestamp: '', harshScore: 70, displayScore: 7.0, dimensions: {} as never, penaltyTotal: 0 },
      { timestamp: '', harshScore: 75, displayScore: 7.5, dimensions: {} as never, penaltyTotal: 0 },
    ];
    const result = await computeHarshScore(makeOptions({
      _readHistory: async () => history,
    }));
    const plateauPenalty = result.penalties.find((p) => p.category === 'plateau');
    assert.equal(plateauPenalty, undefined);
  });

  it('applies error handling penalty when errorHandling < 50', async () => {
    const result = await computeHarshScore(makeOptions({
      _assessMaturity: async () => makeMaturityAssessment({
        dimensions: {
          functionality: 75, testing: 80, errorHandling: 20,
          security: 70, uxPolish: 60, documentation: 72,
          performance: 68, maintainability: 74,
        },
      }),
    }));
    const ehPenalty = result.penalties.find((p) => p.category === 'error-handling');
    assert.ok(ehPenalty, 'error handling penalty applied');
    assert.ok(ehPenalty!.deduction > 0);
  });

  it('persists history entry via _writeHistory', async () => {
    let written: AssessmentHistoryEntry[] = [];
    await computeHarshScore(makeOptions({
      _writeHistory: async (_cwd, entries) => { written = entries; },
    }));
    assert.equal(written.length, 1);
    assert.ok(written[0]!.harshScore >= 0);
    assert.ok(written[0]!.timestamp.length > 0);
  });

  it('harshScore is always <= rawScore', async () => {
    const result = await computeHarshScore(makeOptions({
      _readFile: async () => '// TO\u0044O fix everything',
      _listSourceFiles: async () => ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      _assessMaturity: async () => makeMaturityAssessment({
        dimensions: {
          functionality: 75, testing: 40, errorHandling: 20,
          security: 70, uxPolish: 60, documentation: 72,
          performance: 68, maintainability: 74,
        },
      }),
    }));
    assert.ok(result.harshScore <= result.rawScore);
  });

  it('harshScore never goes below 0', async () => {
    const history: AssessmentHistoryEntry[] = [
      { timestamp: '', harshScore: 5, displayScore: 0.5, dimensions: {} as never, penaltyTotal: 90 },
      { timestamp: '', harshScore: 5, displayScore: 0.5, dimensions: {} as never, penaltyTotal: 90 },
      { timestamp: '', harshScore: 5, displayScore: 0.5, dimensions: {} as never, penaltyTotal: 90 },
    ];
    const result = await computeHarshScore(makeOptions({
      _readFile: async () => '// TO\u0044O stub',
      _listSourceFiles: async () => Array.from({ length: 5 }, (_, i) => `src/f${i}.ts`),
      _assessMaturity: async () => makeMaturityAssessment({
        overallScore: 10,
        dimensions: {
          functionality: 10, testing: 10, errorHandling: 5,
          security: 10, uxPolish: 10, documentation: 10,
          performance: 10, maintainability: 10,
        },
      }),
      _readHistory: async () => history,
    }));
    assert.ok(result.harshScore >= 0, 'harshScore never negative');
  });
});

// ── computeHarshVerdict ───────────────────────────────────────────────────────

describe('computeHarshVerdict', () => {
  const goodDims = Object.fromEntries(
    ['functionality','testing','errorHandling','security','uxPolish','documentation',
     'performance','maintainability','developerExperience','autonomy','planningQuality','selfImprovement',
     'specDrivenPipeline','convergenceSelfHealing','tokenEconomy','ecosystemMcp','enterpriseReadiness','communityAdoption']
      .map((k) => [k, 80]),
  ) as Record<ScoringDimension, number>;

  it('returns excellent when score >= 85 and all dims >= 70', () => {
    assert.equal(computeHarshVerdict(87, goodDims), 'excellent');
  });

  it('returns acceptable when score 70-84 and all dims >= 70', () => {
    assert.equal(computeHarshVerdict(75, goodDims), 'acceptable');
  });

  it('returns needs-work when score 50-69', () => {
    assert.equal(computeHarshVerdict(60, goodDims), 'needs-work');
  });

  it('returns blocked when score < 50', () => {
    assert.equal(computeHarshVerdict(40, goodDims), 'blocked');
  });

  it('returns needs-work even at 90+ if any dimension < 70', () => {
    const badDims = { ...goodDims, errorHandling: 50 };
    assert.equal(computeHarshVerdict(90, badDims), 'needs-work');
  });
});

// ── computeFakeCompletionRisk ─────────────────────────────────────────────────

describe('computeFakeCompletionRisk', () => {
  it('returns high when completion >= 95 and maturity below target', () => {
    assert.equal(computeFakeCompletionRisk(96, 3, 5), 'high');
  });

  it('returns medium when completion >= 80 and maturity 2+ levels below target', () => {
    assert.equal(computeFakeCompletionRisk(82, 2, 5), 'medium');
  });

  it('returns low when completion < 80', () => {
    assert.equal(computeFakeCompletionRisk(70, 3, 5), 'low');
  });

  it('returns low when maturity meets target', () => {
    assert.equal(computeFakeCompletionRisk(97, 5, 5), 'low');
  });

  it('returns low when completion >= 95 but maturity meets target', () => {
    assert.equal(computeFakeCompletionRisk(96, 5, 5), 'low');
  });
});

// ── computeWeightedScore ──────────────────────────────────────────────────────

describe('computeWeightedScore', () => {
  it('returns 100 when all dimensions are 100', () => {
    const dims = Object.fromEntries(
      ['functionality','testing','errorHandling','security','uxPolish','documentation',
       'performance','maintainability','developerExperience','autonomy','planningQuality','selfImprovement',
       'specDrivenPipeline','convergenceSelfHealing','tokenEconomy','contextEconomy',
       'ecosystemMcp','enterpriseReadiness','communityAdoption']
        .map((k) => [k, 100]),
    ) as Record<ScoringDimension, number>;
    assert.ok(Math.abs(computeWeightedScore(dims) - 100) < 0.01);
  });

  it('returns 0 when all dimensions are 0', () => {
    const dims = Object.fromEntries(
      ['functionality','testing','errorHandling','security','uxPolish','documentation',
       'performance','maintainability','developerExperience','autonomy','planningQuality','selfImprovement',
       'specDrivenPipeline','convergenceSelfHealing','tokenEconomy','contextEconomy',
       'ecosystemMcp','enterpriseReadiness','communityAdoption']
        .map((k) => [k, 0]),
    ) as Record<ScoringDimension, number>;
    assert.equal(computeWeightedScore(dims), 0);
  });
});

// ── computePlanningQualityScore ───────────────────────────────────────────────

describe('computePlanningQualityScore', () => {
  it('averages all 5 artifact scores', () => {
    const scores = {
      CONSTITUTION: makeScoreResult(80),
      SPEC: makeScoreResult(70),
      CLARIFY: makeScoreResult(60),
      PLAN: makeScoreResult(90),
      TASKS: makeScoreResult(50),
    };
    assert.equal(computePlanningQualityScore(scores), 70);
  });

  it('treats missing artifacts as 0', () => {
    const score = computePlanningQualityScore({});
    assert.equal(score, 0);
  });
});

// ── computeSelfImprovementScore ───────────────────────────────────────────────

describe('computeSelfImprovementScore', () => {
  it('returns higher score with positive retro delta and many audit entries', () => {
    const high = computeSelfImprovementScore(makeState({ retroDelta: 10, auditLog: Array(30).fill('x'), lastVerifyStatus: 'pass' }));
    const low = computeSelfImprovementScore(makeState({ retroDelta: 0, auditLog: [], lastVerifyStatus: 'fail' }));
    assert.ok(high > low);
  });

  it('clamps to 0-100', () => {
    const score = computeSelfImprovementScore(makeState({ retroDelta: 999, auditLog: Array(1000).fill('x') }));
    assert.ok(score <= 100);
  });
});

// ── computeDeveloperExperienceScore ──────────────────────────────────────────

describe('computeDeveloperExperienceScore', () => {
  it('returns higher score with no critical gaps', () => {
    const noCritical = computeDeveloperExperienceScore(makeMaturityAssessment({ gaps: [] }));
    const withCritical = computeDeveloperExperienceScore(makeMaturityAssessment({
      gaps: [{ dimension: 'testing', currentScore: 30, targetScore: 80, gapSize: 50, severity: 'critical', recommendation: 'fix' }],
    }));
    assert.ok(noCritical > withCritical);
  });
});

// ── computeAutonomyScore ──────────────────────────────────────────────────────

describe('computeAutonomyScore', () => {
  it('returns higher score with verify pass and autoforge enabled', () => {
    const high = computeAutonomyScore(
      makeState({ lastVerifyStatus: 'pass', autoforgeEnabled: true }),
      makeMaturityAssessment({ recommendation: 'proceed' }),
    );
    const low = computeAutonomyScore(
      makeState({ lastVerifyStatus: 'fail', autoforgeEnabled: false }),
      makeMaturityAssessment({ recommendation: 'blocked' }),
    );
    assert.ok(high > low);
  });
});

// ── formatDimensionBar ────────────────────────────────────────────────────────

describe('formatDimensionBar', () => {
  it('returns 10 characters total', () => {
    assert.equal(formatDimensionBar(70).length, 10);
    assert.equal(formatDimensionBar(0).length, 10);
    assert.equal(formatDimensionBar(100).length, 10);
  });

  it('all filled at 100', () => {
    assert.equal(formatDimensionBar(100), '██████████');
  });

  it('all empty at 0', () => {
    assert.equal(formatDimensionBar(0), '░░░░░░░░░░');
  });

  it('half filled at 50', () => {
    assert.equal(formatDimensionBar(50), '█████░░░░░');
  });
});

// ── readAssessmentHistory / writeAssessmentHistory ────────────────────────────

describe('history I/O', () => {
  it('round-trips assessment history to disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harsh-scorer-test-'));
    try {
      const entries: AssessmentHistoryEntry[] = [
        {
          timestamp: '2026-04-01T00:00:00Z',
          harshScore: 72,
          displayScore: 7.2,
          dimensions: {} as Record<ScoringDimension, number>,
          penaltyTotal: 10,
        },
      ];
      await writeAssessmentHistory(tmpDir, entries);
      const loaded = await readAssessmentHistory(tmpDir);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0]!.harshScore, 72);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it('returns empty array when file does not exist', async () => {
    const result = await readAssessmentHistory('/nonexistent/path/xyz');
    assert.deepEqual(result, []);
  });
});

// ── computeEnterpriseReadinessScore ──────────────────────────────────────────

describe('computeEnterpriseReadinessScore', () => {
  function makeAssessment(security: number): MaturityAssessment {
    return makeMaturityAssessment({ dimensions: { functionality: 75, testing: 80, errorHandling: 65, security, uxPolish: 70, documentation: 60, performance: 55, maintainability: 72 } });
  }

  it('base score: audit log with 8 entries (>5) → 25', () => {
    const state = { auditLog: Array.from({ length: 8 }, (_, i) => `e${i}`) } as DanteState;
    assert.equal(computeEnterpriseReadinessScore(state, makeAssessment(50)), 25); // 15+10
  });

  it('selfEditPolicy deny adds +15', () => {
    const state = { auditLog: Array.from({ length: 8 }, (_, i) => `e${i}`), selfEditPolicy: 'deny' } as DanteState;
    assert.equal(computeEnterpriseReadinessScore(state, makeAssessment(50)), 40); // 15+10+15
  });

  it('selfEditPolicy prompt also adds +15', () => {
    const state = { auditLog: Array.from({ length: 8 }, (_, i) => `e${i}`), selfEditPolicy: 'prompt' } as DanteState;
    assert.equal(computeEnterpriseReadinessScore(state, makeAssessment(50)), 40); // 15+10+15
  });

  it('lastVerifyReceiptPath set adds +15', () => {
    const state = { auditLog: Array.from({ length: 8 }, (_, i) => `e${i}`), lastVerifyReceiptPath: '/path/receipt.json' } as DanteState;
    assert.equal(computeEnterpriseReadinessScore(state, makeAssessment(50)), 40); // 15+10+15
  });

  it('security ≥ 80 adds +20', () => {
    const state = { auditLog: Array.from({ length: 8 }, (_, i) => `e${i}`) } as DanteState;
    assert.equal(computeEnterpriseReadinessScore(state, makeAssessment(85)), 45); // 15+10+20
  });

  it('all original signals maxed: audit>20 + selfEditPolicy + security≥80 + receipt → 85', () => {
    const state = {
      auditLog: Array.from({ length: 25 }, (_, i) => `entry${i}`),
      selfEditPolicy: 'deny',
      lastVerifyReceiptPath: '/path/receipt.json',
    } as DanteState;
    assert.equal(computeEnterpriseReadinessScore(state, makeAssessment(90)), 85); // 15+20+15+20+15
  });

  it('hasSecurityPolicy flag adds +10', () => {
    const state = { auditLog: [] } as DanteState;
    const score = computeEnterpriseReadinessScore(state, makeAssessment(50), { hasSecurityPolicy: true, hasVersionedChangelog: false, hasRunbook: false, hasContributing: false });
    assert.equal(score, 25); // 15 + 10
  });

  it('hasVersionedChangelog flag adds +5', () => {
    const state = { auditLog: [] } as DanteState;
    const score = computeEnterpriseReadinessScore(state, makeAssessment(50), { hasSecurityPolicy: false, hasVersionedChangelog: true, hasRunbook: false, hasContributing: false });
    assert.equal(score, 20); // 15 + 5
  });

  it('hasRunbook flag adds +5', () => {
    const state = { auditLog: [] } as DanteState;
    const score = computeEnterpriseReadinessScore(state, makeAssessment(50), { hasSecurityPolicy: false, hasVersionedChangelog: false, hasRunbook: true, hasContributing: false });
    assert.equal(score, 20); // 15 + 5
  });

  it('hasContributing flag adds +3', () => {
    const state = { auditLog: [] } as DanteState;
    const score = computeEnterpriseReadinessScore(state, makeAssessment(50), { hasSecurityPolicy: false, hasVersionedChangelog: false, hasRunbook: false, hasContributing: true });
    assert.equal(score, 18); // 15 + 3
  });

  it('all signals + all enterprise flags → capped at 100', () => {
    const state = {
      auditLog: Array.from({ length: 25 }, (_, i) => `entry${i}`),
      selfEditPolicy: 'deny',
      lastVerifyReceiptPath: '/path/receipt.json',
    } as DanteState;
    const score = computeEnterpriseReadinessScore(state, makeAssessment(90), { hasSecurityPolicy: true, hasVersionedChangelog: true, hasRunbook: true, hasContributing: true });
    assert.equal(score, 100); // 85 + 10 + 5 + 5 + 3 = 108 → capped at 100
  });

  it('undefined enterprise flags behave same as no flags (backward compat)', () => {
    const state = {
      auditLog: Array.from({ length: 25 }, (_, i) => `entry${i}`),
      selfEditPolicy: 'deny',
      lastVerifyReceiptPath: '/path/receipt.json',
    } as DanteState;
    assert.equal(computeEnterpriseReadinessScore(state, makeAssessment(90), undefined), 85);
  });
});
