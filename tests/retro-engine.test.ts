// Retro Engine tests — score computation, delta, file writing, no PII
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  computeRetroScore,
  computeRetroDelta,
  writeRetroFiles,
  loadPriorRetro,
  type RetroMetrics,
  type RetroReport,
} from '../src/core/retro-engine.js';

function makeMetrics(overrides: Partial<RetroMetrics> = {}): RetroMetrics {
  return {
    commitCount: 15,
    locAdded: 300,
    locRemoved: 50,
    testCoveragePercent: null,
    lessonsAdded: 3,
    wavesCompleted: 2,
    ...overrides,
  };
}

function makeReport(overrides: Partial<RetroReport> = {}): RetroReport {
  return {
    timestamp: new Date().toISOString(),
    metrics: makeMetrics(),
    score: 75,
    delta: null,
    praise: ['Good commit cadence'],
    growthAreas: ['Capture more lessons'],
    priorRetroPath: null,
    ...overrides,
  };
}

describe('computeRetroScore', () => {
  it('scores high commit + LOC + lessons at >= 60', () => {
    const score = computeRetroScore(makeMetrics({ commitCount: 25, locAdded: 600, lessonsAdded: 5 }));
    assert.ok(score >= 60, `Expected >= 60, got ${score}`);
  });

  it('scores zero commits at low score', () => {
    const score = computeRetroScore(makeMetrics({ commitCount: 0, locAdded: 0, locRemoved: 0, lessonsAdded: 0, wavesCompleted: 0 }));
    assert.ok(score < 20, `Expected < 20, got ${score}`);
  });

  it('gives bonus for test coverage >= 80%', () => {
    const withCoverage = computeRetroScore(makeMetrics({ testCoveragePercent: 85 }));
    const withoutCoverage = computeRetroScore(makeMetrics({ testCoveragePercent: null }));
    assert.ok(withCoverage > withoutCoverage);
  });

  it('caps at 100', () => {
    const score = computeRetroScore(makeMetrics({
      commitCount: 100, locAdded: 2000, testCoveragePercent: 95, lessonsAdded: 10, wavesCompleted: 5,
    }));
    assert.ok(score <= 100);
  });
});

describe('computeRetroDelta', () => {
  it('returns positive delta for improvement', () => {
    assert.strictEqual(computeRetroDelta(80, 60), 20);
  });

  it('returns negative delta for regression', () => {
    assert.strictEqual(computeRetroDelta(50, 70), -20);
  });

  it('returns 0 for stable', () => {
    assert.strictEqual(computeRetroDelta(75, 75), 0);
  });
});

describe('writeRetroFiles', () => {
  it('writes JSON and markdown files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-test-'));
    const retroDir = path.join(tmpDir, 'retros');

    const report = makeReport();
    const { jsonPath, mdPath } = await writeRetroFiles(report, retroDir);

    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(jsonContent) as RetroReport;
    assert.strictEqual(parsed.score, 75);

    const mdContent = await fs.readFile(mdPath, 'utf8');
    assert.ok(mdContent.includes('# Project Retrospective'));
    assert.ok(mdContent.includes('75/100'));

    await fs.rm(tmpDir, { recursive: true });
  });

  it('contains no PII in output', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-pii-'));
    const retroDir = path.join(tmpDir, 'retros');

    const report = makeReport();
    const { jsonPath, mdPath } = await writeRetroFiles(report, retroDir);

    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const mdContent = await fs.readFile(mdPath, 'utf8');

    // No email patterns
    assert.ok(!/@/.test(jsonContent));
    assert.ok(!/@/.test(mdContent));

    await fs.rm(tmpDir, { recursive: true });
  });
});

describe('loadPriorRetro', () => {
  it('returns null when no retros exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-empty-'));
    const result = await loadPriorRetro(tmpDir);
    assert.strictEqual(result, null);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('loads the most recent retro', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-load-'));
    const report = makeReport({ score: 85 });
    await writeRetroFiles(report, tmpDir);

    const loaded = await loadPriorRetro(tmpDir);
    assert.ok(loaded !== null);
    assert.strictEqual(loaded!.score, 85);

    await fs.rm(tmpDir, { recursive: true });
  });
});
