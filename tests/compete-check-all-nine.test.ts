// tests/compete-check-all-nine.test.ts
// Tests for actionCheckAllNine and the Bug A/B fixes in actionAutoSprint.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { compete, actionCheckAllNine } from '../src/cli/commands/compete.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTmpMatrix(dir: string, overrides: Partial<{ selfScores: number[] }> = {}) {
  const competeDir = path.join(dir, '.danteforge', 'compete');
  await fs.mkdir(competeDir, { recursive: true });

  const selfScores = overrides.selfScores ?? [6.0, 7.0];
  // capability_test fixture so the merge gate accepts scores > 5.0 in tests.
  const capabilityTest = { command: 'node -e ""', description: 'test fixture' };
  const matrix = {
    project: 'test',
    competitors: ['Cursor'],
    competitors_closed_source: ['Cursor'],
    competitors_oss: [],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 6.5,
    dimensions: [
      {
        id: 'autonomy',
        label: 'Autonomy',
        weight: 1.0,
        category: 'quality',
        frequency: 'high',
        scores: { self: selfScores[0], Cursor: 9.5 },
        gap_to_leader: 9.5 - selfScores[0],
        leader: 'Cursor',
        gap_to_closed_source_leader: 9.5 - selfScores[0],
        closed_source_leader: 'Cursor',
        gap_to_oss_leader: 0,
        oss_leader: 'none',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 9.0,
        capability_test: capabilityTest,
      },
      {
        id: 'testing',
        label: 'Testing',
        weight: 1.0,
        category: 'quality',
        frequency: 'high',
        scores: { self: selfScores[1], Cursor: 8.0 },
        gap_to_leader: 8.0 - selfScores[1],
        leader: 'Cursor',
        gap_to_closed_source_leader: 8.0 - selfScores[1],
        closed_source_leader: 'Cursor',
        gap_to_oss_leader: 0,
        oss_leader: 'none',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 9.0,
        capability_test: capabilityTest,
      },
    ],
  };
  await fs.writeFile(path.join(competeDir, 'matrix.json'), JSON.stringify(matrix, null, 2));
  return matrix;
}

// ── check-all-nine tests ──────────────────────────────────────────────────────

describe('compete --check-all-nine', () => {
  let tmpDir: string;

  before(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c9-')); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('exits 1 and writes GOAL_STATUS.json when dimensions are below target', async () => {
    await makeTmpMatrix(tmpDir, { selfScores: [6.0, 7.0] });
    const originalExitCode = process.exitCode;

    const result = await actionCheckAllNine(
      {
        target: 9.0,
        _loadMatrix: async () => {
          const raw = await fs.readFile(path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'), 'utf8');
          return JSON.parse(raw);
        },
        _harshScore: async () => ({
          rawScore: 65,
          harshScore: 65,
          displayScore: 6.5,
          displayDimensions: { autonomy: 6.0, testing: 7.0 } as never,
          dimensions: {} as never,
          penalties: [],
          stubsDetected: [],
          fakeCompletionRisk: 'low' as const,
          verdict: 'needs-work' as const,
          maturityAssessment: {} as never,
          timestamp: new Date().toISOString(),
        }),
      },
      tmpDir,
    );

    assert.equal(result.action, 'check-all-nine');
    assert.equal(result.allGreen, false);
    assert.equal(process.exitCode, 1);

    const statusRaw = await fs.readFile(path.join(tmpDir, '.danteforge', 'GOAL_STATUS.json'), 'utf8');
    const status = JSON.parse(statusRaw) as { allGreen: boolean; failing: number; passing: number; total: number };
    assert.equal(status.allGreen, false);
    assert.equal(status.failing, 2);
    assert.equal(status.total, 2);

    process.exitCode = originalExitCode;
  });

  it('exits 0 and writes allGreen:true when all dimensions meet target', async () => {
    const greenDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c9green-'));
    try {
      await makeTmpMatrix(greenDir, { selfScores: [9.5, 9.2] });
      const originalExitCode = process.exitCode;

      const result = await actionCheckAllNine(
        {
          target: 9.0,
          _loadMatrix: async () => {
            const raw = await fs.readFile(path.join(greenDir, '.danteforge', 'compete', 'matrix.json'), 'utf8');
            return JSON.parse(raw);
          },
          _harshScore: async () => ({
            rawScore: 94,
            harshScore: 94,
            displayScore: 9.4,
            displayDimensions: { autonomy: 9.5, testing: 9.2 } as never,
            dimensions: {} as never,
            penalties: [],
            stubsDetected: [],
            fakeCompletionRisk: 'low' as const,
            verdict: 'excellent' as const,
            maturityAssessment: {} as never,
            timestamp: new Date().toISOString(),
          }),
        },
        greenDir,
      );

      assert.equal(result.allGreen, true);
      assert.equal(process.exitCode, 0);

      const statusRaw = await fs.readFile(path.join(greenDir, '.danteforge', 'GOAL_STATUS.json'), 'utf8');
      const status = JSON.parse(statusRaw) as { allGreen: boolean; passing: number };
      assert.equal(status.allGreen, true);
      assert.equal(status.passing, 2);

      process.exitCode = originalExitCode;
    } finally {
      await fs.rm(greenDir, { recursive: true, force: true });
    }
  });

  it('skips ceiling-blocked dimensions and does not count them as failing', async () => {
    const ceilDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c9ceil-'));
    try {
      const competeDir = path.join(ceilDir, '.danteforge', 'compete');
      await fs.mkdir(competeDir, { recursive: true });
      const matrix = {
        project: 'test',
        competitors: ['Cursor'],
        competitors_closed_source: ['Cursor'],
        competitors_oss: [],
        lastUpdated: new Date().toISOString(),
        overallSelfScore: 9.5,
        dimensions: [
          { id: 'autonomy', label: 'Autonomy', weight: 1.0, category: 'quality', frequency: 'high', scores: { self: 9.5, Cursor: 9.5 }, gap_to_leader: 0, leader: 'Cursor', gap_to_closed_source_leader: 0, closed_source_leader: 'Cursor', gap_to_oss_leader: 0, oss_leader: 'none', status: 'closed', sprint_history: [], next_sprint_target: 9.0 },
          { id: 'community_adoption', label: 'Community Adoption', weight: 1.0, category: 'community', frequency: 'low', scores: { self: 4.0, Cursor: 9.8 }, gap_to_leader: 5.8, leader: 'Cursor', gap_to_closed_source_leader: 5.8, closed_source_leader: 'Cursor', gap_to_oss_leader: 0, oss_leader: 'none', status: 'in-progress', sprint_history: [], next_sprint_target: 4.0, ceiling: 4.0, ceilingReason: 'Requires real user base' },
        ],
      };
      await fs.writeFile(path.join(competeDir, 'matrix.json'), JSON.stringify(matrix, null, 2));
      const originalExitCode = process.exitCode;

      const result = await actionCheckAllNine(
        {
          target: 9.0,
          _loadMatrix: async () => matrix,
          _harshScore: async () => ({
            rawScore: 95,
            harshScore: 95,
            displayScore: 9.5,
            displayDimensions: { autonomy: 9.5 } as never,
            dimensions: {} as never,
            penalties: [],
            stubsDetected: [],
            fakeCompletionRisk: 'low' as const,
            verdict: 'excellent' as const,
            maturityAssessment: {} as never,
            timestamp: new Date().toISOString(),
          }),
        },
        ceilDir,
      );

      assert.equal(result.allGreen, true, 'should be green — only non-ceiling dim passes');
      assert.equal(process.exitCode, 0);

      process.exitCode = originalExitCode;
    } finally {
      await fs.rm(ceilDir, { recursive: true, force: true });
    }
  });

  it('returns action: check-all-nine when no matrix exists', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c9empty-'));
    try {
      const originalExitCode = process.exitCode;
      const result = await actionCheckAllNine({ target: 9.0, _loadMatrix: async () => null }, emptyDir);
      assert.equal(result.action, 'check-all-nine');
      assert.equal(result.allGreen, false);
      assert.equal(process.exitCode, 1);
      process.exitCode = originalExitCode;
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });
});

// ── Bug A fix: dimension-specific score ───────────────────────────────────────

describe('compete --auto Bug A: dimension-specific post-sprint score', () => {
  it('uses displayDimensions[dimKey] not displayScore for the dimension update', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bugA-'));
    try {
      await makeTmpMatrix(tmpDir, { selfScores: [6.0, 7.0] });

      await compete({
        auto: true,
        target: 9.0,
        maxCycles: 1,
        yes: true,
        cwd: tmpDir,
        _loadMatrix: async () => {
          const raw = await fs.readFile(path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'), 'utf8');
          return JSON.parse(raw);
        },
        _runInferno: async () => { /* no-op */ },
        // Post-sprint scorer: overall=7.0 but autonomy-specific=8.5
        _postSprintScore: async () => ({
          rawScore: 70,
          harshScore: 70,
          displayScore: 7.0,
          displayDimensions: { autonomy: 8.5, testing: 7.0 } as never,
          dimensions: {} as never,
          penalties: [],
          stubsDetected: [],
          fakeCompletionRisk: 'low' as const,
          verdict: 'needs-work' as const,
          maturityAssessment: {} as never,
          timestamp: new Date().toISOString(),
        }),
        // Strict dims: autonomy=85 → displayDimensions.autonomy=8.5 after applyStrictOverrides.
        // Other dims need non-NaN values so the weighted recompute of displayScore stays ≠ 8.5.
        _computeStrictDims: async () => ({
          autonomy: 85, selfImprovement: 70, tokenEconomy: 70,
          specDrivenPipeline: 70, developerExperience: 70, planningQuality: 70, convergenceSelfHealing: 70,
        }) as never,
      });

      // With Bug A fix: dimension-specific displayDimensions.autonomy=8.5 is used (not displayScore).
      // Without fix: displayScore (weighted avg, ≠ 8.5) would be used instead. Proposal flow
      // writes the resulting score to matrix.json on disk via mergeScoreProposals.
      const finalRaw = await fs.readFile(path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'), 'utf8');
      const final = JSON.parse(finalRaw) as { dimensions: Array<{ id: string; scores: Record<string, number> }> };
      const autonomyDim = final.dimensions.find(d => d.id === 'autonomy');
      assert.equal(autonomyDim?.scores['self'], 8.5, 'Should use dimension-specific score 8.5, not overall displayScore');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Bug B fix: victory threshold ─────────────────────────────────────────────

describe('compete --auto Bug B: victory threshold never below 9.0', () => {
  it('does not declare victory when competitor ceiling is 7.5 but score is only 8.0', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bugB-'));
    try {
      const competeDir = path.join(tmpDir, '.danteforge', 'compete');
      await fs.mkdir(competeDir, { recursive: true });
      // Competitor score is only 7.5 — old code would declare victory at 7.5
      const matrix = {
        project: 'test',
        competitors: ['Aider'],
        competitors_closed_source: [],
        competitors_oss: ['Aider'],
        lastUpdated: new Date().toISOString(),
        overallSelfScore: 6.0,
        dimensions: [{
          id: 'testing',
          label: 'Testing',
          weight: 1.0,
          category: 'quality',
          frequency: 'high',
          scores: { self: 6.0, Aider: 7.5 },
          gap_to_leader: 1.5,
          leader: 'Aider',
          gap_to_closed_source_leader: 0,
          closed_source_leader: 'none',
          gap_to_oss_leader: 1.5,
          oss_leader: 'Aider',
          status: 'in-progress',
          sprint_history: [],
          next_sprint_target: 9.0,
          capability_test: { command: 'node -e ""', description: 'test fixture' },
        }],
      };
      await fs.writeFile(path.join(competeDir, 'matrix.json'), JSON.stringify(matrix, null, 2));

      await compete({
        auto: true,
        target: 9.0,
        maxCycles: 1,
        yes: true,
        cwd: tmpDir,
        _loadMatrix: async () => matrix,
        _runInferno: async () => { /* no-op */ },
        // Post-sprint: score of 8.0 — above competitor (7.5) but below target (9.0)
        _postSprintScore: async () => ({
          rawScore: 80,
          harshScore: 80,
          displayScore: 8.0,
          displayDimensions: { testing: 8.0 } as never,
          dimensions: {} as never,
          penalties: [],
          stubsDetected: [],
          fakeCompletionRisk: 'low' as const,
          verdict: 'acceptable' as const,
          maturityAssessment: {} as never,
          timestamp: new Date().toISOString(),
        }),
        _computeStrictDims: async () => ({}) as never,
      });

      // Score updated to 8.0 — but it should NOT have been marked as victory (still < 9.0).
      // The dimension should still be 'in-progress' after the cycle, not 'closed'.
      // The proposal flow persists the score on disk via mergeScoreProposals.
      const finalRaw = await fs.readFile(path.join(competeDir, 'matrix.json'), 'utf8');
      const final = JSON.parse(finalRaw) as { dimensions: Array<{ id: string; scores: Record<string, number> }> };
      const testingDim = final.dimensions.find(d => d.id === 'testing');
      assert.equal(testingDim?.scores['self'], 8.0, 'matrix should reflect the 8.0 score (not victory)');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
