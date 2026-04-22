// ascend-evidence-loop.test.ts — tests for harvest bootstrap, periodic retro, mid-loop verify
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAscend, type AscendEngineOptions } from '../src/core/ascend-engine.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

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

/** Base options for dryRun tests — no real I/O, confirms gate, skips loop */
function makeDryRunOpts(extra: Partial<AscendEngineOptions> = {}): AscendEngineOptions {
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

/** A complete dimension with all required fields including sprint_history */
function makeAchievableDim(id = 'functionality'): import('../src/core/compete-matrix.js').MatrixDimension {
  return {
    id,
    label: 'Functionality',
    weight: 1.5,
    category: 'quality',
    frequency: 'high',
    scores: { self: 5.0 },
    gap_to_leader: 4.0,
    leader: 'Test',
    gap_to_closed_source_leader: 4.0,
    closed_source_leader: 'Test',
    sprint_history: [],
    status: 'in-progress',
  };
}

/** Base options for real-loop tests — dryRun: false, all dims pre-closed so loop exits immediately */
function makeLoopOpts(extra: Partial<AscendEngineOptions> = {}): AscendEngineOptions {
  return {
    dryRun: false,
    yes: true,
    maxCycles: 6,
    executeMode: 'advisory',
    _loadMatrix: async () => makeMatrix(),   // no dimensions → loop exits after 0 cycles
    _saveMatrix: async () => {},
    _harshScore: async () => makeScoreResult(),
    _computeStrictDims: async () => ({ autonomy: 90, selfImprovement: 80, tokenEconomy: 85 }),
    _confirmMatrix: async () => true,
    _isLLMAvailable: async () => true,
    _bootstrapHarvest: async () => {},
    _runVerify: async () => {},
    _runRetro: async () => {},
    _saveCheckpoint: async () => {},
    _loadCheckpoint: async () => null,
    _clearCheckpoint: async () => {},
    ...extra,
  };
}

/** Real-loop opts with one achievable dimension that plateaus immediately */
function makeActiveLoopOpts(extra: Partial<AscendEngineOptions> = {}): AscendEngineOptions {
  return {
    dryRun: false,
    yes: true,
    maxCycles: 6,
    executeMode: 'advisory',
    _loadMatrix: async () => makeMatrix({ dimensions: [makeAchievableDim()], overallSelfScore: 5.0 }),
    _saveMatrix: async () => {},
    _harshScore: async () => makeScoreResult(5.0),  // score stays same → plateau → loop stops
    _computeStrictDims: async () => ({ autonomy: 80, selfImprovement: 70, tokenEconomy: 85 }),
    _confirmMatrix: async () => true,
    _isLLMAvailable: async () => true,
    _bootstrapHarvest: async () => {},
    _runVerify: async () => {},
    _runRetro: async () => {},
    _runLoop: async (ctx) => ({ ...ctx }),  // no-op loop
    _saveCheckpoint: async () => {},
    _loadCheckpoint: async () => null,
    _clearCheckpoint: async () => {},
    ...extra,
  };
}

describe('ascend — OSS harvest bootstrap', () => {
  it('calls _bootstrapHarvest before loop when autoHarvest is not false', async () => {
    let called = false;
    await runAscend(makeLoopOpts({
      _bootstrapHarvest: async () => { called = true; },
    }));
    assert.ok(called, '_bootstrapHarvest should be called');
  });

  it('skips _bootstrapHarvest when autoHarvest: false', async () => {
    let called = false;
    await runAscend(makeLoopOpts({
      autoHarvest: false,
      _bootstrapHarvest: async () => { called = true; },
    }));
    assert.ok(!called, '_bootstrapHarvest should NOT be called when autoHarvest is false');
  });

  it('skips _bootstrapHarvest on dryRun: true', async () => {
    let called = false;
    await runAscend(makeDryRunOpts({
      _bootstrapHarvest: async () => { called = true; },
    }));
    assert.ok(!called, '_bootstrapHarvest should NOT be called in dry-run mode');
  });
});

describe('ascend — periodic retro in loop', () => {
  it('calls _runRetro at retroInterval=1 after cycle 1', async () => {
    let retroCallCount = 0;
    await runAscend(makeActiveLoopOpts({
      maxCycles: 1,
      retroInterval: 1,
      _runRetro: async () => { retroCallCount++; },
    }));
    // With retroInterval=1 and maxCycles=1, retro fires after cycle 1 (1 % 1 === 0)
    assert.strictEqual(retroCallCount, 1, `Expected 1 retro call, got ${retroCallCount}`);
  });

  it('does not call _runRetro on dryRun: true', async () => {
    let called = false;
    await runAscend(makeDryRunOpts({
      _runRetro: async () => { called = true; },
    }));
    assert.ok(!called, '_runRetro should NOT be called in dry-run mode');
  });
});

describe('ascend — mid-loop verify pass', () => {
  it('calls _runVerify once before the first cycle (with achievable dims)', async () => {
    let verifyCalls = 0;
    await runAscend(makeActiveLoopOpts({
      _runVerify: async () => { verifyCalls++; },
    }));
    assert.strictEqual(verifyCalls, 1, '_runVerify should be called exactly once before the loop');
  });

  it('skips _runVerify on dryRun: true', async () => {
    let called = false;
    await runAscend(makeDryRunOpts({
      _runVerify: async () => { called = true; },
    }));
    assert.ok(!called, '_runVerify should NOT be called in dry-run mode');
  });

  it('skips _runVerify when verifyLoop: false', async () => {
    let called = false;
    await runAscend(makeActiveLoopOpts({
      verifyLoop: false,
      _runVerify: async () => { called = true; },
    }));
    assert.ok(!called, '_runVerify should NOT be called when verifyLoop is false');
  });
});
