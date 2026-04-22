// Universe Scan — unit and integration tests using injection seams.
// No real LLM, no real grep — all injected. Real temp directory filesystem.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  universeScan,
  computeEvidenceScore,
  type UniverseScanOptions,
  type UniverseScan,
} from '../src/cli/commands/universe-scan.js';
import { loadHarvestQueue } from '../src/core/harvest-queue.js';
import { type GoalConfig } from '../src/cli/commands/set-goal.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-universe-scan-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function mockLLMWithDimensions(): (prompt: string) => Promise<string> {
  return async () => JSON.stringify({
    dimensions: [
      { name: 'circuit-breaker', description: 'Fault isolation', userImpact: 9, differentiation: 8, emergenceScore: 7, competitors: ['repo/cb'] },
      { name: 'streaming', description: 'Token streaming', userImpact: 9, differentiation: 9, emergenceScore: 10, competitors: ['repo/stream'] },
    ],
  });
}

function mockGoalReader(goal: Partial<GoalConfig> | null): (cwd?: string) => Promise<GoalConfig | null> {
  if (goal === null) return async () => null;
  const full: GoalConfig = {
    version: '1.0.0',
    category: goal.category ?? 'agentic dev CLI',
    competitors: goal.competitors ?? ['Cursor'],
    definition9: goal.definition9 ?? 'Fully autonomous',
    exclusions: goal.exclusions ?? [],
    dailyBudgetUsd: goal.dailyBudgetUsd ?? 5,
    oversightLevel: goal.oversightLevel ?? 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return async () => full;
}

function mockGrepWithMatches(matchesPerPattern: number): (pattern: string, cwd: string) => Promise<string[]> {
  return async () => Array.from({ length: matchesPerPattern }, (_, i) => `src/file${i}.ts`);
}

const noGlob = async () => [];
const noGrep = async () => [];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Universe Scan — deterministic fallback', () => {

  it('T1: universeScan with _isLLMAvailable=false produces 8 standard dimensions', async () => {
    const dir = await makeTempDir();

    const result = await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    assert.ok(result.dimensions.length >= 8, `Expected >= 8 standard dimensions, got ${result.dimensions.length}`);
    assert.strictEqual(result.version, '1.0.0');
    assert.ok(result.scannedAt, 'scannedAt must be set');
  });

  it('T2: universeScan writes UNIVERSE.json with dimensions[] and selfScores', async () => {
    const dir = await makeTempDir();

    await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    const universePath = path.join(dir, '.danteforge', 'UNIVERSE.json');
    await assert.doesNotReject(fs.access(universePath), 'UNIVERSE.json must exist');

    const raw = await fs.readFile(universePath, 'utf8');
    const parsed = JSON.parse(raw) as UniverseScan;
    assert.ok(Array.isArray(parsed.dimensions), 'dimensions must be an array');
    assert.ok(typeof parsed.selfScores === 'object', 'selfScores must be an object');
    assert.ok(Object.keys(parsed.selfScores).length > 0, 'selfScores must have entries');
  });

  it('T3: universeScan writes SCORES.json (flat dimension→score map)', async () => {
    const dir = await makeTempDir();

    await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    const scoresPath = path.join(dir, '.danteforge', 'SCORES.json');
    await assert.doesNotReject(fs.access(scoresPath), 'SCORES.json must exist');

    const raw = await fs.readFile(scoresPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, number>;
    assert.ok(typeof parsed === 'object' && !Array.isArray(parsed), 'SCORES.json must be a flat object');
    for (const [, score] of Object.entries(parsed)) {
      assert.ok(typeof score === 'number', 'each score must be a number');
    }
  });

  it('T4: universeScan writes universe-history/{timestamp}.json snapshot', async () => {
    const dir = await makeTempDir();

    await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    const historyDir = path.join(dir, '.danteforge', 'universe-history');
    const entries = await fs.readdir(historyDir);
    assert.ok(entries.length >= 1, 'At least one history snapshot must be written');
    assert.ok(entries[0]!.endsWith('.json'), 'snapshot must be a JSON file');
  });

});

describe('Universe Scan — LLM and goal integration', () => {

  it('T5: universeScan reads GOAL.json competitors via _readGoal injection', async () => {
    const dir = await makeTempDir();
    let capturedPrompt = '';

    await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => true,
      _readGoal: mockGoalReader({ category: 'test-cli', competitors: ['ToolA', 'ToolB'] }),
      _llmCaller: async (prompt) => {
        capturedPrompt = prompt;
        return mockLLMWithDimensions()(prompt);
      },
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    assert.ok(capturedPrompt.includes('ToolA'), 'LLM prompt must include competitor names');
    assert.ok(capturedPrompt.includes('test-cli'), 'LLM prompt must include category');
  });

  it('T6: dimension evolution — new[] contains dimensions not in previous UNIVERSE.json', async () => {
    const dir = await makeTempDir();
    const danteforgeDir = path.join(dir, '.danteforge');
    await fs.mkdir(danteforgeDir, { recursive: true });

    // Write a previous scan with only one dimension
    const previousScan: UniverseScan = {
      version: '1.0.0',
      scannedAt: new Date().toISOString(),
      category: 'agentic dev CLI',
      dimensions: [{ name: 'circuit-breaker', description: 'fault isolation', userImpact: 9, differentiation: 8, emergenceScore: 7, weight: 0.504, competitors: [] }],
      selfScores: { 'circuit-breaker': 5 },
      dimensionChanges: { new: [], dead: [], shifted: [] },
    };
    await fs.writeFile(
      path.join(danteforgeDir, 'UNIVERSE.json'),
      JSON.stringify(previousScan),
      'utf8',
    );

    // New scan has 8 dimensions (standard) — 7 are new
    const result = await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    assert.ok(result.dimensionChanges.new.length >= 1, 'new[] must contain dimensions not in previous scan');
    assert.ok(!result.dimensionChanges.new.includes('circuit-breaker'), 'circuit-breaker was in previous scan, must NOT appear in new[]');
  });

  it('T7: dimension evolution — dead[] contains dimensions removed from current scan', async () => {
    const dir = await makeTempDir();
    const danteforgeDir = path.join(dir, '.danteforge');
    await fs.mkdir(danteforgeDir, { recursive: true });

    // Write a previous scan with a dimension NOT in the 8 standard ones
    const oldDimension = { name: 'deprecated-feature', description: 'old', userImpact: 5, differentiation: 5, emergenceScore: 5, weight: 0.125, competitors: [] };
    const previousScan: UniverseScan = {
      version: '1.0.0',
      scannedAt: new Date().toISOString(),
      category: 'agentic dev CLI',
      dimensions: [oldDimension],
      selfScores: { 'deprecated-feature': 3 },
      dimensionChanges: { new: [], dead: [], shifted: [] },
    };
    await fs.writeFile(
      path.join(danteforgeDir, 'UNIVERSE.json'),
      JSON.stringify(previousScan),
      'utf8',
    );

    const result = await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    assert.ok(result.dimensionChanges.dead.includes('deprecated-feature'), 'deprecated-feature must appear in dead[]');
  });

});

describe('Universe Scan — evidence scoring', () => {

  it('T8: universeScan self-scoring uses _grepFn results to compute 0/3/5/7/9/10 score', async () => {
    const dir = await makeTempDir();

    // 7 matches per pattern → should produce score 9 (6-10 matches = 9)
    const result = await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: mockGrepWithMatches(7),
    });

    for (const [, score] of Object.entries(result.selfScores)) {
      assert.ok([0, 3, 5, 7, 9, 10].includes(score), `score ${score} must be one of 0,3,5,7,9,10`);
    }
  });

  it('T9: universeScan with promptMode=true returns plan without writing files', async () => {
    const dir = await makeTempDir();

    await universeScan({
      cwd: dir,
      promptMode: true,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    const universePath = path.join(dir, '.danteforge', 'UNIVERSE.json');
    const exists = await fs.access(universePath).then(() => true).catch(() => false);
    assert.strictEqual(exists, false, 'UNIVERSE.json must NOT be written in promptMode');
  });

  it('T10: universeScan updates harvest-queue gaps via updateGapCoverage', async () => {
    const dir = await makeTempDir();

    await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: noGrep,
    });

    const queue = await loadHarvestQueue(dir);
    assert.ok(queue.gaps.length >= 1, 'harvest-queue.json must have gaps from universe-scan');
    assert.ok(
      queue.gaps.every(g => g.currentScore >= 0 && g.currentScore <= 10),
      'all gap scores must be 0-10',
    );
  });

  it('T11: selfScores values are clamped to 0-10', async () => {
    const dir = await makeTempDir();

    const result = await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: async () => null,
      _globFn: noGlob,
      _grepFn: mockGrepWithMatches(999),  // extreme match count
    });

    for (const [, score] of Object.entries(result.selfScores)) {
      assert.ok(score >= 0 && score <= 10, `score ${score} must be clamped 0-10`);
    }
  });

  it('T12: computeEvidenceScore returns correct values for boundary inputs', () => {
    assert.strictEqual(computeEvidenceScore(0), 0, '0 matches → score 0');
    assert.strictEqual(computeEvidenceScore(1), 3, '1 match → score 3');
    assert.strictEqual(computeEvidenceScore(2), 5, '2 matches → score 5');
    assert.strictEqual(computeEvidenceScore(4), 7, '4 matches → score 7');
    assert.strictEqual(computeEvidenceScore(7), 9, '7 matches → score 9');
    assert.strictEqual(computeEvidenceScore(11), 10, '11 matches → score 10');
  });

});

describe('Universe Scan — web search competitor discovery', () => {

  it('T13: _searchWeb is called with category-based queries when provided', async () => {
    const dir = await makeTempDir();
    const capturedQueries: string[] = [];

    await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _readGoal: mockGoalReader({ category: 'agentic dev CLI', competitors: [] }),
      _globFn: noGlob,
      _grepFn: noGrep,
      _searchWeb: async (query) => {
        capturedQueries.push(query);
        return [];
      },
    });

    assert.ok(capturedQueries.length >= 2, '_searchWeb must be called at least twice (two queries)');
    assert.ok(
      capturedQueries.some(q => q.includes('agentic dev CLI')),
      'at least one query must include the category name',
    );
  });

  it('T14: competitors from _searchWeb are merged with GOAL.json competitors (deduplicated)', async () => {
    const dir = await makeTempDir();
    let capturedCompetitors: string[] = [];

    await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => true,
      _readGoal: mockGoalReader({ category: 'agentic dev CLI', competitors: ['Cursor'] }),
      _llmCaller: async (prompt) => {
        // Capture the competitor list that was fed into the LLM prompt
        capturedCompetitors = prompt
          .match(/Key competitors: (.+)/)?.[1]
          ?.split(', ')
          ?.map(s => s.trim()) ?? [];
        return mockLLMWithDimensions()(prompt);
      },
      _globFn: noGlob,
      _grepFn: noGrep,
      _searchWeb: async () => ['Aider', 'Cursor', 'cursor'],  // Cursor is a duplicate (case-insensitive)
    });

    assert.ok(capturedCompetitors.includes('Cursor'), 'Cursor from GOAL.json must be preserved');
    assert.ok(capturedCompetitors.includes('Aider'), 'Aider from web search must be included');
    // Dedup: 'Cursor' + 'cursor' → only one Cursor entry
    const cursorCount = capturedCompetitors.filter(c => c.toLowerCase() === 'cursor').length;
    assert.strictEqual(cursorCount, 1, 'Cursor must appear exactly once (case-insensitive dedup)');
  });

  it('T15: high-emergence dimensions (emergenceScore >= 8) get 1.5x effective weight and are sorted first', async () => {
    const dir = await makeTempDir();

    // Two dimensions with identical userImpact + differentiation but different emergenceScore.
    // high-emergence (emergenceScore=9) should appear before low-emergence (emergenceScore=3)
    // because effectiveWeight = userImpact * diff * emergence / 1000 * 1.5 (if emergence >= 8)
    await universeScan({
      cwd: dir,
      _isLLMAvailable: async () => true,
      _readGoal: mockGoalReader({ category: 'test-category', competitors: [] }),
      _globFn: noGlob,
      _grepFn: noGrep,
      _llmCaller: async () => JSON.stringify({
        dimensions: [
          // low-emergence listed first in LLM response to prove sorting works
          { name: 'low-emergence-dim', description: 'Low trending', userImpact: 5, differentiation: 5, emergenceScore: 3, competitors: [] },
          { name: 'high-emergence-dim', description: 'Hot new trend', userImpact: 5, differentiation: 5, emergenceScore: 9, competitors: [] },
        ],
      }),
    });

    const universePath = path.join(dir, '.danteforge', 'UNIVERSE.json');
    const raw = await fs.readFile(universePath, 'utf8');
    const scan = JSON.parse(raw) as { dimensions: Array<{ name: string; weight: number }> };

    const highIdx = scan.dimensions.findIndex(d => d.name === 'high-emergence-dim');
    const lowIdx = scan.dimensions.findIndex(d => d.name === 'low-emergence-dim');

    assert.ok(highIdx !== -1, 'high-emergence-dim must appear in UNIVERSE.json');
    assert.ok(lowIdx !== -1, 'low-emergence-dim must appear in UNIVERSE.json');
    assert.ok(highIdx < lowIdx, `high-emergence-dim (idx ${highIdx}) must sort before low-emergence-dim (idx ${lowIdx})`);

    // Verify the weight includes the 1.5x multiplier for emergenceScore >= 8
    const highDim = scan.dimensions[highIdx]!;
    const expectedWeight = (5 * 5 * 9) / 1000 * 1.5;  // = 0.3375
    assert.ok(
      Math.abs(highDim.weight - expectedWeight) < 0.001,
      `high-emergence weight must be ${expectedWeight} (with 1.5x), got ${highDim.weight}`,
    );
  });

});
