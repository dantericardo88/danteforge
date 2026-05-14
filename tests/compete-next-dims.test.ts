// tests/compete-next-dims.test.ts
// Tests for actionNextDims — JSON of N weakest dimensions below target.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { actionNextDims } from '../src/cli/commands/compete.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHarshScoreFn(dims: { id: string; scores: { self: number } }[]) {
  const displayDimensions = Object.fromEntries(dims.map(d => [d.id, d.scores.self])) as Record<string, number>;
  return async () => ({
    rawScore: 70, harshScore: 70, displayScore: 7.0, verdict: 'needs-work' as const,
    dimensions: displayDimensions as never, displayDimensions: displayDimensions as never,
    penalties: [], stubsDetected: [], fakeCompletionRisk: 'low' as const,
    maturityAssessment: null as never, timestamp: new Date().toISOString(),
    unwiredModules: [], wiringResult: null as never,
  });
}

function makeDim(id: string, selfScore: number, ceiling?: number) {
  return {
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    weight: 1.0,
    category: 'quality',
    frequency: 'high',
    scores: { self: selfScore, Cursor: 9.5 },
    gap_to_leader: 9.5 - selfScore,
    leader: 'Cursor',
    gap_to_closed_source_leader: 9.5 - selfScore,
    closed_source_leader: 'Cursor',
    gap_to_oss_leader: 0,
    oss_leader: 'none',
    status: 'in-progress',
    sprint_history: [],
    next_sprint_target: 9.0,
    ...(ceiling !== undefined ? { ceiling, ceilingReason: 'test ceiling' } : {}),
  };
}

function makeMatrix(dims: ReturnType<typeof makeDim>[]) {
  return {
    project: 'test',
    competitors: ['Cursor'],
    competitors_closed_source: ['Cursor'],
    competitors_oss: [],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 7.0,
    dimensions: dims,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('compete --next-dims', () => {
  let tmpDir: string;

  before(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextdims-')); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('returns action: next-dims', async () => {
    const dims = [makeDim('autonomy', 6.0), makeDim('testing', 7.0)];
    const matrix = makeMatrix(dims);
    const result = await actionNextDims({ nextDims: 3, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn(dims) }, tmpDir);
    assert.equal(result.action, 'next-dims');
  });

  it('returns empty nextDims array when no matrix exists', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nd-empty-'));
    try {
      const originalExitCode = process.exitCode;
      const result = await actionNextDims({ nextDims: 3, _loadMatrix: async () => null }, emptyDir);
      assert.deepEqual(result.nextDims, []);
      assert.equal(process.exitCode, 1);
      process.exitCode = originalExitCode;
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns dims sorted by gap descending', async () => {
    const dims = [
      makeDim('autonomy', 7.0),  // gap 2.0
      makeDim('testing', 5.0),   // gap 4.0 — largest
      makeDim('security', 6.0),  // gap 3.0
    ];
    const matrix = makeMatrix(dims);
    const result = await actionNextDims({ nextDims: 3, target: 9.0, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn(dims) }, tmpDir);
    const ids = result.nextDims?.map(d => d.id) ?? [];
    assert.deepEqual(ids, ['testing', 'security', 'autonomy'], 'Should sort largest gap first');
  });

  it('respects the N limit (nextDims count)', async () => {
    const dims = [makeDim('a', 5.0), makeDim('b', 6.0), makeDim('c', 7.0), makeDim('d', 8.0)];
    const matrix = makeMatrix(dims);
    const result = await actionNextDims({ nextDims: 2, target: 9.0, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn(dims) }, tmpDir);
    assert.equal(result.nextDims?.length, 2, 'Should return exactly 2 entries');
  });

  it('excludes dims that are at or above the target', async () => {
    const dims = [
      makeDim('autonomy', 9.5),   // above target — excluded
      makeDim('testing', 9.0),    // at target — excluded
      makeDim('security', 8.5),   // below — included
    ];
    const matrix = makeMatrix(dims);
    const result = await actionNextDims({ nextDims: 3, target: 9.0, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn(dims) }, tmpDir);
    const ids = result.nextDims?.map(d => d.id) ?? [];
    assert.deepEqual(ids, ['security']);
  });

  it('excludes ceiling-blocked dims', async () => {
    const dims = [
      makeDim('autonomy', 5.0, 4.0),  // ceiling 4.0 < target 9.0 — excluded
      makeDim('testing', 7.0),
    ];
    const matrix = makeMatrix(dims);
    const result = await actionNextDims({ nextDims: 3, target: 9.0, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn(dims) }, tmpDir);
    const ids = result.nextDims?.map(d => d.id) ?? [];
    assert.deepEqual(ids, ['testing']);
  });

  it('respects a custom target override', async () => {
    const dims = [makeDim('autonomy', 8.0), makeDim('testing', 7.5)];
    const matrix = makeMatrix(dims);
    const result = await actionNextDims({ nextDims: 3, target: 8.5, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn(dims) }, tmpDir);
    assert.equal(result.nextDims?.length, 2);
    assert.equal(result.nextDims?.[0].id, 'testing', 'testing has larger gap at target=8.5');
    assert.ok(Math.abs((result.nextDims?.[0].gap ?? 0) - 1.0) < 0.001);
  });

  it('returns empty array when all dims meet the target', async () => {
    const dims = [makeDim('autonomy', 9.5), makeDim('testing', 9.2)];
    const matrix = makeMatrix(dims);
    const result = await actionNextDims({ nextDims: 3, target: 9.0, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn(dims) }, tmpDir);
    assert.deepEqual(result.nextDims, []);
  });

  it('includes touches field when present on dim', async () => {
    const dim = { ...makeDim('autonomy', 7.0), touches: ['src/core/autoforge.ts'] };
    const matrix = makeMatrix([dim]);
    const result = await actionNextDims({ nextDims: 3, target: 9.0, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn([dim]) }, tmpDir);
    assert.deepEqual(result.nextDims?.[0].touches, ['src/core/autoforge.ts']);
  });

  it('correctly computes gap = target - selfScore', async () => {
    const dims = [makeDim('autonomy', 6.5)];
    const matrix = makeMatrix(dims);
    const result = await actionNextDims({ nextDims: 3, target: 9.0, _loadMatrix: async () => matrix, _harshScore: makeHarshScoreFn(dims) }, tmpDir);
    const entry = result.nextDims?.[0];
    assert.ok(entry, 'entry should exist');
    assert.ok(Math.abs(entry.gap - 2.5) < 0.001, `Expected gap 2.5, got ${entry.gap}`);
    assert.equal(entry.selfScore, 6.5);
    assert.equal(entry.target, 9.0);
  });
});
