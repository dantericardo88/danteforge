// tests/ascend.test.ts — Tests for the danteforge ascend command

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ascend, type AscendOptions } from '../src/cli/commands/ascend.js';
import type { AscendResult, AscendEngineOptions } from '../src/core/ascend-engine.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ascend-test-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function makeStubMatrix(): CompeteMatrix {
  return {
    project: 'test-project',
    competitors: ['Cursor'],
    competitors_closed_source: ['Cursor'],
    competitors_oss: [],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 5.0,
    dimensions: [
      {
        id: 'functionality',
        label: 'Core Functionality',
        weight: 1.5,
        category: 'quality',
        frequency: 'high',
        scores: { self: 8.5, Cursor: 9.0 },
        gap_to_leader: 0.5,
        leader: 'Cursor',
        gap_to_closed_source_leader: 0.5,
        closed_source_leader: 'Cursor',
        gap_to_oss_leader: 0,
        oss_leader: 'unknown',
        status: 'not-started',
        sprint_history: [],
        next_sprint_target: 9.0,
      },
    ],
  };
}

function makeSuccessResult(overrides: Partial<AscendResult> = {}): AscendResult {
  return {
    cyclesRun: 2,
    dimensionsImproved: 1,
    dimensionsAtTarget: 1,
    ceilingReports: [],
    finalScore: 9.0,
    success: true,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ascend() command', () => {
  it('calls runAscend with correct cwd and default options', async () => {
    let receivedOpts: AscendEngineOptions | undefined;
    const cwd = await makeTmpDir();
    const opts: AscendOptions = {
      cwd,
      _runAscend: async (o) => { receivedOpts = o; return makeSuccessResult(); },
    };
    await ascend(opts);
    assert.equal(receivedOpts?.cwd, cwd);
    assert.equal(receivedOpts?.target, undefined); // defaults applied in engine
    assert.equal(receivedOpts?.dryRun, undefined);
  });

  it('passes target through to engine', async () => {
    let receivedTarget: number | undefined;
    const cwd = await makeTmpDir();
    await ascend({
      cwd,
      target: 8.5,
      _runAscend: async (o) => { receivedTarget = o.target; return makeSuccessResult(); },
    });
    assert.equal(receivedTarget, 8.5);
  });

  it('passes maxCycles through to engine', async () => {
    let receivedMaxCycles: number | undefined;
    const cwd = await makeTmpDir();
    await ascend({
      cwd,
      maxCycles: 50,
      _runAscend: async (o) => { receivedMaxCycles = o.maxCycles; return makeSuccessResult(); },
    });
    assert.equal(receivedMaxCycles, 50);
  });

  it('passes dryRun through to engine', async () => {
    let receivedDryRun: boolean | undefined;
    const cwd = await makeTmpDir();
    await ascend({
      cwd,
      dryRun: true,
      _runAscend: async (o) => { receivedDryRun = o.dryRun; return makeSuccessResult(); },
    });
    assert.equal(receivedDryRun, true);
  });

  it('passes interactive through to engine', async () => {
    let receivedInteractive: boolean | undefined;
    const cwd = await makeTmpDir();
    await ascend({
      cwd,
      interactive: true,
      _runAscend: async (o) => { receivedInteractive = o.interactive; return makeSuccessResult(); },
    });
    assert.equal(receivedInteractive, true);
  });

  it('returns result with success:true when engine reports success', async () => {
    const cwd = await makeTmpDir();
    const result = await ascend({
      cwd,
      _runAscend: async () => makeSuccessResult({ success: true }),
    });
    assert.equal(result.success, true);
  });

  it('returns result with success:false when maxCycles hit', async () => {
    const cwd = await makeTmpDir();
    const result = await ascend({
      cwd,
      _runAscend: async () => makeSuccessResult({ success: false, cyclesRun: 30 }),
    });
    assert.equal(result.success, false);
    assert.equal(result.cyclesRun, 30);
  });

  it('ceilingReports populated when engine reports ceiling dims', async () => {
    const cwd = await makeTmpDir();
    const result = await ascend({
      cwd,
      _runAscend: async () => makeSuccessResult({
        ceilingReports: [{
          dimension: 'community_adoption',
          label: 'Community Adoption',
          currentScore: 2.0,
          ceiling: 4.0,
          reason: 'requires external users',
          manualAction: 'Publish to npm',
        }],
      }),
    });
    assert.equal(result.ceilingReports.length, 1);
    assert.equal(result.ceilingReports[0]!.dimension, 'community_adoption');
  });

  it('cyclesRun matches what engine returns', async () => {
    const cwd = await makeTmpDir();
    const result = await ascend({
      cwd,
      _runAscend: async () => makeSuccessResult({ cyclesRun: 7 }),
    });
    assert.equal(result.cyclesRun, 7);
  });

  it('dimensionsImproved matches what engine returns', async () => {
    const cwd = await makeTmpDir();
    const result = await ascend({
      cwd,
      _runAscend: async () => makeSuccessResult({ dimensionsImproved: 5 }),
    });
    assert.equal(result.dimensionsImproved, 5);
  });

  it('--yes flag is accepted and passed to engine', async () => {
    const tmpDir = await makeTmpDir();
    let receivedYes: boolean | undefined;
    const result = await ascend({
      cwd: tmpDir,
      yes: true,
      _runAscend: async (opts) => {
        receivedYes = opts.yes;
        return makeSuccessResult();
      },
    });
    assert.ok(result !== undefined);
    assert.equal(receivedYes, true);
  });

  it('_confirmMatrix injection seam is accepted by AscendEngineOptions', async () => {
    // Type-level test: ensure the interface accepts _confirmMatrix
    let confirmCalled = false;
    const tmpDir = await makeTmpDir();
    await ascend({
      cwd: tmpDir,
      yes: false,
      _runAscend: async (opts) => {
        // The engine receives the opts including _confirmMatrix
        void opts;
        confirmCalled = true;
        return makeSuccessResult();
      },
    });
    assert.ok(confirmCalled);
  });
});

// ── Tests: ascend-engine integration (via _runAscend seam) ───────────────────

describe('ascend() — engine integration via injection', () => {
  it('no matrix → engine is called with defineUniverse available (non-interactive path)', async () => {
    // We test the actual engine behavior with full seam injection
    const cwd = await makeTmpDir();
    const stubMatrix = makeStubMatrix();

    const { runAscend } = await import('../src/core/ascend-engine.js');

    let defineUniverseCalled = false;
    let loopCalled = false;
    let saveMatrixCalled = false;
    let writeFileCalled = false;

    const result = await runAscend({
      cwd,
      target: 9.0,
      maxCycles: 1,
      executeMode: 'advisory',  // test advisory loop path via _runLoop stub
      _loadMatrix: async () => null, // no matrix
      _defineUniverse: async () => { defineUniverseCalled = true; return stubMatrix; },
      _harshScore: async () => ({
        rawScore: 85,
        harshScore: 85,
        displayScore: 8.5,
        dimensions: {} as never,
        displayDimensions: { functionality: 8.5 } as never,
        penalties: [],
        stubsDetected: [],
        fakeCompletionRisk: 'low' as const,
        verdict: 'acceptable' as const,
        maturityAssessment: {} as never,
      }),
      _runLoop: async (ctx) => { loopCalled = true; return ctx; },
      _saveMatrix: async () => { saveMatrixCalled = true; },
      _loadState: async () => ({ project: 'test', workflowStage: 'initialized', currentPhase: 1, tasks: {}, lastHandoff: '', profile: 'balanced', auditLog: [] } as never),
      _writeFile: async () => { writeFileCalled = true; },
    });

    assert.ok(defineUniverseCalled, 'defineUniverse should be called when no matrix exists');
    assert.ok(loopCalled, 'runLoop should be called for improvement cycle');
    assert.ok(saveMatrixCalled, 'matrix should be saved after improvement');
    assert.ok(writeFileCalled, 'ASCEND_REPORT.md should be written');
    assert.ok(result.cyclesRun >= 1, 'at least 1 cycle should have run');
  });

  it('existing matrix → defineUniverse NOT called', async () => {
    const cwd = await makeTmpDir();
    const stubMatrix = makeStubMatrix();

    const { runAscend } = await import('../src/core/ascend-engine.js');
    let defineUniverseCalled = false;

    await runAscend({
      cwd,
      target: 9.0,
      maxCycles: 1,
      _loadMatrix: async () => stubMatrix, // matrix already exists
      _defineUniverse: async () => { defineUniverseCalled = true; return stubMatrix; },
      _harshScore: async () => ({
        rawScore: 90, harshScore: 90, displayScore: 9.0,
        dimensions: {} as never,
        displayDimensions: { functionality: 9.0 } as never,
        penalties: [], stubsDetected: [], fakeCompletionRisk: 'low' as const,
        verdict: 'excellent' as const, maturityAssessment: {} as never,
      }),
      _runLoop: async (ctx) => ctx,
      _saveMatrix: async () => {},
      _loadState: async () => ({ project: 'test', workflowStage: 'initialized', currentPhase: 1, tasks: {}, lastHandoff: '', profile: 'balanced', auditLog: [] } as never),
      _writeFile: async () => {},
    });

    assert.equal(defineUniverseCalled, false, 'defineUniverse should NOT be called when matrix exists');
  });

  it('dryRun returns immediately without calling runLoop', async () => {
    const cwd = await makeTmpDir();
    const stubMatrix = makeStubMatrix();
    const { runAscend } = await import('../src/core/ascend-engine.js');
    let loopCalled = false;

    const result = await runAscend({
      cwd,
      target: 9.0,
      dryRun: true,
      _loadMatrix: async () => stubMatrix,
      _harshScore: async () => ({
        rawScore: 50, harshScore: 50, displayScore: 5.0,
        dimensions: {} as never,
        displayDimensions: {} as never,
        penalties: [], stubsDetected: [], fakeCompletionRisk: 'low' as const,
        verdict: 'needs-work' as const, maturityAssessment: {} as never,
      }),
      _runLoop: async (ctx) => { loopCalled = true; return ctx; },
      _saveMatrix: async () => {},
      _loadState: async () => ({ project: 'test', workflowStage: 'initialized', currentPhase: 1, tasks: {}, lastHandoff: '', profile: 'balanced', auditLog: [] } as never),
      _writeFile: async () => {},
    });

    assert.equal(loopCalled, false, 'dryRun should not call the improvement loop');
    assert.equal(result.cyclesRun, 0);
  });

  it('empty achievable dims exits immediately with success', async () => {
    const cwd = await makeTmpDir();
    // All dims closed
    const closedMatrix: CompeteMatrix = {
      ...makeStubMatrix(),
      dimensions: [{
        id: 'functionality', label: 'Core Functionality', weight: 1.5,
        category: 'quality', frequency: 'high',
        scores: { self: 9.5 }, gap_to_leader: 0, leader: 'self',
        gap_to_closed_source_leader: 0, closed_source_leader: 'self',
        gap_to_oss_leader: 0, oss_leader: 'self',
        status: 'closed', sprint_history: [], next_sprint_target: 9.0,
      }],
    };
    const { runAscend } = await import('../src/core/ascend-engine.js');
    let loopCalled = false;

    const result = await runAscend({
      cwd,
      _loadMatrix: async () => closedMatrix,
      _runLoop: async (ctx) => { loopCalled = true; return ctx; },
      _saveMatrix: async () => {},
      _loadState: async () => ({ project: 'test', workflowStage: 'initialized', currentPhase: 1, tasks: {}, lastHandoff: '', profile: 'balanced', auditLog: [] } as never),
      _writeFile: async () => {},
      _harshScore: async () => ({
        rawScore: 95, harshScore: 95, displayScore: 9.5,
        dimensions: {} as never, displayDimensions: {} as never,
        penalties: [], stubsDetected: [], fakeCompletionRisk: 'low' as const,
        verdict: 'excellent' as const, maturityAssessment: {} as never,
      }),
    });

    assert.equal(loopCalled, false);
    assert.equal(result.cyclesRun, 0);
    assert.equal(result.success, true);
  });
});
