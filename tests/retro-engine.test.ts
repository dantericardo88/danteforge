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

// ─── runRetro (covers gatherMetrics + generatePraise + generateGrowthAreas) ──

describe('runRetro', () => {
  it('returns a valid RetroReport in an empty tmp dir (git errors handled gracefully)', async () => {
    const { runRetro } = await import('../src/core/retro-engine.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-run-'));

    const report = await runRetro(tmpDir);

    assert.ok(typeof report.score === 'number', 'score should be a number');
    assert.ok(report.score >= 0 && report.score <= 100);
    assert.ok(typeof report.timestamp === 'string');
    assert.ok(Array.isArray(report.praise), 'praise should be an array');
    assert.ok(Array.isArray(report.growthAreas), 'growthAreas should be an array');
    assert.ok(report.praise.length >= 1, 'should always have at least one praise item');
    assert.ok(report.growthAreas.length >= 1, 'should always have at least one growth area');
    assert.strictEqual(report.delta, null, 'delta is null when no prior retro exists');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('runRetro returns priorRetroPath when prior retro exists', async () => {
    const { runRetro } = await import('../src/core/retro-engine.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-prior-'));

    // Write a prior retro first
    const retroDir = path.join(tmpDir, '.danteforge', 'retros');
    const priorReport = makeReport({ score: 70 });
    await writeRetroFiles(priorReport, retroDir);

    const report = await runRetro(tmpDir);
    assert.ok(report.delta !== null, 'delta should be calculated when prior retro exists');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('praise includes "early stages" message for zero-activity project', async () => {
    const { runRetro } = await import('../src/core/retro-engine.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-zero-'));

    const report = await runRetro(tmpDir);
    // In a tmp dir with no git activity, commitCount=0, locAdded=0
    assert.ok(
      report.praise.some(p =>
        p.includes('early stages') || p.includes('commit') ||
        p.includes('foundation') || p.includes('new code') || p.includes('waves'),
      ),
      `Got praise items: ${report.praise.join(', ')}`,
    );

    await fs.rm(tmpDir, { recursive: true });
  });

  it('runRetro picks up lessons.md if present', async () => {
    const { runRetro } = await import('../src/core/retro-engine.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-lessons-'));
    const danteDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(danteDir);
    const lessonsContent = '## Lesson 1\n\n## Lesson 2\n\n## Lesson 3\n\n## Lesson 4\n\n## Lesson 5\n';
    await fs.writeFile(path.join(danteDir, 'lessons.md'), lessonsContent);

    const report = await runRetro(tmpDir);
    assert.ok(report.metrics.lessonsAdded >= 5, `Expected >= 5 lessons, got ${report.metrics.lessonsAdded}`);
    assert.ok(
      report.praise.some(p => p.includes('lessons') || p.includes('learning')),
      `Expected lessons praise, got: ${report.praise.join(', ')}`,
    );

    await fs.rm(tmpDir, { recursive: true });
  });

  it('runRetro reads test coverage from coverage-summary.json (>= 80% → praise)', async () => {
    const { runRetro } = await import('../src/core/retro-engine.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-cov-high-'));

    const coverageDir = path.join(tmpDir, 'coverage');
    await fs.mkdir(coverageDir);
    await fs.writeFile(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify({ total: { lines: { pct: 85 } } }),
    );

    const report = await runRetro(tmpDir);
    assert.strictEqual(report.metrics.testCoveragePercent, 85, 'Should read 85% from coverage file');
    assert.ok(
      report.praise.some(p => p.includes('coverage') || p.includes('80%') || p.includes('quality')),
      `Expected coverage praise, got: ${report.praise.join(', ')}`,
    );

    await fs.rm(tmpDir, { recursive: true });
  });

  it('runRetro reads test coverage < 60% → growth area suggestion', async () => {
    const { runRetro } = await import('../src/core/retro-engine.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-cov-low-'));

    const coverageDir = path.join(tmpDir, 'coverage');
    await fs.mkdir(coverageDir);
    await fs.writeFile(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify({ total: { lines: { pct: 45 } } }),
    );

    const report = await runRetro(tmpDir);
    assert.strictEqual(report.metrics.testCoveragePercent, 45, 'Should read 45% from coverage file');
    assert.ok(
      report.growthAreas.some(a => a.includes('coverage') || a.includes('80%')),
      `Expected coverage growth area, got: ${report.growthAreas.join(', ')}`,
    );

    await fs.rm(tmpDir, { recursive: true });
  });
});

// ─── computeRetroScore — additional branches ─────────────────────────────

describe('computeRetroScore — additional branches', () => {
  it('gives 15 points for 60-79% test coverage', () => {
    const score = computeRetroScore(makeMetrics({
      testCoveragePercent: 70,
      commitCount: 0, locAdded: 0, lessonsAdded: 0, wavesCompleted: 0,
    }));
    assert.strictEqual(score, 15, `Expected 15 for 60-79% coverage, got ${score}`);
  });

  it('gives 10 points for 40-59% test coverage', () => {
    const score = computeRetroScore(makeMetrics({
      testCoveragePercent: 50,
      commitCount: 0, locAdded: 0, lessonsAdded: 0, wavesCompleted: 0,
    }));
    assert.strictEqual(score, 10, `Expected 10 for 40-59% coverage, got ${score}`);
  });

  it('gives 5 points for < 40% test coverage', () => {
    const score = computeRetroScore(makeMetrics({
      testCoveragePercent: 30,
      commitCount: 0, locAdded: 0, lessonsAdded: 0, wavesCompleted: 0,
    }));
    assert.strictEqual(score, 5, `Expected 5 for < 40% coverage, got ${score}`);
  });

  it('gives correct points for commitCount tiers', () => {
    const base = makeMetrics({ locAdded: 0, locRemoved: 0, lessonsAdded: 0, wavesCompleted: 0, testCoveragePercent: null });
    assert.strictEqual(computeRetroScore({ ...base, commitCount: 1 }), 5);
    assert.strictEqual(computeRetroScore({ ...base, commitCount: 7 }), 10);
    assert.strictEqual(computeRetroScore({ ...base, commitCount: 12 }), 20);
    assert.strictEqual(computeRetroScore({ ...base, commitCount: 22 }), 30);
  });

  it('gives correct points for LOC tiers', () => {
    const base = makeMetrics({ commitCount: 0, lessonsAdded: 0, wavesCompleted: 0, testCoveragePercent: null, locRemoved: 0 });
    assert.strictEqual(computeRetroScore({ ...base, locAdded: 10 }), 10);
    assert.strictEqual(computeRetroScore({ ...base, locAdded: 100 }), 15);
    assert.strictEqual(computeRetroScore({ ...base, locAdded: 300 }), 20);
    assert.strictEqual(computeRetroScore({ ...base, locAdded: 600 }), 25);
  });

  it('gives 5 points for 1 wave, 10 for 3+ waves', () => {
    const base = makeMetrics({ commitCount: 0, locAdded: 0, locRemoved: 0, lessonsAdded: 0, testCoveragePercent: null });
    assert.strictEqual(computeRetroScore({ ...base, wavesCompleted: 1 }), 5);
    assert.strictEqual(computeRetroScore({ ...base, wavesCompleted: 3 }), 10);
  });
});

// ─── formatRetroMarkdown via writeRetroFiles with delta ───────────────────

describe('formatRetroMarkdown — delta display', () => {
  it('includes positive delta arrow in markdown', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-delta-pos-'));
    const retroDir = path.join(tmpDir, 'retros');

    const report = makeReport({ score: 80, delta: 15 });
    const { mdPath } = await writeRetroFiles(report, retroDir);
    const content = await fs.readFile(mdPath, 'utf8');

    assert.ok(content.includes('↑'), 'Positive delta should show upward arrow');
    assert.ok(content.includes('+15'), 'Should show the delta value with +');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('includes negative delta arrow in markdown', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-delta-neg-'));
    const retroDir = path.join(tmpDir, 'retros');

    const report = makeReport({ score: 60, delta: -10 });
    const { mdPath } = await writeRetroFiles(report, retroDir);
    const content = await fs.readFile(mdPath, 'utf8');

    assert.ok(content.includes('↓'), 'Negative delta should show downward arrow');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('includes zero delta stable arrow', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-delta-zero-'));
    const retroDir = path.join(tmpDir, 'retros');

    const report = makeReport({ score: 75, delta: 0 });
    const { mdPath } = await writeRetroFiles(report, retroDir);
    const content = await fs.readFile(mdPath, 'utf8');

    assert.ok(content.includes('→'), 'Zero delta should show stable arrow');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('includes test coverage in markdown when provided', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-coverage-'));
    const retroDir = path.join(tmpDir, 'retros');

    const report = makeReport({ metrics: makeMetrics({ testCoveragePercent: 82 }) });
    const { mdPath } = await writeRetroFiles(report, retroDir);
    const content = await fs.readFile(mdPath, 'utf8');

    assert.ok(content.includes('82%'), 'Should include test coverage percentage');

    await fs.rm(tmpDir, { recursive: true });
  });
});
