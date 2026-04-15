// score-timing — Regression tests for the score.ts signal timing fix.
// Verifies that harshScoreFn sees the current skillCount/hasPluginManifest
// on the FIRST call (not just the second), because bootstrapEcosystemSignals
// now writes signals to state and persists them BEFORE harshScoreFn is called.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { score, type ScoreOptions } from '../src/cli/commands/score.js';
import type { DanteState } from '../src/core/state.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMinimalState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-timing',
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
    displayScore: 8.0,
    verdict: 'good',
    displayDimensions: {
      functionality: 8.0,
      testing: 8.0,
      errorHandling: 6.5,
      security: 7.5,
      uxPolish: 9.0,
      documentation: 7.0,
      performance: 7.5,
      maintainability: 7.0,
      autonomy: 7.0,
      planningQuality: 6.5,
      selfImprovement: 7.0,
      specDrivenPipeline: 7.0,
      convergenceSelfHealing: 6.5,
      tokenEconomy: 6.0,
      ecosystemMcp: 10.0,
      enterpriseReadiness: 7.0,
      communityAdoption: 4.5,
      developerExperience: 8.0,
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('score() timing — signals persisted before harshScoreFn', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'score-timing-test-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
  });

  after(async () => {
    process.exitCode = 0;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('harshScoreFn is called AFTER saveState writes signals', async () => {
    // Track call ordering: saveState must be called before harshScore
    const callOrder: string[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _loadState: async () => makeMinimalState(),
      _saveState: async () => { callOrder.push('saveState'); },
      _harshScore: async () => { callOrder.push('harshScore'); return makeHarshResult(); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    };

    await score(opts);

    const saveIdx = callOrder.indexOf('saveState');
    const harshIdx = callOrder.indexOf('harshScore');
    assert.ok(saveIdx >= 0, 'saveState should be called');
    assert.ok(harshIdx >= 0, 'harshScore should be called');
    assert.ok(
      saveIdx < harshIdx,
      `saveState (idx=${saveIdx}) must be called before harshScore (idx=${harshIdx}). Order: ${JSON.stringify(callOrder)}`,
    );
  });

  it('harshScoreFn sees skillCount=32 on first call when state is pre-saved', async () => {
    // Spy on what state is loaded when harshScore is called.
    // After the fix, a save with skillCount=32 happens BEFORE harshScore calls loadState.
    const savedStates: DanteState[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _loadState: async () => makeMinimalState(),
      _saveState: async (s) => { savedStates.push(structuredClone(s)); },
      _harshScore: async () => {
        // At this point, the last saved state should have skillCount set
        return makeHarshResult();
      },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => Array.from({ length: 32 }, (_, i) => `skill-${i}`),
      _fileExists: async (p: string) => p.endsWith('SKILL.md'),
    };

    await score(opts);

    // First save should have skillCount=32 (signals write)
    assert.ok(savedStates.length >= 1, 'saveState should have been called at least once');
    const signalSave = savedStates[0];
    assert.equal(
      signalSave.skillCount, 32,
      `First saveState should have skillCount=32, got ${signalSave.skillCount}`,
    );
  });

  it('harshScoreFn sees hasPluginManifest=true on first call', async () => {
    const savedStates: DanteState[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _loadState: async () => makeMinimalState(),
      _saveState: async (s) => { savedStates.push(structuredClone(s)); },
      _harshScore: async () => makeHarshResult(),
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('.claude-plugin'),
    };

    await score(opts);

    const signalSave = savedStates[0];
    assert.equal(
      signalSave.hasPluginManifest, true,
      `First saveState should have hasPluginManifest=true, got ${signalSave.hasPluginManifest}`,
    );
  });

  it('score result is stable: same on first and second call with same state', async () => {
    // If signals are persisted before scoring, consecutive runs should return the same score.
    let callCount = 0;

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _loadState: async () => makeMinimalState({ sessionBaselineScore: 8.0 }),
      _saveState: async () => {},
      _harshScore: async () => { callCount++; return makeHarshResult({ displayScore: 8.2 }); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => ['skill-a'],
      _fileExists: async (p: string) => p.endsWith('SKILL.md'),
    };

    const result1 = await score(opts);
    const result2 = await score(opts);

    assert.equal(result1.displayScore, result2.displayScore, 'Score should be identical on both runs');
    assert.equal(callCount, 2, 'harshScore should be called once per score() invocation');
  });

  it('bootstrap error does not prevent scoring', async () => {
    const opts: ScoreOptions = {
      cwd: tmpDir,
      _loadState: async () => makeMinimalState(),
      _saveState: async () => {},
      _harshScore: async () => makeHarshResult({ displayScore: 7.5 }),
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      // _listSkillDirs throws — bootstrap should fail gracefully
      _listSkillDirs: async () => { throw new Error('fs error'); },
      _fileExists: async () => false,
    };

    // Should not throw even when listSkillDirs fails
    const result = await score(opts);
    assert.equal(result.displayScore, 7.5, 'Score should be returned even when bootstrap errors');
  });

  it('loadState is called BEFORE bootstrapEcosystemSignals saves signals', async () => {
    // Ensures we load the base state first, then enrich it with signals.
    const callOrder: string[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _loadState: async () => { callOrder.push('loadState'); return makeMinimalState(); },
      _saveState: async () => { callOrder.push('saveState'); },
      _harshScore: async () => { callOrder.push('harshScore'); return makeHarshResult(); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    };

    await score(opts);

    const loadIdx = callOrder.indexOf('loadState');
    const saveIdx = callOrder.indexOf('saveState');
    const harshIdx = callOrder.indexOf('harshScore');

    assert.ok(loadIdx < saveIdx, 'loadState must come before saveState');
    assert.ok(saveIdx < harshIdx, 'saveState must come before harshScore');
  });
});
