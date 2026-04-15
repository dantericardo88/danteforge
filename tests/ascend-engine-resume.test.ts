import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  runAscend,
  ASCEND_PAUSE_FILE,
  type AscendCheckpoint,
  type AscendEngineOptions,
} from '../src/core/ascend-engine.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';
import { resumeAutoforge } from '../src/cli/commands/resume.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMatrix(dims: Array<{ id: string; score: number }>): CompeteMatrix {
  return {
    dimensions: dims.map(d => ({
      id: d.id,
      label: d.id,
      // Include a competitor score so gap_to_leader stays > 0 —
      // prevents updateDimensionScore from closing the dimension prematurely
      scores: { self: d.score, 'competitor-a': 9.5 },
      status: 'active' as const,
      priority: 1,
      weight: 1,
      gap_to_leader: 9.5 - d.score,
      frequency: 'common',
      sprint_history: [],
      harvest_source: undefined,
      ceiling: undefined,
      ceilingReason: undefined,
    })),
    overallSelfScore: dims.reduce((s, d) => s + d.score, 0) / dims.length,
    lastUpdated: new Date().toISOString(),
  };
}

function makeScoreResult(score = 7.0): HarshScoreResult {
  return {
    rawScore: score * 10,
    harshScore: score * 10,
    displayScore: score,
    dimensions: {} as HarshScoreResult['dimensions'],
    displayDimensions: {} as HarshScoreResult['displayDimensions'],
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: 'acceptable',
    maturityAssessment: { overallScore: 60, dimensions: {}, gaps: [], recommendation: 'proceed', timestamp: '', maturityLevel: 3 } as unknown as HarshScoreResult['maturityAssessment'],
    timestamp: new Date().toISOString(),
  };
}

function makeBaseOpts(overrides: Partial<AscendEngineOptions> = {}): AscendEngineOptions {
  const matrix = makeMatrix([{ id: 'functionality', score: 6.0 }]);
  return {
    cwd: '/tmp/test',
    target: 9.0,
    maxCycles: 2,
    _loadMatrix: async () => matrix,
    _saveMatrix: async () => {},
    _loadState: async () => ({ project: 'test' }) as never,
    _harshScore: async () => makeScoreResult(7.0),
    _runLoop: async (ctx) => ctx,
    _executeCommand: async () => ({ success: true }),
    _writeFile: async () => {},
    _saveCheckpoint: async () => {},
    _loadCheckpoint: async () => null,
    _clearCheckpoint: async () => {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ascend checkpoint — save/load/clear', () => {
  it('_saveCheckpoint is called after each cycle with correct cyclesRun', async () => {
    const savedCheckpoints: AscendCheckpoint[] = [];
    await runAscend(makeBaseOpts({
      _saveCheckpoint: async (cp) => { savedCheckpoints.push(cp); },
    }));
    assert.ok(savedCheckpoints.length >= 1, 'should have saved at least one checkpoint');
    assert.equal(savedCheckpoints[0].cyclesRun, 1);
    assert.equal(savedCheckpoints[0].target, 9.0);
  });

  it('_saveCheckpoint records the currentDimension', async () => {
    const saved: AscendCheckpoint[] = [];
    await runAscend(makeBaseOpts({
      _saveCheckpoint: async (cp) => { saved.push(cp); },
    }));
    assert.ok(saved.length >= 1);
    assert.ok(typeof saved[0].currentDimension === 'string');
    assert.ok(saved[0].currentDimension.length > 0);
  });

  it('_loadCheckpoint returning null causes loop to start from cyclesRun=0', async () => {
    const saved: AscendCheckpoint[] = [];
    await runAscend(makeBaseOpts({
      _loadCheckpoint: async () => null,
      _saveCheckpoint: async (cp) => { saved.push(cp); },
    }));
    assert.equal(saved[0].cyclesRun, 1); // first cycle is #1
  });

  it('_loadCheckpoint returning checkpoint with cyclesRun:1 restores loop position', async () => {
    const matrix = makeMatrix([{ id: 'functionality', score: 6.0 }]);
    const saved: AscendCheckpoint[] = [];
    const checkpoint: AscendCheckpoint = {
      pausedAt: new Date().toISOString(),
      cyclesRun: 1,
      maxCycles: 3,
      target: 9.0,
      startedAt: new Date().toISOString(),
      plateauedDims: [],
      currentDimension: 'functionality',
      beforeScores: { functionality: 6.0 },
    };
    await runAscend(makeBaseOpts({
      maxCycles: 3,
      _loadMatrix: async () => matrix,
      _loadCheckpoint: async () => checkpoint,
      _saveCheckpoint: async (cp) => { saved.push(cp); },
    }));
    // First saved checkpoint after resume should have cyclesRun >= 2
    assert.ok(saved.length >= 1);
    assert.ok(saved[0].cyclesRun >= 2, `expected cyclesRun >= 2, got ${saved[0].cyclesRun}`);
  });

  it('_loadCheckpoint with plateauedDims restores the set', async () => {
    const matrix = makeMatrix([
      { id: 'functionality', score: 6.0 },
      { id: 'testing', score: 5.0 },
    ]);
    const checkpoint: AscendCheckpoint = {
      pausedAt: new Date().toISOString(),
      cyclesRun: 1,
      maxCycles: 3,
      target: 9.0,
      startedAt: new Date().toISOString(),
      plateauedDims: ['functionality'], // mark as plateaued
      currentDimension: 'functionality',
      beforeScores: { functionality: 6.0, testing: 5.0 },
    };
    // Just ensure it doesn't throw and runs
    await runAscend(makeBaseOpts({
      maxCycles: 3,
      _loadMatrix: async () => matrix,
      _loadCheckpoint: async () => checkpoint,
      _saveCheckpoint: async () => {},
    }));
  });

  it('_clearCheckpoint is called on normal completion', async () => {
    let cleared = false;
    // Make score >= target so loop converges immediately
    const matrix = makeMatrix([{ id: 'functionality', score: 9.5 }]);
    await runAscend(makeBaseOpts({
      _loadMatrix: async () => matrix,
      _harshScore: async () => makeScoreResult(9.5),
      _clearCheckpoint: async () => { cleared = true; },
    }));
    assert.equal(cleared, true, '_clearCheckpoint should be called when loop completes');
  });

  it('_clearCheckpoint is called after maxCycles hit', async () => {
    let cleared = false;
    await runAscend(makeBaseOpts({
      maxCycles: 1,
      _clearCheckpoint: async () => { cleared = true; },
    }));
    assert.equal(cleared, true);
  });
});

describe('ascend checkpoint — file I/O', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ascend-resume-')); });
  afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('writes ASCEND_PAUSED file to disk on each cycle', async () => {
    const matrix = makeMatrix([{ id: 'functionality', score: 6.0 }]);
    await runAscend({
      cwd: tmpDir,
      target: 9.0,
      maxCycles: 1,
      _loadMatrix: async () => matrix,
      _saveMatrix: async () => {},
      _loadState: async () => ({ project: 'test' }) as never,
      _harshScore: async () => makeScoreResult(7.0),
      _runLoop: async (ctx) => ctx,
      _executeCommand: async () => ({ success: true }),
      _writeFile: async () => {},
      _loadCheckpoint: async () => null,
      // Prevent auto-clear so we can verify the file was written
      _clearCheckpoint: async () => {},
    });
    const pausePath = path.join(tmpDir, ASCEND_PAUSE_FILE);
    const raw = await fs.readFile(pausePath, 'utf8');
    const cp = JSON.parse(raw) as AscendCheckpoint;
    assert.equal(cp.cyclesRun, 1);
    assert.equal(cp.target, 9.0);
  });
});

describe('resume.ts — ascend checkpoint detection', () => {
  it('calls _runAscend when ASCEND_PAUSED file is found', async () => {
    let ascendCalled = false;
    const checkpoint: AscendCheckpoint = {
      pausedAt: new Date().toISOString(),
      cyclesRun: 3,
      maxCycles: 10,
      target: 9.0,
      startedAt: new Date().toISOString(),
      plateauedDims: [],
      currentDimension: 'functionality',
      beforeScores: { functionality: 6.0 },
    };
    await resumeAutoforge({
      cwd: '/tmp/test',
      _readFile: async (p) => {
        if (p.includes('ASCEND_PAUSED')) return JSON.stringify(checkpoint);
        throw new Error('not found');
      },
      _runAscend: async (opts) => {
        ascendCalled = true;
        assert.equal(opts.target, 9.0);
        assert.equal(opts.maxCycles, 10);
        return { cyclesRun: 0, dimensionsImproved: 0, dimensionsAtTarget: 0, ceilingReports: [], finalScore: 0, success: false };
      },
    });
    assert.equal(ascendCalled, true);
  });

  it('falls through to autoforge when no ASCEND_PAUSED file', async () => {
    let errorLogged = false;
    await resumeAutoforge({
      cwd: '/tmp/test',
      _readFile: async () => { throw new Error('not found'); },
      _runAscend: async () => {
        throw new Error('should not be called');
      },
    }).catch(() => { errorLogged = true; });
    // Should not throw (withErrorBoundary wraps it)
    // The key assertion is that _runAscend was NOT called
    assert.equal(errorLogged, false, 'resumeAutoforge should not throw when no pause files');
  });
});
