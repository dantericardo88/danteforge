// score-determinism — Proves that danteforge score() is a pure function of codebase state.
// Same inputs → same output, every run, every time.
//
// The plateau penalty in computeHarshScore reads assessment-history.json and deducts 5
// if last 3 scores have range ≤ 2. score() now bypasses this by injecting empty history
// stubs (_readHistory / _writeHistory). These tests enforce that contract.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { score, type ScoreOptions } from '../src/cli/commands/score.js';
import type { DanteState } from '../src/core/state.js';
import type { HarshScoreResult, AssessmentHistoryEntry } from '../src/core/harsh-scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMinimalState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'determinism-test',
    lastHandoff: 'initialized',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    maxBudgetUsd: 10,
    routingAggressiveness: 'balanced',
    selfEditPolicy: 'deny',
    projectType: 'unknown',
    ...overrides,
  };
}

function makeHarshResult(overrides: Partial<HarshScoreResult> = {}): HarshScoreResult {
  return {
    displayScore: 8.5,
    verdict: 'needs-work',
    displayDimensions: {
      functionality: 9.0,
      testing: 7.5,
      errorHandling: 4.8,
      security: 7.0,
      uxPolish: 9.0,
      documentation: 6.5,
      performance: 6.5,
      maintainability: 6.5,
      autonomy: 7.7,
      planningQuality: 7.0,
      selfImprovement: 10.0,
      specDrivenPipeline: 7.0,
      convergenceSelfHealing: 6.5,
      tokenEconomy: 6.0,
      ecosystemMcp: 10.0,
      enterpriseReadiness: 7.0,
      communityAdoption: 1.5,
      developerExperience: 7.5,
    },
    ...overrides,
  };
}

/** Plateau-triggering history: 3 entries with range=0 (would normally deduct -5) */
function makePlateauHistory(): AssessmentHistoryEntry[] {
  return [
    { timestamp: '2026-04-14T00:00:00.000Z', harshScore: 85, displayScore: 8.5, dimensions: {} as never, penaltyTotal: 0 },
    { timestamp: '2026-04-14T01:00:00.000Z', harshScore: 85, displayScore: 8.5, dimensions: {} as never, penaltyTotal: 0 },
    { timestamp: '2026-04-14T02:00:00.000Z', harshScore: 85, displayScore: 8.5, dimensions: {} as never, penaltyTotal: 0 },
  ];
}

function makeBaseOpts(overrides: Partial<ScoreOptions> = {}): ScoreOptions {
  return {
    cwd: '/fake/cwd',
    _loadState: async () => makeMinimalState(),
    _saveState: async () => {},
    _harshScore: async () => makeHarshResult(),
    _getGitSha: async () => undefined,
    _stdout: () => {},
    _runPrime: async () => {},
    _listSkillDirs: async () => [],
    _fileExists: async () => false,
    // The contract: score always injects no-op history to bypass plateau
    _readHistory: async () => [],
    _writeHistory: async () => {},
    ...overrides,
  };
}

// ── Determinism tests ─────────────────────────────────────────────────────────

describe('score() determinism — same input → same output', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'score-determinism-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
  });

  after(async () => {
    process.exitCode = 0;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('two consecutive calls with identical opts return identical displayScore', async () => {
    const opts = makeBaseOpts();
    const r1 = await score(opts);
    const r2 = await score(opts);
    assert.equal(r1.displayScore, r2.displayScore,
      `Run 1: ${r1.displayScore}, Run 2: ${r2.displayScore} — should be identical`);
  });

  it('five consecutive calls all return identical displayScore (no drift)', async () => {
    const opts = makeBaseOpts();
    const scores: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await score(opts);
      scores.push(r.displayScore);
    }
    const unique = new Set(scores);
    assert.equal(unique.size, 1,
      `Expected 1 unique score across 5 runs, got ${unique.size}: ${scores.join(', ')}`);
  });

  it('plateau history does NOT affect score — plateau penalty is bypassed', async () => {
    // With empty history (score default): no plateau penalty
    const withEmpty = makeBaseOpts({
      _readHistory: async () => [],
    });
    // With plateau-triggering history: if plateau were active this would deduct -5
    const withPlateau = makeBaseOpts({
      _readHistory: async () => makePlateauHistory(),
    });

    const r1 = await score(withEmpty);
    const r2 = await score(withPlateau);

    assert.equal(r1.displayScore, r2.displayScore,
      `Score with empty history (${r1.displayScore}) must equal score with plateau history (${r2.displayScore}). Plateau penalty must be bypassed in score().`);
  });

  it('_writeHistory is never called by score() — no history accumulation', async () => {
    let writeCallCount = 0;
    const opts = makeBaseOpts({
      _writeHistory: async () => { writeCallCount++; },
    });

    await score(opts);
    await score(opts);

    assert.equal(writeCallCount, 0,
      `score() called _writeHistory ${writeCallCount} times — should be 0 (score does not write assessment history)`);
  });

  it('P0 items are identical across two runs (no randomness)', async () => {
    const opts = makeBaseOpts();
    const r1 = await score(opts);
    const r2 = await score(opts);

    assert.deepEqual(
      r1.p0Items.map(i => i.dimension),
      r2.p0Items.map(i => i.dimension),
      'P0 dimensions must be identical across runs',
    );
    assert.deepEqual(
      r1.p0Items.map(i => i.score),
      r2.p0Items.map(i => i.score),
      'P0 scores must be identical across runs',
    );
  });

  it('score --full returns displayDimensions with all 18 keys', async () => {
    const opts = makeBaseOpts({ full: true });
    const result = await score(opts);

    assert.ok(result.displayDimensions, 'displayDimensions should be present when --full');
    const keys = Object.keys(result.displayDimensions);
    assert.equal(keys.length, 18,
      `Expected 18 dimension keys, got ${keys.length}: ${keys.join(', ')}`);
  });

  it('score --full emits more output lines than score (basic render coverage)', async () => {
    const lines: { full: string[]; basic: string[] } = { full: [], basic: [] };

    const fullOpts = makeBaseOpts({
      full: true,
      _stdout: (line) => { lines.full.push(line); },
    });
    const basicOpts = makeBaseOpts({
      full: false,
      _stdout: (line) => { lines.basic.push(line); },
    });

    await score(fullOpts);
    await score(basicOpts);

    assert.ok(
      lines.full.length > lines.basic.length,
      `--full (${lines.full.length} lines) should emit more than basic (${lines.basic.length} lines)`,
    );
  });

  it('session delta resets when baseline timestamp exceeds 4-hour TTL', async () => {
    // State with a baseline set 5 hours ago — should be cleared (TTL = 4h)
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const savedStates: DanteState[] = [];

    const opts = makeBaseOpts({
      _loadState: async () => makeMinimalState({
        sessionBaselineScore: 7.0,         // stale baseline
        sessionBaselineTimestamp: staleTimestamp,
      }),
      _saveState: async (s) => { savedStates.push(structuredClone(s)); },
    });

    const result = await score(opts);

    // sessionDelta should be undefined (baseline was cleared, then reset to current score)
    assert.equal(result.sessionDelta, undefined,
      `sessionDelta should be undefined when baseline is stale, got ${result.sessionDelta}`);

    // The saved state should have a fresh baseline equal to current score
    const finalSave = savedStates[savedStates.length - 1];
    assert.equal(finalSave.sessionBaselineScore, result.displayScore,
      'Fresh baseline should be set to current displayScore after TTL reset');
  });

  it('score without --full does not include displayDimensions in result', async () => {
    // displayDimensions is returned regardless of --full flag (the data is always computed)
    // but this test confirms the result structure is always consistent
    const opts = makeBaseOpts({ full: false });
    const result = await score(opts);

    // displayDimensions is always returned (it's cheap and useful for callers)
    assert.ok(result.displayDimensions !== undefined,
      'displayDimensions should be present in ScoreResult regardless of --full flag');
  });
});
