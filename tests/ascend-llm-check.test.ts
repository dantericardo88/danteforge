// ascend-llm-check.test.ts — tests for the LLM pre-flight check in runAscend
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runAscend, type AscendEngineOptions } from '../src/core/ascend-engine.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// Per-test tmpDir so dryRun runs don't pollute the project's matrix.json
// (the substrate's ensureMatrixOnDisk writes to options.cwd; without a cwd
// override that defaults to process.cwd() which is the project root).
// Per-test (not shared) so each test starts with a clean .danteforge/.
let tmpDir = '';
beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ascend-llm-')); });
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

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
    cwd: tmpDir,
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
