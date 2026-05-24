// Crusade command — tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCrusade } from '../src/cli/commands/crusade.js';
import type { OssPassResult, ForgeWaveResult } from '../src/cli/commands/crusade.js';

// ── Fixture builders ──────────────────────────────────────────────────────────

function makeScoreSeq(scores: number[]) {
  let idx = 0;
  return async (_dim: string, _cwd: string): Promise<number> => scores[Math.min(idx++, scores.length - 1)] ?? 0;
}

function makeOssPass(patternsPerCall: number): (_domain: string, _cwd: string) => Promise<OssPassResult> {
  return async (domain) => ({ patternsFound: patternsPerCall, domain });
}

function makeForgeWave(success: boolean): (_goal: string, _cwd: string) => Promise<ForgeWaveResult> {
  return async () => ({ success });
}

const BASE_OPTS = {
  cwd: process.cwd(),
  _now: () => '2026-01-01T00:00:00.000Z',
  _writeFile: async () => { /* no-op */ },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runCrusade', () => {
  it('returns CRUSADE_COMPLETE immediately if score already meets target', async () => {
    const result = await runCrusade({
      ...BASE_OPTS,
      goal: 'security hardening',
      target: 9.0,
      _getScore: makeScoreSeq([9.5]),
      _runOssPass: makeOssPass(5),
      _runForgeWave: makeForgeWave(true),
    });

    assert.equal(result.status, 'CRUSADE_COMPLETE');
    assert.equal(result.cyclesRun, 0);
    assert.equal(result.finalScore, 9.5);
  });

  it('runs cycles until target reached', async () => {
    // Start at 7.0, hit 9.0 after 2 cycles (score returned after each forge wave)
    const result = await runCrusade({
      ...BASE_OPTS,
      goal: 'security hardening',
      target: 9.0,
      maxCycles: 10,
      maxOssPasses: 2,
      _getScore: makeScoreSeq([7.0, 8.0, 9.1]),
      _runOssPass: makeOssPass(5),
      _runForgeWave: makeForgeWave(true),
    });

    assert.equal(result.status, 'CRUSADE_COMPLETE');
    assert.ok(result.cyclesRun >= 1);
    assert.ok(result.finalScore >= 9.0);
  });

  it('returns CRUSADE_MAX_CYCLES when max cycles exhausted before target', async () => {
    const result = await runCrusade({
      ...BASE_OPTS,
      goal: 'security hardening',
      target: 9.5,
      maxCycles: 2,
      maxOssPasses: 1,
      _getScore: makeScoreSeq([7.0, 7.5, 8.0, 8.5]),
      _runOssPass: makeOssPass(5),
      _runForgeWave: makeForgeWave(true),
    });

    assert.equal(result.status, 'CRUSADE_MAX_CYCLES');
    assert.equal(result.cyclesRun, 2);
    assert.ok(result.finalScore < 9.5);
  });

  it('continues running even when forge wave fails', async () => {
    const result = await runCrusade({
      ...BASE_OPTS,
      goal: 'security hardening',
      target: 9.0,
      maxCycles: 3,
      maxOssPasses: 1,
      _getScore: makeScoreSeq([7.0, 7.0, 7.0, 9.1]),
      _runOssPass: makeOssPass(5),
      _runForgeWave: async () => ({ success: false, error: 'forge failed' }),
    });

    // Should still complete cycles and eventually complete
    assert.ok(result.cyclesRun >= 1);
    assert.ok(result.cycles.every(c => !c.forgeWaveSuccess));
  });

  it('stops OSS harvest at plateau (< 3 new patterns)', async () => {
    let ossCallCount = 0;
    const result = await runCrusade({
      ...BASE_OPTS,
      goal: 'security hardening',
      target: 9.0,
      maxCycles: 1,
      maxOssPasses: 10,
      _getScore: makeScoreSeq([7.0, 9.1]),
      _runOssPass: async (domain) => {
        ossCallCount++;
        return { patternsFound: ossCallCount === 1 ? 10 : 1, domain };
      },
      _runForgeWave: makeForgeWave(true),
    });

    // Should stop well before 10 passes due to plateau at 1 new pattern
    assert.ok(result.cycles[0].ossPassesRun < 10);
    assert.equal(result.status, 'CRUSADE_COMPLETE');
  });

  it('accumulates total patterns harvested across cycles', async () => {
    const result = await runCrusade({
      ...BASE_OPTS,
      goal: 'security hardening',
      target: 8.5,
      maxCycles: 2,
      maxOssPasses: 2,
      _getScore: makeScoreSeq([7.0, 8.0, 8.6]),
      _runOssPass: makeOssPass(10),
      _runForgeWave: makeForgeWave(true),
    });

    assert.ok(result.totalPatternsHarvested > 0);
  });

  it('includes cycle reports with score deltas', async () => {
    const result = await runCrusade({
      ...BASE_OPTS,
      goal: 'security hardening',
      target: 9.0,
      maxCycles: 2,
      maxOssPasses: 1,
      _getScore: makeScoreSeq([7.0, 8.0, 9.1]),
      _runOssPass: makeOssPass(5),
      _runForgeWave: makeForgeWave(true),
    });

    assert.ok(result.cycles.length >= 1);
    const firstCycle = result.cycles[0];
    assert.ok(firstCycle !== undefined);
    assert.equal(firstCycle.scoreBefore, 7.0);
    assert.equal(firstCycle.scoreAfter, 8.0);
    assert.equal(firstCycle.scoreDelta, 1.0);
  });
});
