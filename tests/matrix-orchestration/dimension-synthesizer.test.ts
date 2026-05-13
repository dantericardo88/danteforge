// Tests for src/matrix-orchestration/analysis/dimension-synthesizer.ts
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  synthesizeOrchestrationDimensions,
  validateDimensionMatrix,
} from '../../src/matrix-orchestration/analysis/dimension-synthesizer.js';
import type {
  CompetitiveUniverse,
  ProjectIntent,
  OrchestrationDimensionMatrix,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function makeCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dsy-'));
  tmpDirs.push(d);
  return d;
}

function makeIntent(): ProjectIntent {
  return {
    sourcePath: 'PRD.md',
    projectName: 'fixture',
    goal: 'orchestrate parallel agents',
    projectType: 'agent_runtime',
    targetUser: 'developer',
    keyFeatures: ['parallelism', 'budget control'],
    constraintEmphasis: ['cost_critical'],
    nonGoals: [],
    competitiveCategoryBoundary: { direct: ['orchestrator'], adjacent: [], research: [] },
    frontierFraming: {
      target: 'closed_source_frontier',
      matchLeaderOn: [],
      exceedLeaderOn: [],
      defineNewCategoryOn: [],
    },
    confidence: 0.9,
    extractedAt: '2026-05-12T00:00:00.000Z',
  };
}

function makeUniverse(): CompetitiveUniverse {
  return {
    generatedAt: '2026-05-12T00:00:00.000Z',
    projectName: 'fixture',
    entries: [
      {
        id: 'oss.aider',
        name: 'Aider',
        category: 'oss',
        source: 'manual',
        confidence: 1,
        recommendedAction: 'harvest',
      },
      {
        id: 'cs.cursor',
        name: 'Cursor',
        category: 'closed_source',
        source: 'manual',
        confidence: 1,
        recommendedAction: 'profile',
      },
    ],
    approvedByUser: true,
  };
}

function makeLlmCaller(perCatCount: number) {
  // Returns proposals that look like valid JSON; LLM is called once per category
  // in stage 'per_category' (or once for consolidation when stage='consolidation').
  return async (prompt: string) => {
    if (prompt.includes('Consolidate orchestration dimensions')) {
      // Consolidation prompt — collapse to 5 final dims.
      return JSON.stringify({
        dimensions: Array.from({ length: 5 }, (_, i) => ({
          name: `consolidated_dim_${i}`,
          category: 'core_functionality',
          weight: 1.0,
          rubric: { score5: '5', score7: '7', score9: '9' },
          evidenceRequired: ['evidence'],
        })),
      });
    }
    // Per-category prompt.
    const catMatch = prompt.match(/Category under proposal: ([^\n]+)/);
    const cat = catMatch ? catMatch[1]!.trim() : 'general';
    return JSON.stringify({
      dimensions: Array.from({ length: perCatCount }, (_, i) => ({
        name: `${cat}_dim_${i}`,
        category: cat,
        weight: 1.0,
        rubric: { score5: '5', score7: '7', score9: '9' },
        evidenceRequired: ['evidence'],
      })),
    });
  };
}

describe('synthesizeOrchestrationDimensions', () => {
  it('per_category stage produces dims for each category', async () => {
    const cwd = await makeCwd();
    const matrix = await synthesizeOrchestrationDimensions(
      { intent: makeIntent(), universe: makeUniverse() },
      {
        cwd,
        stage: 'per_category',
        targetDimensionCount: 50,
        targetCategoryCount: 8,
        _isLLMAvailable: async () => true,
        _llmCaller: makeLlmCaller(6),
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    assert.equal(matrix.dimensions.length, 50);
    const cats = new Set(matrix.dimensions.map((d) => d.category));
    assert.ok(cats.size >= 5, `expected >=5 categories, got ${cats.size}`);
  });

  it('consolidation stage merges proposals to target count', async () => {
    const cwd = await makeCwd();
    const matrix = await synthesizeOrchestrationDimensions(
      { intent: makeIntent(), universe: makeUniverse() },
      {
        cwd,
        stage: 'both',
        targetDimensionCount: 10,
        targetCategoryCount: 4,
        _isLLMAvailable: async () => true,
        _llmCaller: makeLlmCaller(6),
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    // Consolidation returned 5; shaping must backfill to the target.
    assert.equal(matrix.dimensions.length, 10);
  });

  it('every dimension has a 5/7/9 rubric, even after placeholder backfill', async () => {
    const cwd = await makeCwd();
    const matrix = await synthesizeOrchestrationDimensions(
      { intent: makeIntent(), universe: makeUniverse() },
      {
        cwd,
        stage: 'per_category',
        targetDimensionCount: 30,
        targetCategoryCount: 6,
        _isLLMAvailable: async () => true,
        _llmCaller: makeLlmCaller(4),
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    for (const d of matrix.dimensions) {
      assert.ok(d.rubric.score5);
      assert.ok(d.rubric.score7);
      assert.ok(d.rubric.score9);
    }
  });

  it('weights stay within 0.5..1.5', async () => {
    const cwd = await makeCwd();
    const matrix = await synthesizeOrchestrationDimensions(
      { intent: makeIntent(), universe: makeUniverse() },
      {
        cwd,
        targetDimensionCount: 20,
        targetCategoryCount: 5,
        _isLLMAvailable: async () => true,
        _llmCaller: async (prompt) => {
          if (prompt.includes('Consolidate orchestration dimensions')) {
            return JSON.stringify({
              dimensions: [
                { name: 'a', category: 'x', weight: 5.0, rubric: { score5: '5', score7: '7', score9: '9' } },
                { name: 'b', category: 'y', weight: -1, rubric: { score5: '5', score7: '7', score9: '9' } },
              ],
            });
          }
          return JSON.stringify({ dimensions: [] });
        },
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    for (const d of matrix.dimensions) {
      assert.ok(d.weight >= 0.5 && d.weight <= 1.5, `weight ${d.weight} outside 0.5..1.5`);
    }
  });

  it('falls back to local mode when LLM is unavailable (uses placeholders)', async () => {
    const cwd = await makeCwd();
    const matrix = await synthesizeOrchestrationDimensions(
      { intent: makeIntent(), universe: makeUniverse() },
      {
        cwd,
        mode: 'local',
        targetDimensionCount: 8,
        targetCategoryCount: 4,
        _isLLMAvailable: async () => false,
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    assert.equal(matrix.dimensions.length, 8);
  });

  it('persists matrix to canonical path', async () => {
    const cwd = await makeCwd();
    await synthesizeOrchestrationDimensions(
      { intent: makeIntent(), universe: makeUniverse() },
      {
        cwd,
        mode: 'local',
        targetDimensionCount: 6,
        targetCategoryCount: 3,
        _isLLMAvailable: async () => false,
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    const raw = await fs.readFile(
      path.join(cwd, '.danteforge/matrix-orchestration/dimension-matrix.json'),
      'utf8',
    );
    const persisted = JSON.parse(raw) as OrchestrationDimensionMatrix;
    assert.equal(persisted.dimensions.length, 6);
    assert.equal(persisted.projectName, 'fixture');
  });

  it('attaches OSS + closed-source frontier leaders from the universe', async () => {
    const cwd = await makeCwd();
    const matrix = await synthesizeOrchestrationDimensions(
      { intent: makeIntent(), universe: makeUniverse() },
      {
        cwd,
        mode: 'local',
        targetDimensionCount: 4,
        targetCategoryCount: 2,
        _isLLMAvailable: async () => false,
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    const hasOssLeader = matrix.dimensions.some((d) => d.ossFrontierLeader === 'Aider');
    const hasClosedLeader = matrix.dimensions.some(
      (d) => d.closedFrontierLeader === 'Cursor',
    );
    assert.ok(hasOssLeader, 'expected at least one dim with Aider as ossFrontierLeader');
    assert.ok(hasClosedLeader, 'expected at least one dim with Cursor as closedFrontierLeader');
  });

  it('initial currentScore is 0; downstream scorer fills it', async () => {
    const cwd = await makeCwd();
    const matrix = await synthesizeOrchestrationDimensions(
      { intent: makeIntent(), universe: makeUniverse() },
      {
        cwd,
        mode: 'local',
        targetDimensionCount: 6,
        targetCategoryCount: 3,
        _isLLMAvailable: async () => false,
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    for (const d of matrix.dimensions) {
      assert.equal(d.currentScore, 0);
    }
  });
});

describe('validateDimensionMatrix', () => {
  it('rejects non-object input', () => {
    assert.equal(validateDimensionMatrix(null).ok, false);
    assert.equal(validateDimensionMatrix(42).ok, false);
  });

  it('rejects matrix with missing rubric on a dimension', () => {
    const matrix = {
      generatedAt: '',
      projectName: 'x',
      dimensions: [
        { name: 'a', category: 'c', weight: 1.0 }, // no rubric
      ],
      overallCurrentScore: 0,
      overallOssFrontierScore: 0,
      overallClosedFrontierScore: 0,
      approvedByUser: false,
    };
    const result = validateDimensionMatrix(matrix);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });

  it('accepts a well-formed matrix', () => {
    const dim = {
      dimensionId: 'a',
      name: 'a',
      category: 'c',
      weight: 1.0,
      rubric: { score5: '5', score7: '7', score9: '9' },
      evidenceRequired: ['e'],
      currentScore: 0,
      ossFrontierScore: 0,
      closedFrontierScore: 0,
      gapToOssFrontier: 0,
      gapToClosedFrontier: 0,
    };
    const matrix = {
      generatedAt: '',
      projectName: 'x',
      dimensions: Array.from({ length: 5 }, () => dim),
      overallCurrentScore: 0,
      overallOssFrontierScore: 0,
      overallClosedFrontierScore: 0,
      approvedByUser: false,
    };
    const result = validateDimensionMatrix(matrix);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });
});
