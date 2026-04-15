import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runNext, type NextOptions, type NextRecommendation } from '../src/cli/commands/next.js';
import type { ConvergenceState } from '../src/core/convergence.js';
import type { HarvestQueue } from '../src/core/harvest-queue.js';
import type { AttributionLog } from '../src/core/causal-attribution.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

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

function emptyLog(): AttributionLog {
  return { version: '1.0.0', records: [], updatedAt: new Date().toISOString() };
}

function emptyConvergence(): ConvergenceState {
  return {
    version: '1.0.0',
    targetScore: 9.0,
    dimensions: [],
    cycleHistory: [],
    lastCycle: 0,
    totalCostUsd: 0,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    adoptedPatternsSummary: [],
  };
}

function makeBaseOptions(overrides: Partial<NextOptions> = {}): NextOptions {
  return {
    _isLLMAvailable: async () => false,
    _loadConvergence: async () => null,
    _loadQueue: async () => emptyQueue(),
    _loadAttributionLog: async () => emptyLog(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('next-command', () => {
  it('T1: promptMode=true returns without calling LLM', async () => {
    let llmCalled = false;
    const options = makeBaseOptions({
      promptMode: true,
      _llmCaller: async () => {
        llmCalled = true;
        return '{}';
      },
      _isLLMAvailable: async () => true,
    });

    const result = await runNext(options);

    assert.equal(llmCalled, false, 'LLM should not be called in promptMode');
    assert.ok(typeof result.topAction === 'string', 'topAction should be a string');
    assert.ok(typeof result.reasoning === 'string', 'reasoning should be a string');
    assert.ok(Array.isArray(result.alternatives), 'alternatives should be an array');
    assert.ok(typeof result.estimatedImpact === 'string', 'estimatedImpact should be a string');
  });

  it('T2: LLM unavailable → uses deterministic fallback, returns NextRecommendation', async () => {
    const options = makeBaseOptions({
      _isLLMAvailable: async () => false,
    });

    const result = await runNext(options);

    // Should return a valid NextRecommendation from local heuristics
    assert.ok(typeof result.topAction === 'string');
    assert.ok(result.topAction.length > 0);
    assert.ok(typeof result.reasoning === 'string');
    assert.ok(Array.isArray(result.alternatives));
    assert.ok(result.alternatives.length > 0);
    assert.ok(typeof result.estimatedImpact === 'string');
  });

  it('T3: queue has repos with status=queued → recommends oss-intel in fallback', async () => {
    const queueWithRepo: HarvestQueue = {
      ...emptyQueue(),
      repos: [
        {
          url: 'https://github.com/example/some-repo',
          slug: 'some-repo',
          priority: 8,
          gapTargets: ['testing', 'security'],
          status: 'queued',
          addedAt: new Date().toISOString(),
          patternsExtracted: 0,
          patternsAdopted: 0,
        },
      ],
    };

    const options = makeBaseOptions({
      _isLLMAvailable: async () => false,
      _loadQueue: async () => queueWithRepo,
    });

    const result = await runNext(options);

    assert.ok(
      result.topAction.toLowerCase().includes('oss-intel') ||
        result.topAction.toLowerCase().includes('harvest'),
      `Expected oss-intel/harvest in topAction, got: "${result.topAction}"`,
    );
    assert.ok(
      result.topAction.includes('some-repo'),
      `Expected repo slug in topAction, got: "${result.topAction}"`,
    );
  });

  it('T4: no queued repos but gaps exist → recommends autoforge on lowest-score dimension', async () => {
    const convergenceWithGaps: ConvergenceState = {
      ...emptyConvergence(),
      targetScore: 9.0,
      dimensions: [
        {
          dimension: 'security',
          score: 3.5,
          evidence: [],
          scoreHistory: [3.5],
          converged: false,
        },
        {
          dimension: 'testing',
          score: 6.0,
          evidence: [],
          scoreHistory: [6.0],
          converged: false,
        },
      ],
    };

    const options = makeBaseOptions({
      _isLLMAvailable: async () => false,
      _loadConvergence: async () => convergenceWithGaps,
      _loadQueue: async () => emptyQueue(), // no queued repos
    });

    const result = await runNext(options);

    // Should recommend autoforge on the lowest-score dimension (security at 3.5)
    assert.ok(
      result.topAction.toLowerCase().includes('autoforge') ||
        result.topAction.toLowerCase().includes('security'),
      `Expected autoforge or security in topAction, got: "${result.topAction}"`,
    );
    assert.ok(
      result.topAction.includes('security') || result.reasoning.includes('security'),
      `Expected security dimension mentioned, got topAction: "${result.topAction}", reasoning: "${result.reasoning}"`,
    );
  });

  it('T5: LLM available and returns valid JSON → uses LLM recommendation', async () => {
    const llmResult: NextRecommendation = {
      topAction: 'Run oss-intel on facebook/react',
      reasoning: 'React has high test coverage patterns we can harvest.',
      alternatives: ['Run assess first', 'Try universe-scan'],
      estimatedImpact: 'Raises testing score by 2.5 points',
    };

    const options = makeBaseOptions({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => JSON.stringify(llmResult),
    });

    const result = await runNext(options);

    assert.equal(result.topAction, llmResult.topAction);
    assert.equal(result.reasoning, llmResult.reasoning);
    assert.deepEqual(result.alternatives, llmResult.alternatives);
    assert.equal(result.estimatedImpact, llmResult.estimatedImpact);
  });

  it('T6: LLM returns invalid JSON → falls back to deterministic recommendation (no throw)', async () => {
    const options = makeBaseOptions({
      _isLLMAvailable: async () => true,
      _llmCaller: async () => 'this is not json at all { broken',
    });

    // Should not throw — gracefully falls back to heuristics
    const result = await runNext(options);

    assert.ok(typeof result.topAction === 'string', 'topAction should be a string after fallback');
    assert.ok(result.topAction.length > 0, 'topAction should not be empty after fallback');
    assert.ok(Array.isArray(result.alternatives), 'alternatives should be an array after fallback');
  });
});
