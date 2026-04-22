import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSprintPlan, type SprintPlanOptions } from '../src/cli/commands/sprint-plan.js';
import type { ConvergenceState } from '../src/core/convergence.js';
import type { HarvestQueue } from '../src/core/harvest-queue.js';
import type { AttributionLog } from '../src/core/causal-attribution.js';
import type { GlobalPatternEntry } from '../src/core/global-pattern-library.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeConvergence(overrides: Partial<ConvergenceState> = {}): ConvergenceState {
  return {
    version: '1.0.0',
    targetScore: 9.0,
    dimensions: [
      { dimension: 'circuit-breaker', score: 4.5, evidence: [], scoreHistory: [3.0, 4.0, 4.5], converged: false },
      { dimension: 'error-handling', score: 6.0, evidence: [], scoreHistory: [5.0, 6.0], converged: false },
      { dimension: 'testing', score: 8.5, evidence: [], scoreHistory: [8.0, 8.5], converged: false },
    ],
    cycleHistory: [],
    lastCycle: 3,
    totalCostUsd: 1.25,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastUpdatedAt: new Date().toISOString(),
    adoptedPatternsSummary: ['retry-with-backoff', 'circuit-breaker'],
    ...overrides,
  };
}

function makeQueue(queuedRepos = 3): HarvestQueue {
  return {
    version: '1.0.0',
    repos: Array.from({ length: queuedRepos }, (_, i) => ({
      url: `https://github.com/test/repo-${i}`,
      slug: `repo-${i}`,
      priority: 8 - i,
      gapTargets: ['circuit-breaker'],
      status: 'queued' as const,
      addedAt: new Date().toISOString(),
      patternsExtracted: 0,
      patternsAdopted: 0,
    })),
    gaps: [],
    updatedAt: new Date().toISOString(),
    harvestCycles: 3,
    totalPatternsExtracted: 10,
    totalPatternsAdopted: 5,
  };
}

function makeAttribution(): AttributionLog {
  return {
    version: '1.0.0',
    records: [
      {
        patternName: 'circuit-retry',
        sourceRepo: 'https://github.com/test/repo',
        adoptedAt: new Date().toISOString(),
        preAdoptionScore: 4.0,
        postAdoptionScore: 5.5,
        scoreDelta: 1.5,
        verifyStatus: 'pass',
        filesModified: ['src/core/llm.ts'],
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function makeLibraryPatterns(): GlobalPatternEntry[] {
  return [{
    patternName: 'exponential-backoff',
    category: 'reliability',
    implementationSnippet: 'const delay = Math.min(base * 2 ** attempt, maxDelay);',
    whyItWorks: 'Prevents thundering herd under load',
    adoptionComplexity: 'low' as const,
    sourceRepo: 'https://github.com/test/lib',
    sourceProject: 'test-project',
    publishedAt: new Date().toISOString(),
    useCount: 5,
    avgRoi: 0.8,
  }];
}

const noLLM = {
  _isLLMAvailable: async () => false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runSprintPlan', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sprint-plan-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('T1: generates a plan file in .danteforge/sprint-plans/', async () => {
    const result = await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      ...noLLM,
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => makeLibraryPatterns(),
    });

    assert.ok(result.planPath.includes('sprint-plan-'), 'plan path should include timestamp prefix');
    const exists = await fs.access(result.planPath).then(() => true).catch(() => false);
    assert.ok(exists, 'plan file should exist on disk');
  });

  it('T2: plan markdown starts with a heading', async () => {
    const result = await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      ...noLLM,
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    assert.ok(result.planMarkdown.startsWith('#'), 'plan should start with a markdown heading');
  });

  it('T3: focusDimensions contains the highest-gap dimension first', async () => {
    const result = await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      ...noLLM,
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    // circuit-breaker has gap of 4.5 (9.0 - 4.5), error-handling has gap of 3.0
    assert.equal(result.focusDimensions[0], 'circuit-breaker', 'highest-gap dimension should be first');
  });

  it('T4: estimatedCyclesToConverge computed from velocity data', async () => {
    const convergenceWithHistory = makeConvergence({
      cycleHistory: [
        { cycle: 1, timestamp: new Date().toISOString(), adoptionsAttempted: 2, adoptionsSucceeded: 2, scoresBefore: { a: 4.0 }, scoresAfter: { a: 5.0 }, costUsd: 0.1 },
        { cycle: 2, timestamp: new Date().toISOString(), adoptionsAttempted: 2, adoptionsSucceeded: 2, scoresBefore: { a: 5.0 }, scoresAfter: { a: 6.0 }, costUsd: 0.1 },
      ],
    });

    const result = await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      ...noLLM,
      _loadConvergence: async () => convergenceWithHistory,
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    assert.ok(result.estimatedCyclesToConverge > 0, 'should estimate cycles when velocity data exists');
  });

  it('T5: LLM output used as plan when LLM available', async () => {
    const llmPlan = '# Sprint 42: Test LLM Plan\n\n## Target Dimensions\n- circuit-breaker: 4.5 → 7.0';
    let llmCalled = false;

    const result = await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { llmCalled = true; return llmPlan; },
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    assert.ok(llmCalled, 'LLM should be called when available');
    assert.ok(result.planMarkdown.includes('Sprint 42'), 'LLM plan should be used');
  });

  it('T6: deterministic plan includes danteforge commands', async () => {
    const result = await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      ...noLLM,
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    assert.ok(
      result.planMarkdown.includes('danteforge'),
      'deterministic plan should include danteforge commands',
    );
  });

  it('T7: skipCritique=true skips the plan critic', async () => {
    // If critique ran it would fail (plan has no blocking issues, but we want to ensure it is skipped)
    const result = await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      ...noLLM,
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    // critiquePassed defaults to true when critique is skipped
    assert.equal(result.critiquePassed, true);
    assert.equal(result.blockingGapCount, 0);
  });

  it('T8: critique runs by default and returns approved for a clean plan', async () => {
    const result = await runSprintPlan({
      cwd: tmpDir,
      ...noLLM,
      stakes: 'low',
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    // A deterministic plan from clean state should have no blocking gaps
    assert.equal(result.critiquePassed, true, 'clean deterministic plan should pass critique');
  });

  it('T9: empty convergence state produces a plan with fallback instructions', async () => {
    const result = await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      ...noLLM,
      _loadConvergence: async () => null,
      _loadQueue: async () => makeQueue(0),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    assert.ok(result.planMarkdown.length > 50, 'should still produce a plan with no state');
    assert.ok(result.focusDimensions.length === 0, 'no dimensions when convergence is null');
  });

  it('T10: _writeFile injection receives plan content', async () => {
    let writtenContent = '';
    let writtenPath = '';

    await runSprintPlan({
      cwd: tmpDir,
      skipCritique: true,
      ...noLLM,
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
      _writeFile: async (p, c) => { writtenPath = p; writtenContent = c; },
    });

    assert.ok(writtenContent.startsWith('#'), 'written content should be markdown plan');
    assert.ok(writtenPath.endsWith('.md'), 'written path should have .md extension');
  });
});

// ── Integration: sprint-plan + critique-plan ──────────────────────────────────

describe('sprint-plan + critique-plan integration', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sprint-critique-integration-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('T11: generated plan is passed to critic and result is included in output', async () => {
    const critiquedPlans: string[] = [];

    const result = await runSprintPlan({
      cwd: tmpDir,
      stakes: 'low',
      ...noLLM,
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    assert.ok(typeof result.critiquePassed === 'boolean', 'critiquePassed should be a boolean');
    assert.ok(typeof result.blockingGapCount === 'number', 'blockingGapCount should be a number');
  });

  it('T12: autoApprove overrides blocking critique result', async () => {
    // Inject a plan that contains a blocking pattern (callLLM direct call)
    const badPlan = '# Sprint 1\n\nconst r = callLLM(prompt)\n';
    let llmCallCount = 0;

    const result = await runSprintPlan({
      cwd: tmpDir,
      stakes: 'medium',
      autoApprove: true,
      _isLLMAvailable: async () => true,
      _llmCaller: async (p: string) => {
        llmCallCount++;
        if (p.includes('most likely reasons')) return '[]';
        if (p.includes('generateplan') || p.includes('Sprint Plan')) return badPlan;
        return '[]'; // critique returns no additional gaps
      },
      _loadConvergence: async () => makeConvergence(),
      _loadQueue: async () => makeQueue(),
      _loadAttributionLog: async () => makeAttribution(),
      _queryLibrary: async () => [],
    });

    // Even with blocking gaps, autoApprove should set critiquePassed=true
    assert.equal(result.critiquePassed, true, 'autoApprove should override blocking critique');
  });
});
