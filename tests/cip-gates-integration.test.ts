import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { runHardenCrusade } from '../src/cli/commands/harden-crusade.js';
import { runFrontierCrusade } from '../src/cli/commands/crusade.js';
import { autoforge } from '../src/cli/commands/autoforge.js';
import { AutoforgeLoopState, type AutoforgeLoopContext } from '../src/core/autoforge-loop.js';
import type { CIPResult } from '../src/core/completion-integrity.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';

const tempRoots: string[] = [];

after(async () => {
  for (const root of tempRoots) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
});

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-cipint-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
  return root;
}

async function writeMatrix(root: string, dims: object[]): Promise<void> {
  await fs.writeFile(
    path.join(root, '.danteforge', 'compete', 'matrix.json'),
    JSON.stringify({ dimensions: dims, excludedDimensions: [] }, null, 2),
    'utf8',
  );
}

function makeDim(id: string, score = 5.0): MatrixDimension {
  return {
    id,
    label: id,
    scores: { self: score },
    outcomes: [],
    critical_path_files: [],
  } as unknown as MatrixDimension;
}

function blockedCIP(dimensionId: string): CIPResult {
  return {
    dimensionId,
    cipScore: 0,
    storedScore: 9.5,
    cipClass: 'claimed',
    blocksFrontierReached: true,
    gaps: ['no outcomes declared', 'no src implementation found'],
    stubsFound: 0,
    outcomesRun: 0,
    outcomesPassed: 0,
    capabilityTestPassed: null,
    irrelevantOutcomes: 0,
    evidenceAgeDays: null,
  };
}

function passingCIP(dimensionId: string): CIPResult {
  return {
    dimensionId,
    cipScore: 9.0,
    storedScore: 9.0,
    cipClass: 'verified',
    blocksFrontierReached: false,
    gaps: [],
    stubsFound: 0,
    outcomesRun: 3,
    outcomesPassed: 3,
    capabilityTestPassed: true,
    irrelevantOutcomes: 0,
    evidenceAgeDays: 1,
  };
}

// ── harden-crusade ────────────────────────────────────────────────────────────

describe('harden-crusade CIP gate (Rule 14)', () => {
  it('T1: CIP blocked → dimension never reaches FRONTIER_REACHED', async () => {
    const root = await makeWorkspace();
    const dim = makeDim('test_dim', 5.0);
    await writeMatrix(root, [dim]);
    const matrix: CompeteMatrix = { dimensions: [dim], excludedDimensions: [] } as CompeteMatrix;

    const result = await runHardenCrusade({
      goal: 'test',
      cwd: root,
      target: 9.0,
      parallel: 1,
      maxDimCycles: 1,
      loop: false,
      _loadState: null,
      _loadMatrix: async () => matrix,
      _writeFile: async () => {},
      _runAutoResearch: async () => {},
      _runOutcomesForDim: async () => {},
      _getScore: async () => 9.5,
      _runHardenForDim: async () => ({ allowed: true, scoreCap: 10, failedChecks: [] }),
      _cipCheck: async (dimId) => blockedCIP(dimId),
    });

    const dimResult = result.dimensions.find(d => d.dimensionId === 'test_dim');
    assert.ok(dimResult, 'dimension result must be present');
    assert.notEqual(dimResult?.status, 'FRONTIER_REACHED',
      'CIP block must prevent FRONTIER_REACHED (got: ' + dimResult?.status + ')');
  });

  it('T2: CIP passing → dimension reaches FRONTIER_REACHED', async () => {
    const root = await makeWorkspace();
    const dim = makeDim('test_dim', 5.0);
    await writeMatrix(root, [dim]);
    const matrix: CompeteMatrix = { dimensions: [dim], excludedDimensions: [] } as CompeteMatrix;

    const result = await runHardenCrusade({
      goal: 'test',
      cwd: root,
      target: 9.0,
      parallel: 1,
      maxDimCycles: 2,
      loop: false,
      _loadState: null,
      _loadMatrix: async () => matrix,
      _writeFile: async () => {},
      _runAutoResearch: async () => {},
      _runOutcomesForDim: async () => {},
      _getScore: async () => 9.5,
      _runHardenForDim: async () => ({ allowed: true, scoreCap: 10, failedChecks: [] }),
      _cipCheck: async (dimId) => passingCIP(dimId),
    });

    const dimResult = result.dimensions.find(d => d.dimensionId === 'test_dim');
    assert.ok(dimResult, 'dimension result must be present');
    assert.equal(dimResult?.status, 'FRONTIER_REACHED',
      'CIP pass must allow FRONTIER_REACHED');
  });
});

// ── frontier-crusade ──────────────────────────────────────────────────────────

describe('frontier-crusade CIP gate (Rule 14)', () => {
  it('T3: CIP blocked → dimension never reaches FRONTIER_REACHED', async () => {
    const root = await makeWorkspace();
    const dim = makeDim('test_dim', 5.0);
    await writeMatrix(root, [dim]);
    const matrix: CompeteMatrix = { dimensions: [dim], excludedDimensions: [] } as CompeteMatrix;

    const result = await runFrontierCrusade({
      goal: 'test',
      cwd: root,
      target: 9.0,
      maxDimCycles: 1,
      loop: false,
      _loadState: null,
      _checkAutonomyRules: null,
      verifyCap: false,
      skipLLMCheck: true,
      _loadMatrix: async () => matrix,
      _writeFile: async () => {},
      _runInferno: async () => {},
      _getScore: async () => 9.5,
      _runValidate: async () => {},
      _runEvidenceRescore: async () => {},
      _createTimeMachineCommit: null,
      _cipCheck: async (dimId) => blockedCIP(dimId),
    });

    const dimResult = result.dimensions.find(d => d.dimensionId === 'test_dim');
    assert.ok(dimResult, 'dimension result must be present');
    assert.notEqual(dimResult?.status, 'FRONTIER_REACHED',
      'CIP block must prevent FRONTIER_REACHED (got: ' + dimResult?.status + ')');
  });

  it('T4: CIP passing → dimension reaches FRONTIER_REACHED', async () => {
    const root = await makeWorkspace();
    const dim = makeDim('test_dim', 5.0);
    await writeMatrix(root, [dim]);
    const matrix: CompeteMatrix = { dimensions: [dim], excludedDimensions: [] } as CompeteMatrix;

    const result = await runFrontierCrusade({
      goal: 'test',
      cwd: root,
      target: 9.0,
      maxDimCycles: 2,
      loop: false,
      _loadState: null,
      _checkAutonomyRules: null,
      verifyCap: false,
      skipLLMCheck: true,
      _loadMatrix: async () => matrix,
      _writeFile: async () => {},
      _runInferno: async () => {},
      _getScore: async () => 9.5,
      _runValidate: async () => {},
      _runEvidenceRescore: async () => {},
      _createTimeMachineCommit: null,
      _cipCheck: async (dimId) => passingCIP(dimId),
    });

    const dimResult = result.dimensions.find(d => d.dimensionId === 'test_dim');
    assert.ok(dimResult, 'dimension result must be present');
    assert.equal(dimResult?.status, 'FRONTIER_REACHED',
      'CIP pass must allow FRONTIER_REACHED');
  });
});

// ── autoforge CIP retry loop ──────────────────────────────────────────────────

describe('autoforge CIP retry loop (Rule 14)', () => {
  it('T5: loop re-enters when CIP is blocked, exits clean when CIP clears', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [makeDim('test_dim', 5.0)]);

    let loopCalls = 0;
    const trackLoop = async (ctx: AutoforgeLoopContext): Promise<AutoforgeLoopContext> => {
      loopCalls++;
      return { ...ctx, loopState: AutoforgeLoopState.COMPLETE };
    };

    // First sweep: blocked. Second sweep: clear.
    const sweepResults: Array<CIPResult[]> = [[blockedCIP('test_dim')], []];
    let sweepIdx = 0;
    const trackSweep = async (_cwd: string): Promise<CIPResult[]> => sweepResults[sweepIdx++] ?? [];

    await autoforge('test goal', {
      auto: true,
      cwd: root,
      skipCIP: false,
      _computeRetroScore: false,
      _runLoop: trackLoop,
      _cipSweep: trackSweep,
    });

    assert.equal(loopCalls, 2,
      'loop must run twice: once for the main pass, once for the CIP retry');
    assert.equal(sweepIdx, 2,
      'CIP sweep must be called twice: blocked on attempt 1, clear on attempt 2');
  });
});
