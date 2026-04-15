import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeGapPriority,
  getNextSprintDimension,
  updateDimensionScore,
  computeOverallScore,
  bootstrapMatrixFromComparison,
  loadMatrix,
  saveMatrix,
  isOssTool,
  computeTwoGaps,
  checkMatrixStaleness,
  FREQUENCY_MULTIPLIERS,
  type MatrixDimension,
  type CompeteMatrix,
} from '../src/core/compete-matrix.js';
import type { CompetitorComparison } from '../src/core/competitor-scanner.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDim(overrides: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id: 'test_dim',
    label: 'Test Dimension',
    weight: 1.0,
    category: 'quality',
    frequency: 'medium',
    scores: { self: 5.0, cursor: 9.0 },
    gap_to_leader: 4.0,
    leader: 'cursor',
    gap_to_closed_source_leader: 4.0,
    closed_source_leader: 'cursor',
    gap_to_oss_leader: 0,
    oss_leader: 'unknown',
    status: 'not-started',
    sprint_history: [],
    next_sprint_target: 7.0,
    ...overrides,
  };
}

function makeMatrix(dims: MatrixDimension[] = []): CompeteMatrix {
  return {
    project: 'TestProject',
    competitors: ['cursor', 'copilot'],
    lastUpdated: '2026-04-13T00:00:00.000Z',
    overallSelfScore: 5.0,
    dimensions: dims,
  };
}

// ── T1: computeGapPriority — high frequency + large gap = highest priority ───

describe('compete-matrix', () => {
  it('T1: computeGapPriority ranks high-frequency + large-gap dimensions highest', () => {
    const highFreqLargeGap = makeDim({ weight: 1.5, gap_to_leader: 5.0, frequency: 'high' });
    const lowFreqSmallGap  = makeDim({ weight: 1.0, gap_to_leader: 1.0, frequency: 'low' });
    const medFreqMedGap    = makeDim({ weight: 1.0, gap_to_leader: 3.0, frequency: 'medium' });

    const p1 = computeGapPriority(highFreqLargeGap); // 1.5 * 5.0 * 1.5 = 11.25
    const p2 = computeGapPriority(lowFreqSmallGap);  // 1.0 * 1.0 * 0.5 = 0.5
    const p3 = computeGapPriority(medFreqMedGap);    // 1.0 * 3.0 * 1.0 = 3.0

    assert.ok(p1 > p3, 'high-freq large-gap should beat medium');
    assert.ok(p3 > p2, 'medium should beat low-freq small-gap');
    assert.strictEqual(p1, 1.5 * 5.0 * FREQUENCY_MULTIPLIERS['high']);
    assert.strictEqual(p2, 1.0 * 1.0 * FREQUENCY_MULTIPLIERS['low']);
  });

  // ── T2: getNextSprintDimension — skips 'closed' dimensions ─────────────────

  it('T2: getNextSprintDimension skips closed dimensions and picks highest priority', () => {
    const closed   = makeDim({ id: 'closed_dim', gap_to_leader: 8.0, frequency: 'high', weight: 2.0, status: 'closed' });
    const open1    = makeDim({ id: 'open1', gap_to_leader: 3.0, frequency: 'medium', weight: 1.0, status: 'not-started' });
    const open2    = makeDim({ id: 'open2', gap_to_leader: 5.0, frequency: 'high', weight: 1.5, status: 'in-progress' });

    const matrix = makeMatrix([closed, open1, open2]);
    const next = getNextSprintDimension(matrix);

    assert.ok(next !== null);
    assert.strictEqual(next!.id, 'open2', 'Should pick open2 (highest priority among non-closed)');
  });

  it('T2b: getNextSprintDimension returns null when all dimensions are closed', () => {
    const allClosed = [
      makeDim({ id: 'a', status: 'closed' }),
      makeDim({ id: 'b', status: 'closed' }),
    ];
    const result = getNextSprintDimension(makeMatrix(allClosed));
    assert.strictEqual(result, null);
  });

  // ── T3: updateDimensionScore — appends sprint record, recomputes gap ────────

  it('T3: updateDimensionScore appends sprint record and recomputes gap_to_leader', () => {
    const dim = makeDim({ id: 'ux_polish', scores: { self: 5.0, cursor: 9.0, copilot: 8.0 }, gap_to_leader: 4.0 });
    const matrix = makeMatrix([dim]);

    updateDimensionScore(matrix, 'ux_polish', 7.5, 'abc123');

    const updated = matrix.dimensions[0]!;
    assert.strictEqual(updated.scores['self'], 7.5);
    assert.strictEqual(updated.gap_to_leader, 1.5); // 9.0 - 7.5
    assert.strictEqual(updated.sprint_history.length, 1);
    assert.strictEqual(updated.sprint_history[0]!.before, 5.0);
    assert.strictEqual(updated.sprint_history[0]!.after, 7.5);
    assert.strictEqual(updated.sprint_history[0]!.commit, 'abc123');
  });

  it('T3b: updateDimensionScore sets status to closed when gap reaches 0', () => {
    const dim = makeDim({ id: 'test', scores: { self: 5.0, cursor: 8.0 }, gap_to_leader: 3.0, status: 'in-progress' });
    const matrix = makeMatrix([dim]);

    updateDimensionScore(matrix, 'test', 8.5); // beats the leader
    assert.strictEqual(matrix.dimensions[0]!.status, 'closed');
    assert.strictEqual(matrix.dimensions[0]!.gap_to_leader, 0);
  });

  // ── T4: computeOverallScore — weighted average ──────────────────────────────

  it('T4: computeOverallScore computes weighted average correctly', () => {
    const dim1 = makeDim({ id: 'd1', weight: 2.0, scores: { self: 8.0 } });
    const dim2 = makeDim({ id: 'd2', weight: 1.0, scores: { self: 5.0 } });
    const matrix = makeMatrix([dim1, dim2]);

    const score = computeOverallScore(matrix);
    // (2.0 * 8.0 + 1.0 * 5.0) / (2.0 + 1.0) = 21.0 / 3.0 = 7.0
    assert.strictEqual(score, 7.0);
  });

  // ── T5: bootstrapMatrixFromComparison ───────────────────────────────────────

  it('T5: bootstrapMatrixFromComparison maps CompetitorComparison to CompeteMatrix', () => {
    const mockComparison: CompetitorComparison = {
      ourDimensions: {
        functionality: 60, testing: 50, errorHandling: 55, security: 65,
        uxPolish: 45, documentation: 60, performance: 55, maintainability: 60,
        developerExperience: 50, autonomy: 70, planningQuality: 65, selfImprovement: 55,
        specDrivenPipeline: 75, convergenceSelfHealing: 60, tokenEconomy: 50,
        ecosystemMcp: 40, enterpriseReadiness: 45, communityAdoption: 30,
      },
      projectName: 'TestForge',
      competitors: [
        {
          name: 'Cursor',
          url: 'https://cursor.com',
          description: 'AI editor',
          source: 'hardcoded',
          scores: {
            functionality: 85, testing: 70, errorHandling: 68, security: 72,
            uxPolish: 92, documentation: 72, performance: 74, maintainability: 76,
            developerExperience: 90, autonomy: 65, planningQuality: 62, selfImprovement: 50,
            specDrivenPipeline: 35, convergenceSelfHealing: 40, tokenEconomy: 70,
            ecosystemMcp: 65, enterpriseReadiness: 60, communityAdoption: 95,
          },
        },
      ],
      leaderboard: [{ name: 'Cursor', avgScore: 72, rank: 1 }],
      gapReport: [
        { dimension: 'uxPolish', ourScore: 45, bestScore: 92, bestCompetitor: 'Cursor', delta: 47, severity: 'critical' },
        { dimension: 'functionality', ourScore: 60, bestScore: 85, bestCompetitor: 'Cursor', delta: 25, severity: 'major' },
      ],
      overallGap: 25,
      competitorSource: 'hardcoded',
      analysisTimestamp: '2026-04-13T00:00:00.000Z',
    };

    const matrix = bootstrapMatrixFromComparison(mockComparison, 'TestForge');

    assert.strictEqual(matrix.project, 'TestForge');
    assert.ok(matrix.competitors.includes('Cursor'));
    assert.ok(matrix.dimensions.length > 0);

    // Self scores should be 0-10 (normalized from 0-100)
    for (const dim of matrix.dimensions) {
      const selfScore = dim.scores['self'] ?? 0;
      assert.ok(selfScore >= 0 && selfScore <= 10, `Self score ${selfScore} out of 0-10 range for ${dim.id}`);
      assert.ok(dim.gap_to_leader >= 0, `gap_to_leader should be non-negative for ${dim.id}`);
      assert.strictEqual(dim.status, 'not-started');
      assert.deepStrictEqual(dim.sprint_history, []);
    }

    assert.ok(matrix.overallSelfScore >= 0 && matrix.overallSelfScore <= 10);
  });

  // ── T6: loadMatrix/saveMatrix roundtrip ─────────────────────────────────────

  it('T6: loadMatrix/saveMatrix roundtrip via injected fs', async () => {
    const store: Record<string, string> = {};
    const fsRead = async (p: string) => {
      if (!(p in store)) throw new Error('not found');
      return store[p]!;
    };
    const fsWrite = async (p: string, content: string) => { store[p] = content; };

    const dim = makeDim({ id: 'roundtrip_dim', scores: { self: 6.5, copilot: 8.0 }, gap_to_leader: 1.5 });
    const original = makeMatrix([dim]);

    await saveMatrix(original, '/fake/cwd', fsWrite);
    const loaded = await loadMatrix('/fake/cwd', fsRead);

    assert.ok(loaded !== null);
    assert.strictEqual(loaded!.project, original.project);
    assert.strictEqual(loaded!.dimensions.length, 1);
    assert.strictEqual(loaded!.dimensions[0]!.id, 'roundtrip_dim');
    assert.strictEqual(loaded!.dimensions[0]!.scores['self'], 6.5);
  });

  // ── T7: isOssTool classifies correctly ──────────────────────────────────────

  it('T7: isOssTool classifies Aider/Continue as OSS and Cursor/Copilot as closed-source', () => {
    // Known OSS tools
    assert.ok(isOssTool('Aider'), 'Aider should be OSS');
    assert.ok(isOssTool('Continue'), 'Continue should be OSS');
    assert.ok(isOssTool('Continue.dev'), 'Continue.dev should be OSS');
    assert.ok(isOssTool('Tabby'), 'Tabby should be OSS');
    assert.ok(isOssTool('OpenHands'), 'OpenHands should be OSS');
    assert.ok(isOssTool('SWE-Agent (Princeton)'), 'SWE-Agent (Princeton) should be OSS via prefix match');

    // Closed-source tools
    assert.ok(!isOssTool('Cursor'), 'Cursor should NOT be OSS');
    assert.ok(!isOssTool('GitHub Copilot Workspace'), 'Copilot should NOT be OSS');
    assert.ok(!isOssTool('Devin (Cognition AI)'), 'Devin should NOT be OSS');
    assert.ok(!isOssTool('Kiro'), 'Kiro should NOT be OSS');
  });

  // ── T8: bootstrapMatrixFromComparison populates competitor split ────────────

  it('T8: bootstrapMatrixFromComparison splits competitors into OSS and closed-source lists', () => {
    const comparison: CompetitorComparison = {
      ourDimensions: {
        uxPolish: 45, functionality: 60, testing: 50, errorHandling: 55,
        security: 65, documentation: 60, performance: 55, maintainability: 60,
        developerExperience: 50, autonomy: 70, planningQuality: 65, selfImprovement: 55,
        specDrivenPipeline: 75, convergenceSelfHealing: 60, tokenEconomy: 50,
        ecosystemMcp: 40, enterpriseReadiness: 45, communityAdoption: 30,
      },
      projectName: 'TestForge',
      competitors: [
        { name: 'Cursor', url: '', description: '', source: 'hardcoded',
          scores: { uxPolish: 92, functionality: 85, testing: 70, errorHandling: 68, security: 72, documentation: 72, performance: 74, maintainability: 76, developerExperience: 90, autonomy: 65, planningQuality: 62, selfImprovement: 50, specDrivenPipeline: 35, convergenceSelfHealing: 40, tokenEconomy: 70, ecosystemMcp: 65, enterpriseReadiness: 60, communityAdoption: 95 } },
        { name: 'Aider', url: '', description: '', source: 'hardcoded',
          scores: { uxPolish: 58, functionality: 78, testing: 68, errorHandling: 65, security: 62, documentation: 70, performance: 65, maintainability: 70, developerExperience: 75, autonomy: 70, planningQuality: 60, selfImprovement: 55, specDrivenPipeline: 30, convergenceSelfHealing: 50, tokenEconomy: 55, ecosystemMcp: 40, enterpriseReadiness: 35, communityAdoption: 82 } },
      ],
      leaderboard: [{ name: 'Cursor', avgScore: 72, rank: 1 }, { name: 'Aider', avgScore: 62, rank: 2 }],
      gapReport: [
        { dimension: 'uxPolish', ourScore: 45, bestScore: 92, bestCompetitor: 'Cursor', delta: 47, severity: 'critical' },
      ],
      overallGap: 25,
      competitorSource: 'hardcoded',
      analysisTimestamp: '2026-04-13T00:00:00.000Z',
    };

    const matrix = bootstrapMatrixFromComparison(comparison, 'TestForge');

    assert.ok(matrix.competitors_closed_source.includes('Cursor'), 'Cursor should be in closed-source list');
    assert.ok(!matrix.competitors_closed_source.includes('Aider'), 'Aider should NOT be in closed-source list');
    assert.ok(matrix.competitors_oss.includes('Aider'), 'Aider should be in OSS list');
    assert.ok(!matrix.competitors_oss.includes('Cursor'), 'Cursor should NOT be in OSS list');
    assert.ok(matrix.competitors.includes('Cursor'), 'Cursor should be in flat list (backward compat)');
    assert.ok(matrix.competitors.includes('Aider'), 'Aider should be in flat list (backward compat)');
  });

  // ── T9: bootstrapMatrixFromComparison sets two-gap fields ──────────────────

  it('T9: bootstrapMatrixFromComparison sets gap_to_oss_leader and gap_to_closed_source_leader', () => {
    const comparison: CompetitorComparison = {
      ourDimensions: {
        uxPolish: 45, functionality: 60, testing: 50, errorHandling: 55,
        security: 65, documentation: 60, performance: 55, maintainability: 60,
        developerExperience: 50, autonomy: 70, planningQuality: 65, selfImprovement: 55,
        specDrivenPipeline: 75, convergenceSelfHealing: 60, tokenEconomy: 50,
        ecosystemMcp: 40, enterpriseReadiness: 45, communityAdoption: 30,
      },
      projectName: 'TestForge',
      competitors: [
        { name: 'Cursor', url: '', description: '', source: 'hardcoded',
          scores: { uxPolish: 92, functionality: 85, testing: 70, errorHandling: 68, security: 72, documentation: 72, performance: 74, maintainability: 76, developerExperience: 90, autonomy: 65, planningQuality: 62, selfImprovement: 50, specDrivenPipeline: 35, convergenceSelfHealing: 40, tokenEconomy: 70, ecosystemMcp: 65, enterpriseReadiness: 60, communityAdoption: 95 } },
        { name: 'Aider', url: '', description: '', source: 'hardcoded',
          scores: { uxPolish: 70, functionality: 78, testing: 68, errorHandling: 65, security: 62, documentation: 70, performance: 65, maintainability: 70, developerExperience: 75, autonomy: 70, planningQuality: 60, selfImprovement: 55, specDrivenPipeline: 30, convergenceSelfHealing: 50, tokenEconomy: 55, ecosystemMcp: 40, enterpriseReadiness: 35, communityAdoption: 82 } },
      ],
      leaderboard: [],
      gapReport: [
        { dimension: 'uxPolish', ourScore: 45, bestScore: 92, bestCompetitor: 'Cursor', delta: 47, severity: 'critical' },
      ],
      overallGap: 25,
      competitorSource: 'hardcoded',
      analysisTimestamp: '2026-04-13T00:00:00.000Z',
    };

    const matrix = bootstrapMatrixFromComparison(comparison, 'TestForge');
    const dim = matrix.dimensions.find(d => d.id === 'ux_polish');
    assert.ok(dim !== undefined, 'ux_polish dimension should exist');

    // Self = 4.5, Cursor = 9.2, Aider = 7.0
    // gap_to_closed_source_leader = 9.2 - 4.5 = 4.7
    // gap_to_oss_leader = 7.0 - 4.5 = 2.5
    assert.strictEqual(dim!.closed_source_leader, 'Cursor');
    assert.strictEqual(dim!.oss_leader, 'Aider');
    assert.ok(dim!.gap_to_closed_source_leader > dim!.gap_to_oss_leader,
      'Closed-source gap should be larger than OSS gap (Cursor > Aider)');
    assert.ok(dim!.gap_to_oss_leader > 0, 'OSS gap should be positive');
    assert.ok(dim!.gap_to_closed_source_leader > 0, 'Closed-source gap should be positive');
    // harvest_source should be set to the OSS leader
    assert.strictEqual(dim!.harvest_source, 'Aider', 'harvest_source should be populated with OSS leader');
  });

  // ── T10: updateDimensionScore recomputes both gap fields ────────────────────

  it('T10: updateDimensionScore recomputes gap_to_oss_leader and gap_to_closed_source_leader', () => {
    const dim = makeDim({
      id: 'ux_polish',
      scores: { self: 4.5, Cursor: 9.2, Aider: 7.0 },
      gap_to_leader: 4.7,
      gap_to_closed_source_leader: 4.7,
      closed_source_leader: 'Cursor',
      gap_to_oss_leader: 2.5,
      oss_leader: 'Aider',
    } as Partial<MatrixDimension>);

    const matrix: CompeteMatrix = {
      project: 'TestProject',
      competitors: ['Cursor', 'Aider'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: ['Aider'],
      lastUpdated: new Date().toISOString(),
      overallSelfScore: 4.5,
      dimensions: [dim],
    };

    // Update self score to 6.0 — should close OSS gap partially
    updateDimensionScore(matrix, 'ux_polish', 6.0);

    const updated = matrix.dimensions[0]!;
    // gap_to_oss_leader: 7.0 - 6.0 = 1.0
    // gap_to_closed_source_leader: 9.2 - 6.0 = 3.2
    assert.ok(updated.gap_to_oss_leader < updated.gap_to_closed_source_leader,
      'OSS gap should be smaller than closed-source gap after update');
    assert.ok(updated.gap_to_oss_leader >= 0, 'OSS gap should be non-negative');
    assert.ok(updated.gap_to_closed_source_leader >= 0, 'Closed-source gap should be non-negative');
  });
});

// ── checkMatrixStaleness ──────────────────────────────────────────────────────

describe('checkMatrixStaleness', () => {
  function makeMatrix(daysAgo: number): CompeteMatrix {
    const lastUpdated = new Date(Date.now() - daysAgo * 86400000).toISOString();
    return {
      project: 'Test',
      competitors: ['cursor'],
      competitors_closed_source: ['cursor'],
      competitors_oss: [],
      lastUpdated,
      overallSelfScore: 5.0,
      dimensions: [
        makeDim({ id: 'ux_polish', scores: { self: 5.0, cursor: 9.0 } }),
        makeDim({ id: 'testing', scores: { self: 6.0, cursor: 8.0 } }),
      ],
    };
  }

  it('T13: detects staleness when matrix exceeds threshold days', () => {
    const matrix = makeMatrix(8);
    const report = checkMatrixStaleness(matrix, undefined, 7);
    assert.strictEqual(report.isStale, true, 'Matrix 8 days old should be stale at 7-day threshold');
    assert.ok(report.daysOld >= 8, 'daysOld should reflect actual age');
  });

  it('T13b: does not flag as stale when under threshold', () => {
    const matrix = makeMatrix(5);
    const report = checkMatrixStaleness(matrix, undefined, 7);
    assert.strictEqual(report.isStale, false, 'Matrix 5 days old should not be stale at 7-day threshold');
  });

  it('T14: detects score drift above threshold when harsh dimensions provided', () => {
    const matrix = makeMatrix(1);
    // harsh-scorer uses camelCase; matrix uses snake_case id
    const harshDimensions = { uxPolish: 3.0 }; // matrix says 5.0 → drift = 2.0 ≥ 0.5
    const report = checkMatrixStaleness(matrix, harshDimensions, 7, 0.5);
    assert.strictEqual(report.driftedDimensions.length, 1, 'Should detect one drifted dimension');
    assert.strictEqual(report.driftedDimensions[0]!.id, 'ux_polish');
    assert.strictEqual(report.driftedDimensions[0]!.matrixScore, 5.0);
    assert.strictEqual(report.driftedDimensions[0]!.harshScore, 3.0);
    assert.strictEqual(report.driftedDimensions[0]!.drift, 2.0);
  });

  it('T15: returns empty drift array when no harsh dimensions provided', () => {
    const matrix = makeMatrix(1);
    const report = checkMatrixStaleness(matrix);
    assert.strictEqual(report.driftedDimensions.length, 0, 'No drift when no harsh dimensions given');
  });

  it('T15b: does not flag drift below threshold', () => {
    const matrix = makeMatrix(1);
    const harshDimensions = { uxPolish: 5.3 }; // drift = 0.3 < 0.5 threshold
    const report = checkMatrixStaleness(matrix, harshDimensions, 7, 0.5);
    assert.strictEqual(report.driftedDimensions.length, 0, 'Drift below threshold should not be flagged');
  });
});
