import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { DanteState } from '../src/core/state.js';
import {
  classifyTaskSignature,
  routeTask,
  getRouterConfigForPreset,
  getDefaultRouterConfig,
} from '../src/core/task-router.js';
import type { TaskSignature, TaskRouterConfig } from '../src/core/task-router.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyTaskSignature
// ---------------------------------------------------------------------------

describe('classifyTaskSignature', () => {
  it('returns low score for simple rename tasks', () => {
    const state = makeState();
    const sig = classifyTaskSignature(
      { name: 'rename variable foo to bar' },
      state,
    );
    // 'rename' is a LOW_COMPLEXITY_KEYWORD, taskType = 'transform' (base 10),
    // low keyword match subtracts 15 → max(10-15, 0) = 0, no files → score 0
    assert.ok(sig.complexityScore < 15, `Expected low score, got ${sig.complexityScore}`);
  });

  it('returns high score for architectural tasks', () => {
    const state = makeState();
    const sig = classifyTaskSignature(
      { name: 'architect new authentication module', files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'] },
      state,
    );
    // taskType = 'architect' (base 50), HIGH_COMPLEXITY matches → +20,
    // hasArchitecturalDecision → +10, hasSecurityImplication ('authentication') → +10,
    // 5 files → +15 → should be very high
    assert.ok(sig.complexityScore >= 50, `Expected high score, got ${sig.complexityScore}`);
  });

  it('detects test requirement from verify field', () => {
    const state = makeState();
    const sig = classifyTaskSignature(
      { name: 'implement widget', verify: 'npm test' },
      state,
    );
    assert.strictEqual(sig.hasTestRequirement, true);
  });

  it('does not flag test requirement when verify is absent', () => {
    const state = makeState();
    const sig = classifyTaskSignature(
      { name: 'implement widget' },
      state,
    );
    assert.strictEqual(sig.hasTestRequirement, false);
  });

  it('does not flag test requirement when verify is empty string', () => {
    const state = makeState();
    const sig = classifyTaskSignature(
      { name: 'implement widget', verify: '' },
      state,
    );
    assert.strictEqual(sig.hasTestRequirement, false);
  });

  it('counts files correctly', () => {
    const state = makeState();
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const sig = classifyTaskSignature(
      { name: 'update imports', files },
      state,
    );
    assert.strictEqual(sig.fileCount, 3);
    assert.strictEqual(sig.totalLinesChanged, 150); // 3 * 50
  });

  it('reports zero files when files is undefined', () => {
    const state = makeState();
    const sig = classifyTaskSignature(
      { name: 'update imports' },
      state,
    );
    assert.strictEqual(sig.fileCount, 0);
    assert.strictEqual(sig.totalLinesChanged, 0);
  });

  it('detects security implications from keywords', () => {
    const state = makeState();
    const securityKeywords = ['security', 'authentication', 'auth', 'credential'];
    for (const keyword of securityKeywords) {
      const sig = classifyTaskSignature(
        { name: `fix ${keyword} handling` },
        state,
      );
      assert.strictEqual(
        sig.hasSecurityImplication,
        true,
        `Expected security implication for keyword "${keyword}"`,
      );
    }
  });

  it('detects architectural decisions from keywords', () => {
    const state = makeState();
    // hasArchitecturalDecision checks only 'architect', 'design', 'module'
    const archKeywords = ['architect', 'design', 'module'];
    for (const keyword of archKeywords) {
      const sig = classifyTaskSignature(
        { name: `plan ${keyword} structure` },
        state,
      );
      assert.strictEqual(
        sig.hasArchitecturalDecision,
        true,
        `Expected architectural decision for keyword "${keyword}"`,
      );
    }
  });

  it('infers correct taskType from name', () => {
    const state = makeState();
    assert.strictEqual(
      classifyTaskSignature({ name: 'architect the API layer' }, state).taskType,
      'architect',
    );
    assert.strictEqual(
      classifyTaskSignature({ name: 'review pull request' }, state).taskType,
      'review',
    );
    assert.strictEqual(
      classifyTaskSignature({ name: 'verify build output' }, state).taskType,
      'verify',
    );
    assert.strictEqual(
      classifyTaskSignature({ name: 'generate component' }, state).taskType,
      'generate',
    );
    assert.strictEqual(
      classifyTaskSignature({ name: 'rename variable' }, state).taskType,
      'transform',
    );
  });

  it('caps complexity score at 100', () => {
    const state = makeState();
    // architect (50) + HIGH match (20) + archDecision (10) + security (10)
    // + 10 files (30) + testReq (5) = 125 → capped at 100
    const sig = classifyTaskSignature(
      {
        name: 'architect security module design',
        files: Array.from({ length: 10 }, (_, i) => `f${i}.ts`),
        verify: 'npm test',
      },
      state,
    );
    assert.ok(sig.complexityScore <= 100, `Score should be capped at 100, got ${sig.complexityScore}`);
  });
});

// ---------------------------------------------------------------------------
// routeTask
// ---------------------------------------------------------------------------

describe('routeTask', () => {
  function makeSignature(overrides: Partial<TaskSignature> = {}): TaskSignature {
    return {
      taskType: 'transform',
      fileCount: 0,
      totalLinesChanged: 0,
      hasTestRequirement: false,
      hasArchitecturalDecision: false,
      hasSecurityImplication: false,
      complexityScore: 0,
      ...overrides,
    };
  }

  it('returns "local" for score < localThreshold (default 15)', () => {
    const sig = makeSignature({ complexityScore: 10 });
    const decision = routeTask(sig);
    assert.strictEqual(decision.tier, 'local');
  });

  it('returns "light" for score between thresholds', () => {
    // Default: localThreshold=15, lightThreshold=45
    const sig = makeSignature({ complexityScore: 30 });
    const decision = routeTask(sig);
    assert.strictEqual(decision.tier, 'light');
  });

  it('returns "heavy" for score >= lightThreshold', () => {
    // Default lightThreshold = 45
    const sig = makeSignature({ complexityScore: 50 });
    const decision = routeTask(sig);
    assert.strictEqual(decision.tier, 'heavy');
  });

  it('returns "heavy" for score exactly at lightThreshold', () => {
    const sig = makeSignature({ complexityScore: 45 });
    const decision = routeTask(sig);
    assert.strictEqual(decision.tier, 'heavy');
  });

  it('returns null model for local tier', () => {
    const sig = makeSignature({ complexityScore: 5 });
    const decision = routeTask(sig);
    assert.strictEqual(decision.model, null);
  });

  it('returns non-null model for light tier', () => {
    const sig = makeSignature({ complexityScore: 20 });
    const decision = routeTask(sig);
    assert.ok(decision.model !== null, 'Light tier should have a model');
    assert.strictEqual(typeof decision.model, 'string');
  });

  it('returns non-null model for heavy tier', () => {
    const sig = makeSignature({ complexityScore: 80 });
    const decision = routeTask(sig);
    assert.ok(decision.model !== null, 'Heavy tier should have a model');
    assert.strictEqual(typeof decision.model, 'string');
  });

  it('estimates cost as non-negative for all tiers', () => {
    for (const score of [5, 30, 80]) {
      const sig = makeSignature({ complexityScore: score, totalLinesChanged: 200 });
      const decision = routeTask(sig);
      assert.ok(
        decision.estimatedCostUsd >= 0,
        `Cost should be non-negative for score ${score}, got ${decision.estimatedCostUsd}`,
      );
    }
  });

  it('cost estimate is zero for local tier', () => {
    const sig = makeSignature({ complexityScore: 5 });
    const decision = routeTask(sig);
    assert.strictEqual(decision.estimatedCostUsd, 0);
  });

  it('cost estimate is positive for non-local tiers with lines changed', () => {
    const sig = makeSignature({ complexityScore: 30, totalLinesChanged: 500 });
    const decision = routeTask(sig);
    assert.ok(decision.estimatedCostUsd > 0, `Expected positive cost for light tier, got ${decision.estimatedCostUsd}`);
  });

  it('local tier reports zero tokens', () => {
    const sig = makeSignature({ complexityScore: 5 });
    const decision = routeTask(sig);
    assert.strictEqual(decision.estimatedTokens.input, 0);
    assert.strictEqual(decision.estimatedTokens.output, 0);
  });

  it('respects custom config thresholds', () => {
    const sig = makeSignature({ complexityScore: 25 });
    // With custom config where localThreshold=30, score 25 should be local
    const decision = routeTask(sig, { localThreshold: 30, lightThreshold: 60 });
    assert.strictEqual(decision.tier, 'local');
  });

  it('includes complexity score in reason string', () => {
    const sig = makeSignature({ complexityScore: 30 });
    const decision = routeTask(sig);
    assert.ok(
      decision.reason.includes('30'),
      `Reason should mention score 30: "${decision.reason}"`,
    );
  });
});

// ---------------------------------------------------------------------------
// getRouterConfigForPreset
// ---------------------------------------------------------------------------

describe('getRouterConfigForPreset', () => {
  it('spark has highest local threshold (30)', () => {
    const config = getRouterConfigForPreset('spark');
    assert.strictEqual(config.localThreshold, 30);
  });

  it('inferno has lowest local threshold (5)', () => {
    const config = getRouterConfigForPreset('inferno');
    assert.strictEqual(config.localThreshold, 5);
  });

  it('returns valid config for all 6 presets', () => {
    const levels = ['spark', 'ember', 'magic', 'blaze', 'nova', 'inferno'] as const;
    for (const level of levels) {
      const config = getRouterConfigForPreset(level);
      assert.strictEqual(typeof config.localThreshold, 'number', `${level} localThreshold should be number`);
      assert.strictEqual(typeof config.lightThreshold, 'number', `${level} lightThreshold should be number`);
      assert.strictEqual(typeof config.lightModel, 'string', `${level} lightModel should be string`);
      assert.strictEqual(typeof config.heavyModel, 'string', `${level} heavyModel should be string`);
      assert.ok(config.localThreshold < config.lightThreshold, `${level}: localThreshold should be less than lightThreshold`);
    }
  });

  it('local thresholds decrease monotonically from spark to inferno', () => {
    const levels = ['spark', 'ember', 'magic', 'blaze', 'nova', 'inferno'] as const;
    const thresholds = levels.map(l => getRouterConfigForPreset(l).localThreshold);
    for (let i = 1; i < thresholds.length; i++) {
      assert.ok(
        thresholds[i] < thresholds[i - 1],
        `Expected ${levels[i]} threshold (${thresholds[i]}) < ${levels[i - 1]} threshold (${thresholds[i - 1]})`,
      );
    }
  });

  it('all presets use haiku as lightModel and sonnet as heavyModel', () => {
    const levels = ['spark', 'ember', 'magic', 'blaze', 'nova', 'inferno'] as const;
    for (const level of levels) {
      const config = getRouterConfigForPreset(level);
      assert.strictEqual(config.lightModel, 'haiku', `${level} lightModel`);
      assert.strictEqual(config.heavyModel, 'sonnet', `${level} heavyModel`);
    }
  });
});

// ---------------------------------------------------------------------------
// getDefaultRouterConfig
// ---------------------------------------------------------------------------

describe('getDefaultRouterConfig', () => {
  it('matches the magic preset thresholds', () => {
    const defaultConfig = getDefaultRouterConfig();
    const magicConfig = getRouterConfigForPreset('magic');
    assert.strictEqual(defaultConfig.localThreshold, magicConfig.localThreshold);
    assert.strictEqual(defaultConfig.lightThreshold, magicConfig.lightThreshold);
  });

  it('returns a fresh object each time (no shared reference)', () => {
    const a = getDefaultRouterConfig();
    const b = getDefaultRouterConfig();
    assert.deepStrictEqual(a, b);
    assert.ok(a !== b, 'Should return distinct objects');
  });
});
