// ascend-llm-check.test.ts — tests for the LLM pre-flight check in runAscend
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAscend, type AscendEngineOptions } from '../src/core/ascend-engine.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// ── Minimal stubs ──────────────────────────────────────────────────────────────

function makeMatrix(overrides: Partial<CompeteMatrix> = {}): CompeteMatrix {
  return {
    project: 'test-project',
    competitors: [],
    oss_competitors: [],
    closed_source_competitors: [],
    dimensions: [],
    overallSelfScore: 8.5,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

function makeScoreResult(score = 8.5): HarshScoreResult {
  return {
    displayScore: score,
    displayDimensions: {},
    rawScores: {},
    summary: '',
    recommendations: [],
  } as unknown as HarshScoreResult;
}

function makeBaseOpts(extra: Partial<AscendEngineOptions> = {}): AscendEngineOptions {
  return {
    dryRun: true,
    yes: true,
    _loadMatrix: async () => makeMatrix(),
    _saveMatrix: async () => {},
    _harshScore: async () => makeScoreResult(),
    _computeStrictDims: async () => ({ autonomy: 80, selfImprovement: 70, tokenEconomy: 85 }),
    _confirmMatrix: async () => true,
    _isLLMAvailable: async () => true,
    _bootstrapHarvest: async () => {},
    _runVerify: async () => {},
    _runRetro: async () => {},
    ...extra,
  };
}

describe('ascend — LLM pre-flight check', () => {
  it('calls _isLLMAvailable before loop starts', async () => {
    let called = false;
    await runAscend(makeBaseOpts({
      _isLLMAvailable: async () => { called = true; return true; },
    }));
    assert.ok(called, '_isLLMAvailable should be called');
  });

  it('proceeds with loop even when _isLLMAvailable returns false', async () => {
    // Should not throw — LLM unavailability is a warning, not a hard stop
    await assert.doesNotReject(async () => {
      await runAscend(makeBaseOpts({
        _isLLMAvailable: async () => false,
      }));
    });
  });

  it('proceeds with loop even when _isLLMAvailable throws', async () => {
    await assert.doesNotReject(async () => {
      await runAscend(makeBaseOpts({
        _isLLMAvailable: async () => { throw new Error('network error'); },
      }));
    });
  });
});
