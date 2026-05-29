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
  getDimensionStrategy,
  computeUnweightedComposite,
  getTopGapDimensions,
  classifyDimensions,
  excludeDimension,
  includeDimension,
  HUMAN_ACTION_DIMENSION_IDS,
  FREQUENCY_MULTIPLIERS,
  addOrUpdateCompetitor,
  addOrUpdateDimension,
  applyAdversarialCalibration,
  type MatrixDimension,
  type CompeteMatrix,
} from '../src/core/compete-matrix.js';
import type { CompetitorComparison } from '../src/core/competitor-scanner.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

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
    assert.ok(isOssTool('re_gent'), 're_gent should be OSS');
    assert.ok(isOssTool('Regent'), 'Regent should be OSS');
    assert.ok(isOssTool('regent-vcs/re_gent'), 'regent-vcs/re_gent should be OSS via prefix match');

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

  it('T10b: addOrUpdateCompetitor buckets re_gent as OSS and recomputes gaps', () => {
    const dim = makeDim({
      id: 'agent_activity_provenance',
      label: 'Agent Activity Provenance & Time Travel',
      weight: 1.4,
      category: 'reliability',
      frequency: 'high',
      scores: { self: 8.2, Cursor: 4.0 },
      gap_to_leader: 0,
      leader: 'self',
      gap_to_closed_source_leader: 0,
      closed_source_leader: 'Cursor',
      gap_to_oss_leader: 0,
      oss_leader: 'unknown',
      next_sprint_target: 8.2,
    });
    const matrix: CompeteMatrix = {
      project: 'TestProject',
      competitors: ['Cursor'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: [],
      lastUpdated: '2026-05-10T00:00:00.000Z',
      overallSelfScore: 8.2,
      dimensions: [dim],
    };

    addOrUpdateCompetitor(matrix, 're_gent', { agent_activity_provenance: 8.6 });

    const updated = matrix.dimensions[0]!;
    assert.ok(matrix.competitors.includes('re_gent'), 'flat competitor list should include re_gent');
    assert.ok(matrix.competitors_oss.includes('re_gent'), 're_gent should be bucketed as OSS');
    assert.ok(!matrix.competitors_closed_source.includes('re_gent'), 're_gent should not be closed-source');
    assert.strictEqual(updated.leader, 're_gent');
    assert.strictEqual(updated.oss_leader, 're_gent');
    assert.strictEqual(updated.gap_to_leader, 0.4);
    assert.strictEqual(updated.gap_to_oss_leader, 0.4);
    assert.strictEqual(updated.gap_to_closed_source_leader, 0);
    assert.strictEqual(updated.harvest_source, 're_gent');
    assert.strictEqual(updated.next_sprint_target, 8.6);
  });

  it('T10c: addOrUpdateDimension adds the re_gent provenance sprint target', () => {
    const matrix: CompeteMatrix = {
      project: 'TestProject',
      competitors: ['Cursor', 're_gent'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: ['re_gent'],
      lastUpdated: '2026-05-10T00:00:00.000Z',
      overallSelfScore: 9,
      dimensions: [],
    };

    addOrUpdateDimension(matrix, {
      id: 'agent_activity_provenance',
      label: 'Agent Activity Provenance & Time Travel',
      weight: 1.4,
      category: 'reliability',
      frequency: 'high',
      scores: { self: 8.2, Cursor: 4.0, re_gent: 8.6 },
      status: 'not-started',
      sprint_history: [],
      next_sprint_target: 8.6,
      harvest_source: 're_gent',
    });

    const next = getNextSprintDimension(matrix);
    const dim = matrix.dimensions[0]!;
    assert.strictEqual(dim.leader, 're_gent');
    assert.strictEqual(dim.oss_leader, 're_gent');
    assert.strictEqual(dim.harvest_source, 're_gent');
    assert.strictEqual(dim.gap_to_leader, 0.4);
    assert.strictEqual(next?.id, 'agent_activity_provenance');
  });

  // ── T11: ceiling clamp ────────────────────────────────────────────────────────

  it('T11: updateDimensionScore clamps score to ceiling when score > ceiling', () => {
    // Use a non-market dim so this exercises pure ceiling clamping. Market dims
    // (enterprise_readiness / community_adoption) carry an additional hard 5.0
    // cap that would mask the ceiling under test — see T11c for that invariant.
    const dim = makeDim({
      id: 'testing',
      scores: { self: 4.0, Cursor: 9.0 },
      ceiling: 6.0,
    } as Partial<MatrixDimension>);
    const matrix: CompeteMatrix = {
      project: 'TestProject',
      competitors: ['Cursor'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: [],
      lastUpdated: new Date().toISOString(),
      overallSelfScore: 4.0,
      dimensions: [dim],
    };
    // Attempt to set score to 7.0, should be clamped to ceiling 6.0
    updateDimensionScore(matrix, 'testing', 7.0);
    assert.strictEqual(matrix.dimensions[0]!.scores['self'], 6.0, 'Score must be clamped to ceiling');
    assert.strictEqual(matrix.dimensions[0]!.sprint_history.at(-1)!.after, 6.0, 'Sprint record after must reflect clamped value');
  });

  it('T11b: updateDimensionScore accepts score exactly at ceiling', () => {
    const dim = makeDim({
      id: 'community_adoption',
      scores: { self: 2.0, Cursor: 9.0 },
      ceiling: 4.0,
    } as Partial<MatrixDimension>);
    const matrix: CompeteMatrix = {
      project: 'TestProject',
      competitors: ['Cursor'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: [],
      lastUpdated: new Date().toISOString(),
      overallSelfScore: 2.0,
      dimensions: [dim],
    };
    updateDimensionScore(matrix, 'community_adoption', 4.0);
    assert.strictEqual(matrix.dimensions[0]!.scores['self'], 4.0, 'Score exactly at ceiling should be accepted');
  });

  it('T11c: market dims hard-cap at 5.0 even when ceiling is higher', () => {
    // enterprise_readiness with a generous 9.0 ceiling — internal evidence still
    // cannot push it past 5.0. The market cap wins over the ceiling.
    const dim = makeDim({
      id: 'enterprise_readiness',
      scores: { self: 4.0, Cursor: 9.0 },
      ceiling: 9.0,
    } as Partial<MatrixDimension>);
    const matrix: CompeteMatrix = {
      project: 'TestProject',
      competitors: ['Cursor'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: [],
      lastUpdated: new Date().toISOString(),
      overallSelfScore: 4.0,
      dimensions: [dim],
    };
    updateDimensionScore(matrix, 'enterprise_readiness', 8.0);
    assert.strictEqual(matrix.dimensions[0]!.scores['self'], 5.0, 'Market dim must be capped at 5.0 regardless of ceiling');
  });

  it('T12: bootstrapMatrixFromComparison clamps initial selfScore to ceiling', () => {
    // enterpriseReadiness has KNOWN_CEILINGS entry: ceiling = 9.0
    // Our score raw = 90/10 = 9.0, which equals the ceiling
    const comparison: CompetitorComparison = {
      ourDimensions: { enterpriseReadiness: 90 },
      projectName: 'TestForge',
      competitors: [{
        name: 'Cursor', url: '', description: '', source: 'hardcoded' as const,
        scores: { enterpriseReadiness: 80 },
      }],
      leaderboard: [{ name: 'Cursor', avgScore: 80, rank: 1 }],
      gapReport: [{ dimension: 'enterpriseReadiness', ourScore: 90, bestScore: 80, bestCompetitor: 'Cursor', delta: -10, severity: 'none' as const }],
      overallGap: 0,
      competitorSource: 'hardcoded',
      analysisTimestamp: new Date().toISOString(),
    };
    const matrix = bootstrapMatrixFromComparison(comparison, 'TestForge');
    const dim = matrix.dimensions.find(d => d.id === 'enterprise_readiness');
    assert.ok(dim, 'enterprise_readiness dimension should exist');
    assert.ok(
      (dim!.scores['self'] ?? 99) <= 9.0,
      `enterpriseReadiness self score ${dim!.scores['self']} should be clamped to ceiling 9.0`,
    );
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

// ── getDimensionStrategy ──────────────────────────────────────────────────────

describe('getDimensionStrategy()', () => {
  it('returns ceiling when dim has a ceiling below target', () => {
    const dim = makeDim({ id: 'community_adoption', ceiling: 4.0 });
    assert.strictEqual(getDimensionStrategy(dim, 9.0), 'ceiling');
  });

  it('returns ceiling when ceiling equals target threshold', () => {
    // ceiling=8.0 < target=9.0 → still ceiling
    const dim = makeDim({ id: 'something', ceiling: 8.0 });
    assert.strictEqual(getDimensionStrategy(dim, 9.0), 'ceiling');
  });

  it('returns code when ceiling is above target', () => {
    // ceiling=9.5 >= target=9.0 → achievable via code
    const dim = makeDim({ id: 'context_economy', ceiling: 9.5 });
    assert.strictEqual(getDimensionStrategy(dim, 9.0), 'code');
  });

  it('returns human for known human-action dimension IDs', () => {
    for (const id of HUMAN_ACTION_DIMENSION_IDS) {
      const dim = makeDim({ id });
      assert.strictEqual(getDimensionStrategy(dim, 9.0), 'human', `${id} should be human`);
    }
  });

  it('explicit closingStrategy field overrides default lookup (when not ceiling)', () => {
    const dim = makeDim({ id: 'some_new_dim', closingStrategy: 'human' });
    assert.strictEqual(getDimensionStrategy(dim, 9.0), 'human');
  });

  it('ceiling check takes priority over explicit closingStrategy field', () => {
    // If ceiling < target, strategy is always ceiling regardless of closingStrategy field
    const dim = makeDim({ id: 'community_adoption', ceiling: 4.0, closingStrategy: 'human' as const });
    assert.strictEqual(getDimensionStrategy(dim, 9.0), 'ceiling');
  });

  it('returns code for unknown dimensions with no closingStrategy', () => {
    const dim = makeDim({ id: 'ocr_text_extraction' });
    assert.strictEqual(getDimensionStrategy(dim, 9.0), 'code');
  });
});

// ── computeUnweightedComposite ────────────────────────────────────────────────

describe('computeUnweightedComposite()', () => {
  it('returns unweighted mean of all self-scores', () => {
    const dims = [
      makeDim({ id: 'a', scores: { self: 8.0 }, weight: 2.0 }),
      makeDim({ id: 'b', scores: { self: 2.0 }, weight: 0.5 }),
    ];
    // unweighted mean = (8.0 + 2.0) / 2 = 5.0
    // weighted mean = (2.0*8.0 + 0.5*2.0) / 2.5 = (16+1)/2.5 = 6.8
    const matrix: CompeteMatrix = { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: dims };
    const composite = computeUnweightedComposite(matrix);
    assert.strictEqual(composite, 5.0, 'Must be plain mean, not weighted');
  });

  it('includes ceiling and human-action dims in the denominator', () => {
    const dims = [
      makeDim({ id: 'functionality', scores: { self: 9.0 } }),
      makeDim({ id: 'community_adoption', scores: { self: 1.0 }, ceiling: 4.0 }),
      makeDim({ id: 'code_signing', scores: { self: 0.0 } }),
    ];
    const matrix: CompeteMatrix = { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: dims };
    // (9.0 + 1.0 + 0.0) / 3 = 3.3
    const composite = computeUnweightedComposite(matrix);
    assert.strictEqual(composite, 3.3, 'Embarrassing dims must pull down the composite');
  });

  it('returns 0 for an empty matrix', () => {
    const matrix: CompeteMatrix = { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: [] };
    assert.strictEqual(computeUnweightedComposite(matrix), 0);
  });
});

// ── getTopGapDimensions ───────────────────────────────────────────────────────

describe('getTopGapDimensions()', () => {
  it('returns dims sorted by gap × importance, highest first', () => {
    const dims = [
      makeDim({ id: 'low_priority', weight: 0.5, gap_to_leader: 1.0, frequency: 'low', status: 'not-started' }),
      makeDim({ id: 'high_priority', weight: 1.5, gap_to_leader: 8.0, frequency: 'high', status: 'not-started' }),
      makeDim({ id: 'mid_priority',  weight: 1.0, gap_to_leader: 4.0, frequency: 'medium', status: 'not-started' }),
    ];
    const matrix: CompeteMatrix = { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: dims };
    const top = getTopGapDimensions(matrix, 3);
    assert.strictEqual(top[0]!.id, 'high_priority');
    assert.strictEqual(top[1]!.id, 'mid_priority');
    assert.strictEqual(top[2]!.id, 'low_priority');
  });

  it('includes ceiling and human-action dims (not just code-closable)', () => {
    const dims = [
      makeDim({ id: 'code_dim', weight: 1.0, gap_to_leader: 3.0, frequency: 'medium', status: 'not-started' }),
      makeDim({ id: 'community_adoption', weight: 0.7, gap_to_leader: 8.0, frequency: 'low', ceiling: 4.0, status: 'not-started' }),
    ];
    const matrix: CompeteMatrix = { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: dims };
    const top = getTopGapDimensions(matrix, 5);
    const ids = top.map(d => d.id);
    assert.ok(ids.includes('community_adoption'), 'Ceiling dims must appear in top gaps');
    assert.ok(ids.includes('code_dim'), 'Code dims must appear in top gaps');
  });

  it('excludes closed dimensions', () => {
    const dims = [
      makeDim({ id: 'done', gap_to_leader: 0.0, status: 'closed' }),
      makeDim({ id: 'open', gap_to_leader: 5.0, status: 'not-started' }),
    ];
    const matrix: CompeteMatrix = { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: dims };
    const top = getTopGapDimensions(matrix, 5);
    assert.ok(!top.some(d => d.id === 'done'), 'Closed dims must be excluded');
    assert.strictEqual(top.length, 1);
  });

  it('respects count limit', () => {
    const dims = Array.from({ length: 10 }, (_, i) =>
      makeDim({ id: `dim_${i}`, gap_to_leader: i + 1, status: 'not-started' }),
    );
    const matrix: CompeteMatrix = { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: dims };
    assert.strictEqual(getTopGapDimensions(matrix, 3).length, 3);
    assert.strictEqual(getTopGapDimensions(matrix, 5).length, 5);
  });
});

// ── applyAdversarialCalibration ───────────────────────────────────────────────

describe('applyAdversarialCalibration()', () => {
  function makeMatrix(selfScore: number): CompeteMatrix {
    const dim: MatrixDimension = {
      ...makeDim({ id: 'ux_polish', label: 'UX Polish' }),
      scores: { self: selfScore, Cursor: 9.2 },
      gap_to_leader: Math.max(0, 9.2 - selfScore),
      leader: 'Cursor',
    };
    return {
      project: 'p',
      competitors: ['Cursor'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: [],
      lastUpdated: '',
      overallSelfScore: selfScore,
      dimensions: [dim],
    };
  }

  it('T20: reduces inflated self-score to consensus of harsh and adversarial scores', () => {
    const matrix = makeMatrix(10.0);
    const applied = applyAdversarialCalibration(matrix, 'ux_polish', 8.0, 7.0, 'inflated', 'UX is aspirational');
    assert.ok(applied, 'should return true for inflated verdict');
    assert.strictEqual(matrix.dimensions[0]!.scores['self'], 7.5, 'consensus = (8.0 + 7.0) / 2 = 7.5');
    assert.ok(matrix.adversarialCalibrations?.length === 1, 'calibration record appended');
    assert.strictEqual(matrix.adversarialCalibrations![0]!.dimensionId, 'ux_polish');
    assert.strictEqual(matrix.adversarialCalibrations![0]!.verdict, 'inflated');
    assert.strictEqual(matrix.adversarialCalibrations![0]!.beforeScore, 10.0);
    assert.strictEqual(matrix.adversarialCalibrations![0]!.afterScore, 7.5);
  });

  it('T21: no-op for trusted verdict — returns false, score unchanged', () => {
    const matrix = makeMatrix(8.0);
    const applied = applyAdversarialCalibration(matrix, 'ux_polish', 8.0, 8.1, 'trusted', 'score matches');
    assert.strictEqual(applied, false);
    assert.strictEqual(matrix.dimensions[0]!.scores['self'], 8.0, 'score unchanged');
    assert.ok(!matrix.adversarialCalibrations?.length, 'no calibration record added');
  });

  it('T22: no-op for watch verdict', () => {
    const matrix = makeMatrix(9.0);
    const applied = applyAdversarialCalibration(matrix, 'ux_polish', 9.0, 8.0, 'watch', 'minor gap');
    assert.strictEqual(applied, false);
  });

  it('T23: no-op for unknown dimension id — returns false', () => {
    const matrix = makeMatrix(10.0);
    const applied = applyAdversarialCalibration(matrix, 'nonexistent_dim', 5.0, 4.0, 'inflated', 'x');
    assert.strictEqual(applied, false);
  });

  it('T24: respects ceiling — consensus clamped to ceiling', () => {
    const matrix = makeMatrix(10.0);
    matrix.dimensions[0]!.ceiling = 8.0;
    const applied = applyAdversarialCalibration(matrix, 'ux_polish', 9.0, 7.0, 'inflated', 'ceiling test');
    assert.ok(applied);
    assert.ok(matrix.dimensions[0]!.scores['self']! <= 8.0, 'score must not exceed ceiling');
  });

  it('T25: overall score is recomputed after calibration', () => {
    const matrix = makeMatrix(10.0);
    applyAdversarialCalibration(matrix, 'ux_polish', 8.0, 7.0, 'inflated', 'recompute test');
    assert.strictEqual(matrix.overallSelfScore, 7.5, 'overall score recomputed');
  });

  it('T26: gap_to_leader recomputed upward after score reduction', () => {
    const matrix = makeMatrix(10.0);
    applyAdversarialCalibration(matrix, 'ux_polish', 8.0, 7.0, 'inflated', 'gap test');
    const gap = matrix.dimensions[0]!.gap_to_leader;
    assert.ok(gap > 0, `gap should now be positive; got ${gap}`);
  });
});

// ── excludedDimensions filtering ─────────────────────────────────────────────

describe('excludedDimensions', () => {
  function makeDim(overrides: Partial<MatrixDimension> = {}): MatrixDimension {
    return {
      id: 'd', label: 'D', weight: 1.0, category: 'quality', frequency: 'medium',
      scores: { self: 5.0, cursor: 9.0 },
      gap_to_leader: 4.0, leader: 'cursor',
      gap_to_closed_source_leader: 4.0, closed_source_leader: 'cursor',
      gap_to_oss_leader: 0, oss_leader: 'unknown',
      status: 'not-started', sprint_history: [], next_sprint_target: 7.0,
      ...overrides,
    };
  }
  function makeMatrix(dims: MatrixDimension[]): CompeteMatrix {
    return {
      project: 'TestProject',
      competitors: ['cursor'],
      lastUpdated: '2026-04-13T00:00:00.000Z',
      overallSelfScore: 5.0,
      dimensions: dims,
    };
  }

  it('getNextSprintDimension skips excluded dimensions', () => {
    const a = makeDim({ id: 'a', gap_to_leader: 5.0, weight: 2.0 });
    const b = makeDim({ id: 'b', gap_to_leader: 3.0 });
    const matrix = makeMatrix([a, b]);
    matrix.excludedDimensions = ['a'];
    const next = getNextSprintDimension(matrix);
    assert.ok(next !== null);
    assert.strictEqual(next!.id, 'b', 'should pick b because a is excluded');
  });

  it('getTopGapDimensions skips excluded dimensions', () => {
    const a = makeDim({ id: 'a', gap_to_leader: 8.0, weight: 2.0, frequency: 'high' });
    const b = makeDim({ id: 'b', gap_to_leader: 5.0 });
    const matrix = makeMatrix([a, b]);
    matrix.excludedDimensions = ['a'];
    const top = getTopGapDimensions(matrix, 5);
    assert.strictEqual(top.length, 1);
    assert.strictEqual(top[0]!.id, 'b');
  });

  it('classifyDimensions skips excluded dimensions from both buckets', () => {
    const a = makeDim({ id: 'a' });
    const b = makeDim({ id: 'b', ceiling: 3.0, ceilingReason: 'human-bounded' });
    const matrix = makeMatrix([a, b]);
    matrix.excludedDimensions = ['a', 'b'];
    const { achievable, atCeiling } = classifyDimensions(matrix, 9.0);
    assert.strictEqual(achievable.length, 0);
    assert.strictEqual(atCeiling.length, 0);
  });

  it('excludeDimension is idempotent and records lastUpdated', async () => {
    const matrix = makeMatrix([makeDim({ id: 'x' })]);
    const before = matrix.lastUpdated;
    await new Promise(r => setTimeout(r, 5));
    excludeDimension(matrix, 'x');
    excludeDimension(matrix, 'x');
    assert.deepStrictEqual(matrix.excludedDimensions, ['x']);
    assert.notStrictEqual(matrix.lastUpdated, before);
  });

  it('includeDimension reverses a previous exclude', () => {
    const matrix = makeMatrix([makeDim({ id: 'x' })]);
    excludeDimension(matrix, 'x');
    includeDimension(matrix, 'x');
    assert.deepStrictEqual(matrix.excludedDimensions, []);
  });
});

// ── loadMatrix TTL cache ───────────────────────────────────────────────────────

import { invalidateMatrixCache } from '../src/core/compete-matrix.js';

describe('loadMatrix in-process cache', () => {
  it('returns cached result on second call when using real fs (via injected reads)', async () => {
    // Use injected reads so the cache key never matches real fs — safe isolation
    let readCount = 0;
    const dim = makeDim({ id: 'cache_test', scores: { self: 7.0 }, gap_to_leader: 1.0 });
    const matrixJson = JSON.stringify(makeMatrix([dim]));
    const fakeRead = async (_p: string) => { readCount++; return matrixJson; };

    const m1 = await loadMatrix('/fake/cache/cwd', fakeRead);
    const m2 = await loadMatrix('/fake/cache/cwd', fakeRead);

    // Both calls return valid matrices
    assert.ok(m1 !== null && m2 !== null);
    assert.strictEqual(m1!.dimensions[0]!.id, 'cache_test');
    // Injected reads bypass the cache, so readCount should be 2
    assert.strictEqual(readCount, 2);
  });

  it('invalidateMatrixCache is a callable export', () => {
    // Smoke test: should not throw
    assert.doesNotThrow(() => { invalidateMatrixCache(); });
  });

  it('saveMatrix calls through without error on injected write', async () => {
    let written = '';
    const dim = makeDim({ id: 'save_cache_test', scores: { self: 8.0 }, gap_to_leader: 0.5 });
    const matrix = makeMatrix([dim]);
    await saveMatrix(matrix, '/fake/save/cwd', async (_p, c) => { written = c; });
    const parsed = JSON.parse(written) as CompeteMatrix;
    assert.strictEqual(parsed.dimensions[0]!.id, 'save_cache_test');
  });
});

// ── Test-isolation guard ──────────────────────────────────────────────────────
// Regression for the matrix-clobber incident (council 2026-05-29): a test wrote
// the live .danteforge/compete/matrix.json. saveMatrix now refuses a real-disk
// write to a non-temp path during a test run.

describe('saveMatrix test-isolation guard', () => {
  it('THROWS on a real-disk write to a non-temp path during a test run', async () => {
    const matrix = makeMatrix([makeDim({ id: 'guard_test', scores: { self: 8.0 } })]);
    // No _fsWrite seam + a real (non-tmp) cwd → must throw rather than clobber.
    await assert.rejects(
      () => saveMatrix(matrix, 'X:/Projects/DanteForge'),
      /Refusing to write a real matrix\.json during a test run/,
    );
  });

  it('ALLOWS a real write when the cwd is under os.tmpdir()', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'df-matrix-guard-'));
    try {
      const matrix = makeMatrix([makeDim({ id: 'tmp_ok', scores: { self: 7.0 } })]);
      await saveMatrix(matrix, tmpRoot); // real write, but under tmp → allowed
      const written = await fs.readFile(path.join(tmpRoot, '.danteforge', 'compete', 'matrix.json'), 'utf8');
      assert.ok(written.includes('tmp_ok'));
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('ALLOWS any path when the _fsWrite seam is provided (no real disk write)', async () => {
    const matrix = makeMatrix([makeDim({ id: 'seam_ok', scores: { self: 9.0 } })]);
    let captured = '';
    // Seam present → guard does not fire even for a real-looking path.
    await saveMatrix(matrix, 'X:/Projects/DanteForge', async (_p, c) => { captured = c; });
    assert.ok(captured.includes('seam_ok'));
  });
});
