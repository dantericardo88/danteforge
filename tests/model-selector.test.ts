import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectBestModel,
  getModelRanking,
  recordModelRun,
  type ModelPerformanceIndex,
  type ModelPerformanceEntry,
  type TaskType,
} from '../src/core/model-selector.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEmptyIndex(): ModelPerformanceIndex {
  return {
    version: '1.0.0',
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}

function makeEntry(
  model: string,
  taskType: TaskType,
  avgQualityScore: number,
  avgLatencyMs = 500,
  totalRuns = 10,
): ModelPerformanceEntry {
  return {
    model,
    taskType,
    avgLatencyMs,
    avgQualityScore,
    totalRuns,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function makeIndex(...entries: ModelPerformanceEntry[]): ModelPerformanceIndex {
  return {
    version: '1.0.0',
    entries,
    updatedAt: new Date().toISOString(),
  };
}

// ── T1: selectBestModel — empty candidates → fallback ─────────────────────────

describe('selectBestModel', () => {
  it('T1: returns claude-sonnet-4-6 when candidates is empty', () => {
    const result = selectBestModel('extraction', [], makeEmptyIndex());
    assert.equal(result, 'claude-sonnet-4-6');
  });

  it('T2: returns highest-scoring candidate for taskType', () => {
    const index = makeIndex(
      makeEntry('model-a', 'extraction', 0.9),
      makeEntry('model-b', 'extraction', 0.7),
    );
    const result = selectBestModel('extraction', ['model-a', 'model-b'], index);
    assert.equal(result, 'model-a');
  });

  it('T2b: ignores entries for other taskTypes', () => {
    const index = makeIndex(
      makeEntry('model-a', 'synthesis', 0.95), // different task
      makeEntry('model-b', 'extraction', 0.7),
    );
    // model-a has no extraction entry (defaults to 0.5), model-b has 0.7 → model-b wins
    const result = selectBestModel('extraction', ['model-a', 'model-b'], index);
    assert.equal(result, 'model-b');
  });

  it('T3: breaks ties by lowest latency', () => {
    const index = makeIndex(
      makeEntry('slow-model', 'planning', 0.8, 2000),
      makeEntry('fast-model', 'planning', 0.8, 100),
    );
    const result = selectBestModel('planning', ['slow-model', 'fast-model'], index);
    assert.equal(result, 'fast-model');
  });

  it('T4: uncharted candidates get score 0.5 (still valid selection)', () => {
    const index = makeEmptyIndex(); // no entries at all
    const result = selectBestModel('scoring', ['gpt-4', 'mistral-7b'], index);
    // Both get 0.5; tie broken by latency (MAX_SAFE_INTEGER each) → first candidate wins
    assert.ok(
      result === 'gpt-4' || result === 'mistral-7b',
      `Expected one of the candidates, got: ${result}`,
    );
  });

  it('T4b: single candidate always wins even with no history', () => {
    const result = selectBestModel('generation', ['only-model'], makeEmptyIndex());
    assert.equal(result, 'only-model');
  });

  it('T4c: known model beats uncharted model even at equal default scores if latency wins', () => {
    // known model has 0.5 quality (same as default) but low latency
    const index = makeIndex(makeEntry('known', 'classification', 0.5, 50));
    const result = selectBestModel('classification', ['unknown', 'known'], index);
    // 'unknown' gets default latency=MAX_SAFE_INTEGER; 'known' gets 50 → known wins on tie-break
    assert.equal(result, 'known');
  });
});

// ── T5-T6: getModelRanking ────────────────────────────────────────────────────

describe('getModelRanking', () => {
  it('T5: returns entries sorted by avgQualityScore desc', () => {
    const index = makeIndex(
      makeEntry('model-c', 'synthesis', 0.6),
      makeEntry('model-a', 'synthesis', 0.95),
      makeEntry('model-b', 'synthesis', 0.8),
    );
    const ranking = getModelRanking('synthesis', index);
    assert.equal(ranking.length, 3);
    assert.equal(ranking[0]!.model, 'model-a');
    assert.equal(ranking[1]!.model, 'model-b');
    assert.equal(ranking[2]!.model, 'model-c');
  });

  it('T5b: tie-breaks by lowest avgLatencyMs', () => {
    const index = makeIndex(
      makeEntry('slow', 'synthesis', 0.8, 1000),
      makeEntry('fast', 'synthesis', 0.8, 200),
    );
    const ranking = getModelRanking('synthesis', index);
    assert.equal(ranking[0]!.model, 'fast');
    assert.equal(ranking[1]!.model, 'slow');
  });

  it('T6: returns [] when no entries for taskType', () => {
    const index = makeIndex(makeEntry('model-a', 'planning', 0.9));
    const ranking = getModelRanking('extraction', index);
    assert.deepEqual(ranking, []);
  });

  it('T6b: does not mutate the original index entries array', () => {
    const index = makeIndex(
      makeEntry('model-b', 'synthesis', 0.6),
      makeEntry('model-a', 'synthesis', 0.95),
    );
    const originalOrder = index.entries.map((e) => e.model);
    getModelRanking('synthesis', index);
    // Original array should be unchanged
    assert.deepEqual(
      index.entries.map((e) => e.model),
      originalOrder,
    );
  });
});

// ── T7-T8: recordModelRun (with injection) ─────────────────────────────────────

describe('recordModelRun', () => {
  it('T7: creates new entry when model+taskType not found', async () => {
    let storedData = '';
    const _fsRead = async (_p: string): Promise<string> => {
      throw new Error('no file');
    };
    const _fsWrite = async (_p: string, d: string): Promise<void> => {
      storedData = d;
    };

    await recordModelRun('new-model', 'extraction', 300, 0.85, undefined, {
      _fsRead,
      _fsWrite,
    });

    const saved = JSON.parse(storedData) as ModelPerformanceIndex;
    assert.equal(saved.entries.length, 1);
    const entry = saved.entries[0]!;
    assert.equal(entry.model, 'new-model');
    assert.equal(entry.taskType, 'extraction');
    assert.equal(entry.totalRuns, 1);
    assert.equal(entry.avgLatencyMs, 300);
    assert.equal(entry.avgQualityScore, 0.85);
  });

  it('T8: updates running average for existing entry', async () => {
    // Existing entry: 10 runs, avgQuality=0.8, avgLatency=400
    const existingIndex: ModelPerformanceIndex = {
      version: '1.0.0',
      entries: [makeEntry('existing-model', 'synthesis', 0.8, 400, 10)],
      updatedAt: new Date().toISOString(),
    };
    let storedData = '';
    const _fsRead = async (_p: string): Promise<string> => JSON.stringify(existingIndex);
    const _fsWrite = async (_p: string, d: string): Promise<void> => {
      storedData = d;
    };

    // Record new run: latency=600, quality=1.0
    await recordModelRun('existing-model', 'synthesis', 600, 1.0, undefined, {
      _fsRead,
      _fsWrite,
    });

    const saved = JSON.parse(storedData) as ModelPerformanceIndex;
    assert.equal(saved.entries.length, 1);
    const entry = saved.entries[0]!;
    assert.equal(entry.totalRuns, 11);
    // avgQuality = (0.8 * 10 + 1.0) / 11 = 9/11 ≈ 0.8181...
    const expectedQuality = (0.8 * 10 + 1.0) / 11;
    assert.ok(
      Math.abs(entry.avgQualityScore - expectedQuality) < 0.0001,
      `Expected avgQualityScore ~${expectedQuality}, got ${entry.avgQualityScore}`,
    );
    // avgLatency = (400 * 10 + 600) / 11 = 4600/11 ≈ 418.18...
    const expectedLatency = (400 * 10 + 600) / 11;
    assert.ok(
      Math.abs(entry.avgLatencyMs - expectedLatency) < 0.0001,
      `Expected avgLatencyMs ~${expectedLatency}, got ${entry.avgLatencyMs}`,
    );
  });

  it('T8b: does not affect other model entries when updating', async () => {
    const existingIndex: ModelPerformanceIndex = {
      version: '1.0.0',
      entries: [
        makeEntry('model-x', 'generation', 0.9, 200, 5),
        makeEntry('model-y', 'generation', 0.7, 300, 3),
      ],
      updatedAt: new Date().toISOString(),
    };
    let storedData = '';
    const _fsRead = async (_p: string): Promise<string> => JSON.stringify(existingIndex);
    const _fsWrite = async (_p: string, d: string): Promise<void> => {
      storedData = d;
    };

    await recordModelRun('model-x', 'generation', 100, 1.0, undefined, {
      _fsRead,
      _fsWrite,
    });

    const saved = JSON.parse(storedData) as ModelPerformanceIndex;
    assert.equal(saved.entries.length, 2);
    const yEntry = saved.entries.find((e) => e.model === 'model-y')!;
    assert.equal(yEntry.avgQualityScore, 0.7);
    assert.equal(yEntry.totalRuns, 3);
  });

  it('T8c: updates index.updatedAt on each record call', async () => {
    const before = new Date().toISOString();
    let storedData = '';
    const _fsRead = async (_p: string): Promise<string> => { throw new Error('no file'); };
    const _fsWrite = async (_p: string, d: string): Promise<void> => { storedData = d; };

    await recordModelRun('m', 'scoring', 100, 0.5, undefined, { _fsRead, _fsWrite });

    const saved = JSON.parse(storedData) as ModelPerformanceIndex;
    assert.ok(saved.updatedAt >= before, 'updatedAt should be recent');
  });
});
