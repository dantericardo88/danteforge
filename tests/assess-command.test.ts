// Assess Command — tests for full flow, passesThreshold logic, output modes,
// and injection seam wiring.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assess,
  type AssessOptions,
  type AssessResult,
} from '../src/cli/commands/assess.js';
import type { HarshScoreResult, ScoringDimension } from '../src/core/harsh-scorer.js';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';
import type { CompetitorComparison } from '../src/core/competitor-scanner.js';
import type { Masterplan } from '../src/core/gap-masterplan.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_DIMS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
  'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
  'specDrivenPipeline', 'convergenceSelfHealing', 'tokenEconomy', 'contextEconomy',
  'ecosystemMcp', 'enterpriseReadiness', 'communityAdoption',
];

function makeDims(score: number): Record<ScoringDimension, number> {
  return Object.fromEntries(ALL_DIMS.map((d) => [d, score])) as Record<ScoringDimension, number>;
}

function makeMaturityAssessment(overallScore = 72): MaturityAssessment {
  return {
    currentLevel: 4, targetLevel: 5, overallScore,
    dimensions: {
      functionality: overallScore, testing: overallScore, errorHandling: overallScore,
      security: overallScore, uxPolish: overallScore, documentation: overallScore,
      performance: overallScore, maintainability: overallScore,
    },
    gaps: [], founderExplanation: 'Beta.', recommendation: 'refine',
    timestamp: new Date().toISOString(),
  };
}

function makeHarshResult(displayScore: number, overrides: Partial<HarshScoreResult> = {}): HarshScoreResult {
  const internal = displayScore * 10;
  const dims = makeDims(internal);
  return {
    rawScore: internal,
    harshScore: internal,
    displayScore,
    dimensions: dims,
    displayDimensions: Object.fromEntries(
      Object.entries(dims).map(([k, v]) => [k, v / 10]),
    ) as Record<ScoringDimension, number>,
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: displayScore >= 8.5 ? 'excellent' : displayScore >= 7.0 ? 'acceptable' : 'needs-work',
    maturityAssessment: makeMaturityAssessment(internal),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeComparison(): CompetitorComparison {
  return {
    ourDimensions: makeDims(72),
    competitors: [],
    leaderboard: [{ name: 'DanteForge', avgScore: 7.2, rank: 1 }],
    gapReport: ALL_DIMS.map((dim) => ({
      dimension: dim, ourScore: 72, bestScore: 85,
      bestCompetitor: 'Devin', delta: 13, severity: 'major' as const,
    })),
    overallGap: 13,
    analysisTimestamp: new Date().toISOString(),
  };
}

function makeMasterplan(itemCount = 5): Masterplan {
  return {
    generatedAt: new Date().toISOString(),
    cycleNumber: 1,
    overallScore: 7.2,
    targetScore: 9.0,
    gapToTarget: 1.8,
    items: Array.from({ length: itemCount }, (_, i) => ({
      id: `P1-0${i + 1}`,
      priority: 'P1' as const,
      dimension: 'testing' as ScoringDimension,
      currentScore: 7.2,
      targetScore: 9.0,
      title: `Action ${i + 1}`,
      description: `Fix dimension ${i + 1}`,
      forgeCommand: 'danteforge forge "fix"',
      verifyCondition: 'tests pass',
      estimatedDelta: 0.5,
    })),
    criticalCount: 0,
    majorCount: itemCount,
    projectedCycles: 4,
  };
}

function makeOptions(overrides: Partial<AssessOptions> = {}): AssessOptions {
  return {
    cwd: '/fake/project',
    harsh: true,
    competitors: true,
    minScore: 9.0,
    _harshScore: async () => makeHarshResult(7.2),
    _scanCompetitors: async () => makeComparison(),
    _generateMasterplan: async () => makeMasterplan(),
    _buildProjectContext: async () => ({ projectName: 'TestProject' }),
    ...overrides,
  };
}

// ── assess() ─────────────────────────────────────────────────────────────────

describe('assess', () => {
  it('returns AssessResult with all required fields', async () => {
    const result = await assess(makeOptions());
    assert.ok(result.assessment, 'assessment present');
    assert.ok(result.masterplan, 'masterplan present');
    assert.ok(typeof result.overallScore === 'number', 'overallScore is number');
    assert.ok(typeof result.passesThreshold === 'boolean', 'passesThreshold is boolean');
    assert.ok(typeof result.minScore === 'number', 'minScore is number');
  });

  it('passesThreshold=true when displayScore >= minScore', async () => {
    const result = await assess(makeOptions({
      _harshScore: async () => makeHarshResult(9.5),
      minScore: 9.0,
    }));
    assert.equal(result.passesThreshold, true);
    assert.equal(result.overallScore, 9.5);
  });

  it('passesThreshold=false when displayScore < minScore', async () => {
    const result = await assess(makeOptions({
      _harshScore: async () => makeHarshResult(7.2),
      minScore: 9.0,
    }));
    assert.equal(result.passesThreshold, false);
  });

  it('passesThreshold=true at exact minScore', async () => {
    const result = await assess(makeOptions({
      _harshScore: async () => makeHarshResult(9.0),
      minScore: 9.0,
    }));
    assert.equal(result.passesThreshold, true);
  });

  it('uses custom minScore', async () => {
    const result = await assess(makeOptions({
      _harshScore: async () => makeHarshResult(7.5),
      minScore: 7.0,
    }));
    assert.equal(result.passesThreshold, true);
    assert.equal(result.minScore, 7.0);
  });

  it('skips competitor scan when competitors=false', async () => {
    let scanCalled = false;
    const result = await assess(makeOptions({
      competitors: false,
      _scanCompetitors: async () => { scanCalled = true; return makeComparison(); },
    }));
    assert.equal(scanCalled, false);
    assert.equal(result.comparison, undefined);
  });

  it('includes comparison when competitors=true', async () => {
    const result = await assess(makeOptions());
    assert.ok(result.comparison !== undefined, 'comparison should be present');
  });

  it('continues gracefully when competitor scan throws', async () => {
    const result = await assess(makeOptions({
      _scanCompetitors: async () => { throw new Error('network error'); },
    }));
    assert.equal(result.comparison, undefined, 'comparison undefined on scan error');
    assert.ok(result.masterplan, 'masterplan still generated');
  });

  it('passes cycleNumber to generateMasterplan', async () => {
    let capturedCycle: number | undefined;
    await assess(makeOptions({
      cycleNumber: 5,
      _generateMasterplan: async (opts) => {
        capturedCycle = opts.cycleNumber;
        return makeMasterplan();
      },
    }));
    assert.equal(capturedCycle, 5);
  });

  it('passes minScore as targetScore to generateMasterplan', async () => {
    let capturedTarget: number | undefined;
    await assess(makeOptions({
      minScore: 8.5,
      _generateMasterplan: async (opts) => {
        capturedTarget = opts.targetScore;
        return makeMasterplan();
      },
    }));
    assert.equal(capturedTarget, 8.5);
  });

  it('returns JSON-serializable result', async () => {
    const result = await assess(makeOptions());
    // Should not throw
    const json = JSON.stringify(result);
    assert.ok(json.length > 0);
  });

  it('overallScore matches assessment.displayScore', async () => {
    const result = await assess(makeOptions({
      _harshScore: async () => makeHarshResult(7.8),
    }));
    assert.equal(result.overallScore, 7.8);
  });

  it('uses preset targetMaturityLevel when preset provided', async () => {
    let capturedTargetLevel: number | undefined;
    await assess(makeOptions({
      preset: 'inferno',
      _harshScore: async (opts) => {
        capturedTargetLevel = opts.targetLevel;
        return makeHarshResult(7.2);
      },
    }));
    assert.equal(capturedTargetLevel, 6, 'inferno should use targetMaturityLevel=6');
  });

  it('_strictDimensions overrides autonomy/selfImprovement/convergenceSelfHealing in result', async () => {
    const result = await assess(makeOptions({
      _strictDimensions: async () => ({
        autonomy: 100,
        selfImprovement: 100,
        convergenceSelfHealing: 95,
        errorHandling: 80,
        security: 80,
        enterpriseReadiness: 90,
        documentation: 80,
      }),
    }));
    assert.equal(result.assessment.displayDimensions.autonomy, 10);
    assert.equal(result.assessment.displayDimensions.selfImprovement, 10);
    assert.equal(result.assessment.displayDimensions.convergenceSelfHealing, 9.5);
  });

  it('_strictDimensions does not affect other dimensions', async () => {
    const base = makeHarshResult(7.2);
    const origSecurity = base.displayDimensions.security;
    const result = await assess(makeOptions({
      _harshScore: async () => base,
      _strictDimensions: async () => ({
        autonomy: 100,
        selfImprovement: 100,
        convergenceSelfHealing: 95,
        errorHandling: 80,
        security: 80,
        enterpriseReadiness: 90,
        documentation: 80,
      }),
    }));
    assert.equal(result.assessment.displayDimensions.security, origSecurity);
  });

  it('assess continues normally when _strictDimensions throws', async () => {
    const result = await assess(makeOptions({
      _strictDimensions: async () => { throw new Error('strict dims unavailable'); },
    }));
    assert.ok(result.overallScore >= 0);
    assert.ok(result.assessment.displayDimensions.autonomy !== undefined);
  });
});
