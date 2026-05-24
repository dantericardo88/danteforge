import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { runDaemon, type DaemonPassResult, type DaemonStrategy } from '../src/cli/commands/daemon.js';
import type { CIPResult, CIPOptions } from '../src/core/completion-integrity.js';

const tempRoots: string[] = [];

after(async () => {
  for (const root of tempRoots) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
});

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-cipgate-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
  return root;
}

async function writeMatrix(root: string, dims: object[], excluded: string[] = []): Promise<void> {
  await fs.writeFile(
    path.join(root, '.danteforge', 'compete', 'matrix.json'),
    JSON.stringify({ dimensions: dims, excludedDimensions: excluded }, null, 2),
    'utf8',
  );
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

function makePassDriver(scoreAfterPass: number) {
  return async (strategy: DaemonStrategy, _cwd: string): Promise<DaemonPassResult> => ({
    strategy,
    pass: 1,
    scoreBeforePass: 5.0,
    scoreAfterPass,
    durationMs: 50,
    outcome: 'improved',
  });
}

// _now that lets one full pass complete, then jumps past the time limit
function makeNowDriver(timeLimitMs: number) {
  const start = Date.now();
  let calls = 0;
  return (): number => {
    calls++;
    // calls 1-2 are within the time limit (start + elapsed check for pass 1)
    return calls <= 2 ? start : start + timeLimitMs + 1000;
  };
}

describe('daemon CIP gate (Rule 14)', () => {
  it('T1: CIP-blocked dims prevent target-reached — daemon exits via time limit', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [
      { id: 'test_dim', label: 'Test', scores: { self: 9.5 }, outcomes: [], critical_path_files: [] },
    ]);

    const timeLimitMs = 60_000;
    const result = await runDaemon({
      cwd: root,
      target: 9.0,
      timeLimitMinutes: 1,
      intervalMinutes: 0,
      intelCycleEvery: 0,
      _runPass: makePassDriver(9.5),
      _now: makeNowDriver(timeLimitMs),
      _cipCheck: async (dimId: string, _opts: CIPOptions) => blockedCIP(dimId),
    });

    assert.equal(result.targetReached, false, 'CIP-blocked: targetReached must be false');
    assert.equal(result.timeLimitReached, true, 'daemon must exit via time limit, not CIP-pass');
  });

  it('T2: CIP-passing dims allow target-reached — daemon exits immediately', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [
      { id: 'test_dim', label: 'Test', scores: { self: 9.0 }, outcomes: [], critical_path_files: [] },
    ]);

    const result = await runDaemon({
      cwd: root,
      target: 9.0,
      timeLimitMinutes: 60,
      intervalMinutes: 0,
      intelCycleEvery: 0,
      _runPass: makePassDriver(9.5),
      _now: () => Date.now(),
      _cipCheck: async (dimId: string, _opts: CIPOptions) => passingCIP(dimId),
    });

    assert.equal(result.targetReached, true, 'CIP-passing: targetReached must be true');
    assert.equal(result.reason, 'target-reached');
  });

  it('T3: CIP is a no-op when all dimensions are excluded — target-reached is allowed', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [
      { id: 'excl_dim', label: 'Excluded', scores: { self: 9.5 }, outcomes: [], critical_path_files: [] },
    ], ['excl_dim']);

    let cipCalled = false;
    const result = await runDaemon({
      cwd: root,
      target: 9.0,
      timeLimitMinutes: 60,
      intervalMinutes: 0,
      intelCycleEvery: 0,
      _runPass: makePassDriver(9.5),
      _now: () => Date.now(),
      _cipCheck: async (dimId: string, _opts: CIPOptions) => {
        cipCalled = true;
        return blockedCIP(dimId);
      },
    });

    assert.equal(cipCalled, false, '_cipCheck must not be called when no active dims');
    assert.equal(result.targetReached, true, 'no active dims: targetReached must be true');
  });
});
