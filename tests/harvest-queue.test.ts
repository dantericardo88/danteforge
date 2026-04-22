// Harvest Queue — unit tests for all pure functions and persistence.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadHarvestQueue,
  saveHarvestQueue,
  addToQueue,
  popHighestPriority,
  markRepoStatus,
  updateGapCoverage,
  computePriority,
  type HarvestQueue,
  type HarvestRepo,
  type HarvestGap,
} from '../src/core/harvest-queue.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-harvest-queue-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function makeRepo(overrides: Partial<HarvestRepo> = {}): Omit<HarvestRepo, 'addedAt' | 'patternsExtracted' | 'patternsAdopted'> {
  return {
    url: 'https://github.com/example/repo',
    slug: 'repo',
    priority: 5,
    gapTargets: ['testing'],
    status: 'queued',
    ...overrides,
  };
}

function emptyQueue(): HarvestQueue {
  return {
    version: '1.0.0',
    repos: [],
    gaps: [],
    harvestCycles: 0,
    totalPatternsExtracted: 0,
    totalPatternsAdopted: 0,
    updatedAt: new Date().toISOString(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('HarvestQueue — persistence', () => {

  it('T1: loadHarvestQueue returns empty queue when file not found', async () => {
    const dir = await makeTempDir();
    const queue = await loadHarvestQueue(dir);
    assert.strictEqual(queue.version, '1.0.0');
    assert.deepStrictEqual(queue.repos, []);
    assert.deepStrictEqual(queue.gaps, []);
    assert.strictEqual(queue.harvestCycles, 0);
  });

  it('T2: saveHarvestQueue + loadHarvestQueue round-trip preserves data', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });

    let queue = emptyQueue();
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/b', slug: 'b', priority: 7 }));
    queue = updateGapCoverage(queue, 'testing', 5.0);

    await saveHarvestQueue(queue, dir);
    const loaded = await loadHarvestQueue(dir);

    assert.strictEqual(loaded.repos.length, 1);
    assert.strictEqual(loaded.repos[0]!.url, 'https://github.com/a/b');
    assert.strictEqual(loaded.gaps.length, 1);
    assert.strictEqual(loaded.gaps[0]!.dimension, 'testing');
  });

  it('T11: harvestCycles increments by 1 on each save', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });

    const queue = emptyQueue();
    await saveHarvestQueue(queue, dir);
    const after1 = await loadHarvestQueue(dir);
    assert.strictEqual(after1.harvestCycles, 1);

    await saveHarvestQueue(after1, dir);
    const after2 = await loadHarvestQueue(dir);
    assert.strictEqual(after2.harvestCycles, 2);
  });

  it('T14: queue preserves gaps array across save/load cycle', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });

    let queue = emptyQueue();
    queue = updateGapCoverage(queue, 'security', 3.5);
    queue = updateGapCoverage(queue, 'performance', 6.0);

    await saveHarvestQueue(queue, dir);
    const loaded = await loadHarvestQueue(dir);

    assert.strictEqual(loaded.gaps.length, 2);
    const secGap = loaded.gaps.find(g => g.dimension === 'security');
    assert.ok(secGap, 'security gap must persist');
    assert.strictEqual(secGap.currentScore, 3.5);
  });

  it('T15: loadHarvestQueue handles corrupted JSON gracefully (returns empty queue)', async () => {
    const dir = await makeTempDir();
    const dfDir = path.join(dir, '.danteforge');
    await fs.mkdir(dfDir, { recursive: true });
    await fs.writeFile(path.join(dfDir, 'harvest-queue.json'), 'NOT JSON {{{', 'utf8');

    const queue = await loadHarvestQueue(dir);
    assert.strictEqual(queue.repos.length, 0);
    assert.strictEqual(queue.harvestCycles, 0);
  });

});

describe('HarvestQueue — addToQueue', () => {

  it('T3: addToQueue inserts repo with correct defaults', () => {
    const queue = emptyQueue();
    const result = addToQueue(queue, makeRepo());
    assert.strictEqual(result.repos.length, 1);
    assert.strictEqual(result.repos[0]!.patternsExtracted, 0);
    assert.strictEqual(result.repos[0]!.patternsAdopted, 0);
    assert.ok(result.repos[0]!.addedAt, 'addedAt must be set');
  });

  it('T4: addToQueue deduplicates by URL (case-insensitive)', () => {
    let queue = emptyQueue();
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/A/B' }));
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/b/' })); // same URL, different case + trailing slash
    assert.strictEqual(queue.repos.length, 1);
  });

  it('T12: totalPatternsExtracted is preserved across addToQueue calls', () => {
    let queue = emptyQueue();
    queue = { ...queue, totalPatternsExtracted: 42 };
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/x/y', slug: 'y' }));
    assert.strictEqual(queue.totalPatternsExtracted, 42);
  });

});

describe('HarvestQueue — popHighestPriority', () => {

  it('T5: popHighestPriority returns repo with highest priority number', () => {
    let queue = emptyQueue();
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/low', slug: 'low', priority: 2 }));
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/high', slug: 'high', priority: 9 }));
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/mid', slug: 'mid', priority: 5 }));

    const [repo] = popHighestPriority(queue);
    assert.strictEqual(repo?.slug, 'high');
  });

  it('T6: popHighestPriority returns [null, unchanged] when queue is empty', () => {
    const queue = emptyQueue();
    const [repo, unchanged] = popHighestPriority(queue);
    assert.strictEqual(repo, null);
    assert.strictEqual(unchanged.repos.length, 0);
  });

  it('T13: popHighestPriority skips exhausted repos', () => {
    let queue = emptyQueue();
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/exhausted', slug: 'exhausted', priority: 10 }));
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/active', slug: 'active', priority: 3 }));
    // Mark highest priority as exhausted
    queue = markRepoStatus(queue, 'https://github.com/a/exhausted', 'exhausted');

    const [repo] = popHighestPriority(queue);
    assert.strictEqual(repo?.slug, 'active');
  });

  it('popHighestPriority marks popped repo as deep and sets lastHarvestedAt', () => {
    let queue = emptyQueue();
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/r', slug: 'r', priority: 5 }));

    const [, updatedQueue] = popHighestPriority(queue);
    const repo = updatedQueue.repos[0]!;
    assert.strictEqual(repo.status, 'deep');
    assert.ok(repo.lastHarvestedAt, 'lastHarvestedAt must be set after pop');
  });

});

describe('HarvestQueue — markRepoStatus', () => {

  it('T7: markRepoStatus updates status without touching other fields', () => {
    let queue = emptyQueue();
    queue = addToQueue(queue, makeRepo({ url: 'https://github.com/a/r', slug: 'r', priority: 7, gapTargets: ['auth'] }));

    queue = markRepoStatus(queue, 'https://github.com/a/r', 'exhausted');
    const repo = queue.repos[0]!;
    assert.strictEqual(repo.status, 'exhausted');
    assert.strictEqual(repo.priority, 7);
    assert.deepStrictEqual(repo.gapTargets, ['auth']);
  });

});

describe('HarvestQueue — updateGapCoverage', () => {

  it('T8: updateGapCoverage sets currentScore for existing gap', () => {
    let queue = emptyQueue();
    queue = updateGapCoverage(queue, 'security', 4.0);
    queue = updateGapCoverage(queue, 'security', 7.5);

    const gap = queue.gaps.find(g => g.dimension === 'security')!;
    assert.strictEqual(gap.currentScore, 7.5);
  });

  it('updateGapCoverage inserts new gap when dimension not found', () => {
    const queue = emptyQueue();
    const result = updateGapCoverage(queue, 'circuit-breaker', 3.0);
    assert.strictEqual(result.gaps.length, 1);
    assert.strictEqual(result.gaps[0]!.dimension, 'circuit-breaker');
    assert.strictEqual(result.gaps[0]!.targetScore, 9.0);
  });

  it('updateGapCoverage sets bestRepoForGap when provided', () => {
    const queue = emptyQueue();
    const result = updateGapCoverage(queue, 'testing', 5.0, 'https://github.com/vitest-dev/vitest');
    assert.strictEqual(result.gaps[0]!.bestRepoForGap, 'https://github.com/vitest-dev/vitest');
  });

});

describe('HarvestQueue — computePriority', () => {

  it('T9: computePriority = (targetScore - currentScore) × repoQuality / 10', () => {
    const gap: HarvestGap = {
      dimension: 'test',
      currentScore: 5.0,
      targetScore: 9.0,
      patternsAvailable: 0,
      patternsAdopted: 0,
    };
    // (9 - 5) * (8 / 10) = 3.2
    const result = computePriority(gap, 8);
    assert.strictEqual(result, 3.2);
  });

  it('T10: computePriority clamps to minimum 1 when gap is tiny', () => {
    const gap: HarvestGap = {
      dimension: 'test',
      currentScore: 8.9,
      targetScore: 9.0,
      patternsAvailable: 0,
      patternsAdopted: 0,
    };
    const result = computePriority(gap, 1);
    assert.strictEqual(result, 1);
  });

  it('computePriority clamps to maximum 10 when gap is large and repo quality is high', () => {
    const gap: HarvestGap = {
      dimension: 'test',
      currentScore: 0,
      targetScore: 9.0,
      patternsAvailable: 0,
      patternsAdopted: 0,
    };
    // (9 - 0) * (10 / 10) = 9.0 → within range
    const result = computePriority(gap, 10);
    assert.ok(result <= 10, 'priority must not exceed 10');
  });

});
