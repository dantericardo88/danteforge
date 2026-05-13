// Tests for src/matrix-orchestration/analysis/current-state-scorer.ts
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { scoreCurrentState } from '../../src/matrix-orchestration/analysis/current-state-scorer.js';
import type {
  OrchestrationDimension,
  OrchestrationDimensionMatrix,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function makeCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'css-'));
  tmpDirs.push(d);
  return d;
}

function makeDim(id: string, weight = 1.0): OrchestrationDimension {
  return {
    dimensionId: id,
    name: id,
    category: 'core',
    weight,
    rubric: { score5: '5', score7: '7', score9: '9' },
    evidenceRequired: ['e'],
    currentScore: 0,
    ossFrontierScore: 7.0,
    closedFrontierScore: 9.0,
    gapToOssFrontier: 7.0,
    gapToClosedFrontier: 9.0,
  };
}

function makeMatrix(dims: OrchestrationDimension[]): OrchestrationDimensionMatrix {
  return {
    generatedAt: '2026-05-12T00:00:00.000Z',
    projectName: 'fixture',
    dimensions: dims,
    overallCurrentScore: 0,
    overallOssFrontierScore: 0,
    overallClosedFrontierScore: 0,
    approvedByUser: false,
  };
}

describe('scoreCurrentState', () => {
  it('applies a score to every dimension via the LLM caller', async () => {
    const cwd = await makeCwd();
    const calls: string[] = [];
    const llmCaller = async (prompt: string) => {
      calls.push(prompt);
      return JSON.stringify({ score: 5.5, rationale: 'mid-level' });
    };
    const matrix = makeMatrix([makeDim('a'), makeDim('b'), makeDim('c')]);
    const out = await scoreCurrentState(matrix, {
      cwd,
      _isLLMAvailable: async () => true,
      _llmCaller: llmCaller,
      _now: () => '2026-05-12T00:00:00.000Z',
    });
    assert.equal(calls.length, 3);
    for (const d of out.dimensions) {
      assert.equal(d.currentScore, 5.5);
    }
  });

  it('recomputes gapToOssFrontier and gapToClosedFrontier', async () => {
    const cwd = await makeCwd();
    const llmCaller = async () => JSON.stringify({ score: 4.0 });
    const matrix = makeMatrix([makeDim('a')]);
    const out = await scoreCurrentState(matrix, {
      cwd,
      _isLLMAvailable: async () => true,
      _llmCaller: llmCaller,
      _now: () => 'now',
    });
    const dim = out.dimensions[0]!;
    assert.equal(dim.gapToOssFrontier, 3.0);   // 7 - 4
    assert.equal(dim.gapToClosedFrontier, 5.0); // 9 - 4
  });

  it('computes overall weighted score correctly', async () => {
    const cwd = await makeCwd();
    let i = 0;
    const responses = [6.0, 8.0];
    const llmCaller = async () => JSON.stringify({ score: responses[i++]! });
    const matrix = makeMatrix([makeDim('a', 1.0), makeDim('b', 3.0)]);
    const out = await scoreCurrentState(matrix, {
      cwd,
      _isLLMAvailable: async () => true,
      _llmCaller: llmCaller,
      _now: () => 'now',
    });
    // Weighted avg = (1*6 + 3*8) / 4 = 30/4 = 7.5
    assert.equal(out.overallCurrentScore, 7.5);
  });

  it('invokes adversarial seam in strict mode and downgrades inflated scores', async () => {
    const cwd = await makeCwd();
    const llmCaller = async () => JSON.stringify({ score: 9.0 });
    const calls: number[] = [];
    const advScore = async (input: { dimension: OrchestrationDimension; currentScore: number }) => {
      calls.push(input.currentScore);
      return { adversarialScore: 4.0, verdict: 'inflated' as const };
    };
    const matrix = makeMatrix([makeDim('a')]);
    const out = await scoreCurrentState(matrix, {
      cwd,
      strict: true,
      _isLLMAvailable: async () => true,
      _llmCaller: llmCaller,
      _adversarialScore: advScore,
      _now: () => 'now',
    });
    assert.equal(calls.length, 1);
    assert.equal(out.dimensions[0]!.currentScore, 4.0);
  });

  it('strict mode leaves trusted scores intact', async () => {
    const cwd = await makeCwd();
    const llmCaller = async () => JSON.stringify({ score: 6.0 });
    const advScore = async () => ({ adversarialScore: 5.8, verdict: 'trusted' as const });
    const matrix = makeMatrix([makeDim('a')]);
    const out = await scoreCurrentState(matrix, {
      cwd,
      strict: true,
      _isLLMAvailable: async () => true,
      _llmCaller: llmCaller,
      _adversarialScore: advScore,
      _now: () => 'now',
    });
    assert.equal(out.dimensions[0]!.currentScore, 6.0);
  });

  it('persists both currentStateScore and the updated dimensionMatrix', async () => {
    const cwd = await makeCwd();
    const llmCaller = async () => JSON.stringify({ score: 5.0 });
    const matrix = makeMatrix([makeDim('a'), makeDim('b')]);
    await scoreCurrentState(matrix, {
      cwd,
      _isLLMAvailable: async () => true,
      _llmCaller: llmCaller,
      _now: () => '2026-05-12T00:00:00.000Z',
    });
    const scoreRaw = await fs.readFile(
      path.join(cwd, '.danteforge/matrix-orchestration/current-state-score.json'),
      'utf8',
    );
    const score = JSON.parse(scoreRaw) as { scores: Record<string, number>; overall: number };
    assert.equal(score.scores.a, 5.0);
    assert.equal(score.scores.b, 5.0);

    const matRaw = await fs.readFile(
      path.join(cwd, '.danteforge/matrix-orchestration/dimension-matrix.json'),
      'utf8',
    );
    const persisted = JSON.parse(matRaw) as OrchestrationDimensionMatrix;
    assert.equal(persisted.overallCurrentScore, 5.0);
  });
});
