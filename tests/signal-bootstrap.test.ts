// Signal Bootstrap Tests — bootstrapEcosystemSignals and score() signal wiring.
// Tests that skillCount and hasPluginManifest are correctly discovered and
// written to state on each score() run.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  bootstrapEcosystemSignals,
  score,
  type ScoreOptions,
} from '../src/cli/commands/score.js';
import type { DanteState } from '../src/core/state.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMinimalState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
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
    displayScore: 7.5,
    verdict: 'good',
    displayDimensions: {
      functionality: 7.5,
      testing: 8.0,
      errorHandling: 6.0,
      security: 7.0,
      uxPolish: 9.0,
      documentation: 6.5,
      performance: 7.0,
      maintainability: 6.0,
      autonomy: 7.0,
      planningQuality: 6.0,
      selfImprovement: 6.5,
      specDrivenPipeline: 7.0,
      convergenceSelfHealing: 6.0,
      tokenEconomy: 5.5,
      ecosystemMcp: 6.0,
      enterpriseReadiness: 7.0,
      communityAdoption: 4.0,
      developerExperience: 7.5,
    },
    ...overrides,
  };
}

// ── bootstrapEcosystemSignals tests ──────────────────────────────────────────

describe('bootstrapEcosystemSignals', () => {
  it('counts skill dirs with SKILL.md correctly', async () => {
    const dirs = ['skill-a', 'skill-b', 'skill-c', 'skill-d', 'skill-e'];
    // skill-a, skill-b, skill-c have SKILL.md; skill-d, skill-e do not
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => dirs,
      _fileExists: async (p: string) => {
        const name = path.basename(path.dirname(p));
        return ['skill-a', 'skill-b', 'skill-c'].includes(name) && p.endsWith('SKILL.md');
      },
    });
    assert.equal(result.skillCount, 3);
  });

  it('returns 0 skillCount for empty skills directory', async () => {
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    });
    assert.equal(result.skillCount, 0);
  });

  it('returns 0 skillCount when all dirs lack SKILL.md', async () => {
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => ['dir-a', 'dir-b'],
      _fileExists: async () => false,
    });
    assert.equal(result.skillCount, 0);
  });

  it('detects plugin manifest as true when file exists', async () => {
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('.claude-plugin'),
    });
    assert.equal(result.hasPluginManifest, true);
  });

  it('detects plugin manifest as false when file missing', async () => {
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    });
    assert.equal(result.hasPluginManifest, false);
  });

  it('handles listSkillDirs error gracefully and returns 0', async () => {
    // When _listSkillDirs is not injected and the path does not exist, default falls back to []
    const result = await bootstrapEcosystemSignals('/nonexistent/path/no-skills-dir', {
      _fileExists: async () => false,
    });
    assert.equal(result.skillCount, 0);
    assert.equal(result.hasPluginManifest, false);
  });

  it('counts large skill dirs correctly (33 dirs, 33 SKILL.md)', async () => {
    const dirs = Array.from({ length: 33 }, (_, i) => `skill-${i}`);
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => dirs,
      _fileExists: async (p: string) => p.endsWith('SKILL.md'),
    });
    assert.equal(result.skillCount, 33);
  });

  it('detects complexity classifier when file exists', async () => {
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('complexity-classifier'),
    });
    assert.equal(result.hasComplexityClassifier, true);
  });

  it('hasComplexityClassifier is false when file missing', async () => {
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    });
    assert.equal(result.hasComplexityClassifier, false);
  });

  it('detects verify evidence as true when latest.json exists', async () => {
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('evidence') && p.includes('verify'),
    });
    assert.equal(result.hasVerifyEvidence, true);
  });

  it('hasVerifyEvidence is false when file missing', async () => {
    const result = await bootstrapEcosystemSignals('/fake/cwd', {
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    });
    assert.equal(result.hasVerifyEvidence, false);
  });
});

// ── score() signal wiring tests ──────────────────────────────────────────────

describe('score() signal wiring', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signal-bootstrap-test-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
  });

  after(async () => {
    process.exitCode = 0;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes skillCount to saved state on score() run', async () => {
    const savedStates: DanteState[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => makeMinimalState(),
      _saveState: async (s) => { savedStates.push(s); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => ['skill-a', 'skill-b'],
      _fileExists: async (p: string) => p.endsWith('SKILL.md'),
    };

    await score(opts);

    assert.ok(savedStates.length > 0, 'saveState should have been called');
    const saved = savedStates[savedStates.length - 1];
    assert.equal(saved.skillCount, 2, 'skillCount should be 2');
  });

  it('writes hasPluginManifest=true to saved state when plugin.json exists', async () => {
    const savedStates: DanteState[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => makeMinimalState(),
      _saveState: async (s) => { savedStates.push(s); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('.claude-plugin'),
    };

    await score(opts);

    const saved = savedStates[savedStates.length - 1];
    assert.equal(saved.hasPluginManifest, true);
  });

  it('writes hasPluginManifest=false when plugin.json absent', async () => {
    const savedStates: DanteState[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => makeMinimalState(),
      _saveState: async (s) => { savedStates.push(s); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    };

    await score(opts);

    const saved = savedStates[savedStates.length - 1];
    assert.equal(saved.hasPluginManifest, false);
  });

  it('bootstrapEcosystemSignals is callable as a standalone export', async () => {
    // Smoke test: ensure the export is a function
    assert.equal(typeof bootstrapEcosystemSignals, 'function');
    const result = await bootstrapEcosystemSignals('/tmp', {
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    });
    assert.equal(typeof result.skillCount, 'number');
    assert.equal(typeof result.hasPluginManifest, 'boolean');
    assert.equal(typeof result.hasComplexityClassifier, 'boolean');
    assert.equal(typeof result.hasVerifyEvidence, 'boolean');
  });

  it('seeds lastComplexityPreset when missing from state and complexity-classifier exists', async () => {
    const savedStates: DanteState[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => makeMinimalState(), // no lastComplexityPreset
      _saveState: async (s) => { savedStates.push(s); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('complexity-classifier'),
    };

    await score(opts);

    const saved = savedStates[0]; // first save = bootstrap save
    assert.equal(saved.lastComplexityPreset, 'balanced', 'should seed lastComplexityPreset from filesystem');
  });

  it('does not overwrite existing lastComplexityPreset when already set', async () => {
    const savedStates: DanteState[] = [];
    const stateWithPreset = { ...makeMinimalState(), lastComplexityPreset: 'conservative' };

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => stateWithPreset,
      _saveState: async (s) => { savedStates.push(s); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('complexity-classifier'),
    };

    await score(opts);

    const saved = savedStates[0];
    assert.equal(saved.lastComplexityPreset, 'conservative', 'should not overwrite existing preset');
  });

  it('seeds lastVerifyStatus=pass when missing and verify evidence exists', async () => {
    const savedStates: DanteState[] = [];

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => makeMinimalState(), // no lastVerifyStatus
      _saveState: async (s) => { savedStates.push(s); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('evidence') && p.includes('verify'),
    };

    await score(opts);

    const saved = savedStates[0];
    assert.equal(saved.lastVerifyStatus, 'pass', 'should seed lastVerifyStatus from verify evidence');
  });

  it('does not overwrite existing lastVerifyStatus when already set', async () => {
    const savedStates: DanteState[] = [];
    const stateWithVerify = { ...makeMinimalState(), lastVerifyStatus: 'fail' as const };

    const opts: ScoreOptions = {
      cwd: tmpDir,
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => stateWithVerify,
      _saveState: async (s) => { savedStates.push(s); },
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _runPrime: async () => {},
      _listSkillDirs: async () => [],
      _fileExists: async (p: string) => p.includes('evidence') && p.includes('verify'),
    };

    await score(opts);

    const saved = savedStates[0];
    assert.equal(saved.lastVerifyStatus, 'fail', 'should not overwrite existing lastVerifyStatus');
  });

  it('standalone smoke test includes hasVerifyEvidence field', async () => {
    const result = await bootstrapEcosystemSignals('/tmp', {
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    });
    assert.equal(typeof result.hasVerifyEvidence, 'boolean');
  });
});
