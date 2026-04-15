// Status — unit tests for dashboard generation using injection seams.
// No real filesystem reads — all data injected via _loadConvergence, _loadQueue, etc.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { status, renderStatus, type StatusOptions } from '../src/cli/commands/status.js';
import {
  initConvergence,
  updateDimension,
  type ConvergenceState,
} from '../src/core/convergence.js';
import { type HarvestQueue } from '../src/core/harvest-queue.js';
import { type GoalConfig } from '../src/cli/commands/set-goal.js';
import { type AdoptionCandidate } from '../src/cli/commands/oss-intel.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-status-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function emptyConvergence(): ConvergenceState {
  return initConvergence(9.0);
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

function makeGoal(overrides: Partial<GoalConfig> = {}): GoalConfig {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    category: 'agentic dev CLI',
    competitors: ['Cursor'],
    definition9: 'Fully autonomous',
    exclusions: [],
    dailyBudgetUsd: 5.0,
    oversightLevel: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAdoption(patternName: string): AdoptionCandidate {
  return {
    patternName,
    category: 'architecture',
    sourceRepo: 'repo/test',
    referenceImplementation: '',
    whatToBuild: `Implement ${patternName}`,
    filesToModify: [],
    estimatedEffort: '4h',
    unlocksGapClosure: [],
    adoptionScore: 5,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Status — empty state', () => {

  it('T1: status with no data shows cyclesRun=0, totalCostUsd=0', async () => {
    const report = await status({
      _loadConvergence: async () => emptyConvergence(),
      _loadQueue: async () => emptyQueue(),
      _readGoal: async () => null,
      _readAdoptionQueue: async () => [],
    });

    assert.strictEqual(report.cyclesRun, 0);
    assert.strictEqual(report.totalCostUsd, 0);
    assert.strictEqual(report.totalDimensions, 0);
    assert.strictEqual(report.convergedCount, 0);
    assert.strictEqual(report.goal, null);
  });

  it('T2: status reads convergence.json dimensions and maps to symbols', async () => {
    let conv = emptyConvergence();
    // Converged dimension: 2 identical scores >= target
    conv = updateDimension(conv, 'circuit-breaker', 9.2);
    conv = updateDimension(conv, 'circuit-breaker', 9.2);
    // In-progress: has score history but not converged
    conv = updateDimension(conv, 'streaming', 7.0);
    // Not-started is not possible through updateDimension — scoreHistory always has at least 1

    const report = await status({
      _loadConvergence: async () => conv,
      _loadQueue: async () => emptyQueue(),
      _readGoal: async () => null,
      _readAdoptionQueue: async () => [],
    });

    assert.strictEqual(report.dimensions.length, 2);
    const cb = report.dimensions.find(d => d.name === 'circuit-breaker')!;
    const st = report.dimensions.find(d => d.name === 'streaming')!;
    assert.ok(cb, 'circuit-breaker must appear in dimensions');
    assert.ok(st, 'streaming must appear in dimensions');
    assert.strictEqual(cb.status, 'converged');
    assert.strictEqual(cb.symbol, '✓');
    assert.strictEqual(st.status, 'in-progress');
    assert.strictEqual(st.symbol, '▷');
  });

  it('T3: converged dimension maps to symbol ✓', async () => {
    let conv = emptyConvergence();
    conv = updateDimension(conv, 'security', 9.5);
    conv = updateDimension(conv, 'security', 9.5);

    const report = await status({
      _loadConvergence: async () => conv,
      _loadQueue: async () => emptyQueue(),
      _readGoal: async () => null,
      _readAdoptionQueue: async () => [],
    });

    const sec = report.dimensions.find(d => d.name === 'security')!;
    assert.strictEqual(sec.symbol, '✓');
    assert.strictEqual(sec.status, 'converged');
  });

  it('T4: in-progress dimension maps to symbol ▷', async () => {
    let conv = emptyConvergence();
    conv = updateDimension(conv, 'observability', 4.5);

    const report = await status({
      _loadConvergence: async () => conv,
      _loadQueue: async () => emptyQueue(),
      _readGoal: async () => null,
      _readAdoptionQueue: async () => [],
    });

    const obs = report.dimensions.find(d => d.name === 'observability')!;
    assert.strictEqual(obs.symbol, '▷');
    assert.strictEqual(obs.status, 'in-progress');
  });

  it('T5: not-started dimension (converged=false, scoreHistory=[]) maps to symbol ✗', async () => {
    // Inject a convergence state with a dimension that has scoreHistory=[]
    const conv: ConvergenceState = {
      ...emptyConvergence(),
      dimensions: [
        {
          dimension: 'not-started-dim',
          score: 0,
          evidence: [],
          scoreHistory: [],
          converged: false,
        },
      ],
    };

    const report = await status({
      _loadConvergence: async () => conv,
      _loadQueue: async () => emptyQueue(),
      _readGoal: async () => null,
      _readAdoptionQueue: async () => [],
    });

    const ns = report.dimensions.find(d => d.name === 'not-started-dim')!;
    assert.strictEqual(ns.symbol, '✗');
    assert.strictEqual(ns.status, 'not-started');
  });

});

describe('Status — data sources', () => {

  it('T6: status reads harvest-queue.json for ossStats', async () => {
    const queue: HarvestQueue = {
      ...emptyQueue(),
      totalPatternsExtracted: 47,
      totalPatternsAdopted: 18,
      repos: [
        { url: 'https://github.com/a/vitest', slug: 'vitest', priority: 8, gapTargets: [], status: 'deep', addedAt: '', patternsExtracted: 20, patternsAdopted: 10 },
        { url: 'https://github.com/b/got', slug: 'got', priority: 7, gapTargets: [], status: 'exhausted', addedAt: '', patternsExtracted: 15, patternsAdopted: 5 },
        { url: 'https://github.com/c/queued', slug: 'queued-repo', priority: 5, gapTargets: [], status: 'queued', addedAt: '', patternsExtracted: 0, patternsAdopted: 0 },
      ],
    };

    const report = await status({
      _loadConvergence: async () => emptyConvergence(),
      _loadQueue: async () => queue,
      _readGoal: async () => null,
      _readAdoptionQueue: async () => [],
    });

    assert.strictEqual(report.ossStats.reposExtracted, 2, 'Only deep+exhausted repos count as extracted');
    assert.strictEqual(report.ossStats.patternsExtracted, 47);
    assert.strictEqual(report.ossStats.patternsAdopted, 18);
    assert.ok(report.ossStats.topSources.length <= 3, 'topSources must have at most 3 entries');
  });

  it('T7: status reads GOAL.json for dailyBudgetUsd and computes budgetRemainingUsd', async () => {
    const conv: ConvergenceState = {
      ...emptyConvergence(),
      totalCostUsd: 3.20,
    };

    const report = await status({
      _loadConvergence: async () => conv,
      _loadQueue: async () => emptyQueue(),
      _readGoal: async () => makeGoal({ dailyBudgetUsd: 5.0 }),
      _readAdoptionQueue: async () => [],
    });

    assert.strictEqual(report.totalCostUsd, 3.20);
    assert.ok(Math.abs(report.budgetRemainingUsd - 1.80) < 0.01, `budgetRemainingUsd must be ~1.80, got ${report.budgetRemainingUsd}`);
  });

  it('T8: status reads ADOPTION_QUEUE.md for nextCyclePlan (top 3 names)', async () => {
    const report = await status({
      _loadConvergence: async () => emptyConvergence(),
      _loadQueue: async () => emptyQueue(),
      _readGoal: async () => null,
      _readAdoptionQueue: async () => [
        makeAdoption('structured-logging'),
        makeAdoption('retry-with-backoff'),
        makeAdoption('opentelemetry-spans'),
        makeAdoption('fourth-pattern'),  // should NOT appear
      ],
    });

    assert.strictEqual(report.nextCyclePlan.length, 3, 'nextCyclePlan must have at most 3 entries');
    assert.ok(report.nextCyclePlan.includes('structured-logging'), 'first pattern must be included');
    assert.ok(report.nextCyclePlan.includes('retry-with-backoff'), 'second pattern must be included');
    assert.ok(!report.nextCyclePlan.includes('fourth-pattern'), 'fourth pattern must be excluded');
  });

  it('T9: status handles missing harvest-queue.json gracefully (ossStats all zeros)', async () => {
    const report = await status({
      _loadConvergence: async () => emptyConvergence(),
      _loadQueue: async () => { throw new Error('file not found'); },
      _readGoal: async () => null,
      _readAdoptionQueue: async () => [],
    });

    assert.strictEqual(report.ossStats.reposExtracted, 0);
    assert.strictEqual(report.ossStats.patternsExtracted, 0);
    assert.strictEqual(report.ossStats.patternsAdopted, 0);
  });

});

describe('Status — rendering', () => {

  it('T10: renderStatus returns string containing border and dimension names', async () => {
    let conv = emptyConvergence();
    conv = updateDimension(conv, 'circuit-breaker', 9.2);
    conv = updateDimension(conv, 'circuit-breaker', 9.2);
    conv = updateDimension(conv, 'streaming', 7.0);

    const report = await status({
      _loadConvergence: async () => conv,
      _loadQueue: async () => emptyQueue(),
      _readGoal: async () => makeGoal(),
      _readAdoptionQueue: async () => [],
    });

    const rendered = renderStatus(report);

    assert.ok(rendered.includes('╔'), 'rendered output must contain top border ╔');
    assert.ok(rendered.includes('╚'), 'rendered output must contain bottom border ╚');
    assert.ok(rendered.includes('circuit-breaker'), 'rendered output must include dimension name');
    assert.ok(rendered.includes('streaming'), 'rendered output must include streaming dimension');
    assert.ok(rendered.includes('CONVERGED') || rendered.includes('✓'), 'converged dimension must be marked');
  });

});
