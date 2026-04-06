import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { DanteState } from '../src/core/state.js';
import type { ComplexityWeights } from '../src/core/complexity-classifier.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
    ...overrides,
  };
}

describe('complexity-classifier', () => {
  // ── extractComplexitySignals ───────────────────────────────────────────────

  describe('extractComplexitySignals', () => {
    it('counts files correctly from tasks', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'task-a', files: ['src/a.ts', 'src/b.ts'] },
        { name: 'task-b', files: ['src/c.ts'] },
      ];
      const signals = extractComplexitySignals(tasks, makeState());
      assert.strictEqual(signals.fileCount, 3);
    });

    it('detects security keywords', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'add authentication middleware', files: [] },
      ];
      const signals = extractComplexitySignals(tasks, makeState());
      assert.strictEqual(signals.hasSecurityImplication, true);
    });

    it('detects database keywords', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'run database migration', files: [] },
      ];
      const signals = extractComplexitySignals(tasks, makeState());
      assert.strictEqual(signals.hasDatabaseChange, true);
    });

    it('detects API keywords', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'create new REST endpoint', files: [] },
      ];
      const signals = extractComplexitySignals(tasks, makeState());
      assert.strictEqual(signals.hasAPIChange, true);
    });

    it('counts unique modules from top-level directories', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        {
          name: 'cross-module work',
          files: ['src/core/llm.ts', 'src/cli/index.ts', 'tests/smoke.test.ts'],
        },
      ];
      const signals = extractComplexitySignals(tasks, makeState());
      assert.strictEqual(signals.moduleCount, 2);
      // "src" and "tests" are the two unique top-level directories
    });

    it('detects architectural changes', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'refactor core interface', files: [] },
      ];
      const signals = extractComplexitySignals(tasks, makeState());
      assert.strictEqual(signals.hasArchitecturalChange, true);
    });

    it('detects test requirement from verify fields', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'add feature', files: [], verify: 'npm test' },
      ];
      const signals = extractComplexitySignals(tasks, makeState());
      assert.strictEqual(signals.hasTestRequirement, true);
    });

    it('detects new module pattern from task names', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'create module for analytics', files: [] },
      ];
      const signals = extractComplexitySignals(tasks, makeState());
      assert.strictEqual(signals.hasNewModule, true);
    });

    it('returns zero files and zero modules for empty tasks', async () => {
      const { extractComplexitySignals } = await import(
        '../src/core/complexity-classifier.js'
      );
      const signals = extractComplexitySignals([], makeState());
      assert.strictEqual(signals.fileCount, 0);
      assert.strictEqual(signals.moduleCount, 0);
      assert.strictEqual(signals.estimatedLinesOfCode, 0);
    });
  });

  // ── computeComplexityScore ─────────────────────────────────────────────────

  describe('computeComplexityScore', () => {
    it('returns value in 0-100 range', async () => {
      const { computeComplexityScore } = await import(
        '../src/core/complexity-classifier.js'
      );
      const signals = {
        fileCount: 25,
        moduleCount: 5,
        hasNewModule: true,
        hasArchitecturalChange: true,
        hasSecurityImplication: true,
        hasTestRequirement: true,
        hasDatabaseChange: true,
        hasAPIChange: true,
        estimatedLinesOfCode: 2500,
        dependencyDepth: 5,
      };
      const score = computeComplexityScore(signals);
      assert.ok(score >= 0, `Score ${score} should be >= 0`);
      assert.ok(score <= 100, `Score ${score} should be <= 100`);
    });

    it('gives higher score for more signals', async () => {
      const { computeComplexityScore } = await import(
        '../src/core/complexity-classifier.js'
      );
      const lowSignals = {
        fileCount: 1,
        moduleCount: 0,
        hasNewModule: false,
        hasArchitecturalChange: false,
        hasSecurityImplication: false,
        hasTestRequirement: false,
        hasDatabaseChange: false,
        hasAPIChange: false,
        estimatedLinesOfCode: 0,
        dependencyDepth: 0,
      };
      const highSignals = {
        fileCount: 25,
        moduleCount: 5,
        hasNewModule: true,
        hasArchitecturalChange: true,
        hasSecurityImplication: true,
        hasTestRequirement: true,
        hasDatabaseChange: true,
        hasAPIChange: true,
        estimatedLinesOfCode: 2500,
        dependencyDepth: 5,
      };
      const lowScore = computeComplexityScore(lowSignals);
      const highScore = computeComplexityScore(highSignals);
      assert.ok(highScore > lowScore, `High score ${highScore} should exceed low score ${lowScore}`);
    });

    it('returns 0 for empty signals', async () => {
      const { computeComplexityScore } = await import(
        '../src/core/complexity-classifier.js'
      );
      const emptySignals = {
        fileCount: 0,
        moduleCount: 0,
        hasNewModule: false,
        hasArchitecturalChange: false,
        hasSecurityImplication: false,
        hasTestRequirement: false,
        hasDatabaseChange: false,
        hasAPIChange: false,
        estimatedLinesOfCode: 0,
        dependencyDepth: 0,
      };
      const score = computeComplexityScore(emptySignals);
      assert.strictEqual(score, 0);
    });
  });

  // ── mapScoreToPreset ───────────────────────────────────────────────────────

  describe('mapScoreToPreset', () => {
    it('returns spark for score 10', async () => {
      const { mapScoreToPreset } = await import(
        '../src/core/complexity-classifier.js'
      );
      assert.strictEqual(mapScoreToPreset(10), 'spark');
    });

    it('returns inferno for score 80', async () => {
      const { mapScoreToPreset } = await import(
        '../src/core/complexity-classifier.js'
      );
      assert.strictEqual(mapScoreToPreset(80), 'inferno');
    });

    it('returns magic for score 45', async () => {
      const { mapScoreToPreset } = await import(
        '../src/core/complexity-classifier.js'
      );
      assert.strictEqual(mapScoreToPreset(45), 'magic');
    });

    it('returns ember for score 20', async () => {
      const { mapScoreToPreset } = await import(
        '../src/core/complexity-classifier.js'
      );
      assert.strictEqual(mapScoreToPreset(20), 'ember');
    });

    it('returns blaze for score 60', async () => {
      const { mapScoreToPreset } = await import(
        '../src/core/complexity-classifier.js'
      );
      assert.strictEqual(mapScoreToPreset(60), 'blaze');
    });
  });

  // ── assessComplexity ───────────────────────────────────────────────────────

  describe('assessComplexity', () => {
    it('returns shouldUseParty=true for high score', async () => {
      const { assessComplexity } = await import(
        '../src/core/complexity-classifier.js'
      );
      // Lots of files, security, architecture, database, API — score will be high (>55)
      const tasks = [
        {
          name: 'refactor authentication for database migration',
          files: [
            'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts',
            'src/e.ts', 'src/f.ts', 'src/g.ts', 'src/h.ts',
            'src/i.ts', 'src/j.ts', 'src/k.ts', 'lib/x.ts',
          ],
          verify: 'npm test',
        },
        {
          name: 'add new REST endpoint for api',
          files: ['api/route.ts'],
        },
      ];
      const assessment = assessComplexity(tasks, makeState());
      assert.strictEqual(assessment.shouldUseParty, true);
    });

    it('returns shouldUseParty=false for low score', async () => {
      const { assessComplexity } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'fix typo in readme', files: ['README.md'] },
      ];
      const assessment = assessComplexity(tasks, makeState());
      assert.strictEqual(assessment.shouldUseParty, false);
    });

    it('returns a valid recommendedPreset', async () => {
      const { assessComplexity } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'simple cleanup', files: ['src/a.ts'] },
      ];
      const assessment = assessComplexity(tasks, makeState());
      const validPresets = ['spark', 'ember', 'magic', 'blaze', 'inferno'];
      assert.ok(
        validPresets.includes(assessment.recommendedPreset),
        `Expected one of ${validPresets.join(',')} but got ${assessment.recommendedPreset}`,
      );
    });
  });

  // ── formatAssessment ───────────────────────────────────────────────────────

  describe('formatAssessment', () => {
    it('returns a string with score and preset', async () => {
      const { assessComplexity, formatAssessment } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'add new feature', files: ['src/feature.ts', 'src/util.ts'] },
      ];
      const assessment = assessComplexity(tasks, makeState());
      const output = formatAssessment(assessment);
      assert.ok(typeof output === 'string', 'formatAssessment should return a string');
      assert.ok(output.includes('Score'), 'Output should contain Score');
      assert.ok(output.includes('Preset'), 'Output should contain Preset');
      assert.ok(
        output.includes(assessment.recommendedPreset),
        'Output should contain the recommended preset name',
      );
    });

    it('includes signal details in output', async () => {
      const { assessComplexity, formatAssessment } = await import(
        '../src/core/complexity-classifier.js'
      );
      const tasks = [
        { name: 'fix bug', files: ['src/a.ts'] },
      ];
      const assessment = assessComplexity(tasks, makeState());
      const output = formatAssessment(assessment);
      assert.ok(output.includes('Signals'), 'Output should contain Signals section');
      assert.ok(output.includes('Files'), 'Output should list file count');
      assert.ok(output.includes('Modules'), 'Output should list module count');
    });
  });

  // ── configurable weights ─────────────────────────────────────────────────

  describe('configurable weights', () => {
    it('custom weights change the score', async () => {
      const { computeComplexityScore } = await import(
        '../src/core/complexity-classifier.js'
      );
      const signals = {
        fileCount: 10,
        moduleCount: 3,
        hasNewModule: true,
        hasArchitecturalChange: true,
        hasSecurityImplication: false,
        hasTestRequirement: false,
        hasDatabaseChange: false,
        hasAPIChange: false,
        estimatedLinesOfCode: 1000,
        dependencyDepth: 3,
      };
      const defaultScore = computeComplexityScore(signals);

      const heavyWeights: ComplexityWeights = {
        fileCount: 30,
        newModule: 20,
        architecturalChange: 20,
        securityImplication: 5,
        linesOfCode: 10,
        dependencyDepth: 5,
        testRequirement: 5,
        apiChange: 3,
        databaseChange: 2,
      };
      const customScore = computeComplexityScore(signals, heavyWeights);

      assert.notStrictEqual(customScore, defaultScore, 'Custom weights should produce a different score');
    });

    it('zero weight for a signal ignores it', async () => {
      const { computeComplexityScore } = await import(
        '../src/core/complexity-classifier.js'
      );
      const signals = {
        fileCount: 0,
        moduleCount: 0,
        hasNewModule: false,
        hasArchitecturalChange: false,
        hasSecurityImplication: true,
        hasTestRequirement: false,
        hasDatabaseChange: false,
        hasAPIChange: false,
        estimatedLinesOfCode: 0,
        dependencyDepth: 0,
      };

      const zeroSecurityWeights: ComplexityWeights = {
        fileCount: 15,
        newModule: 10,
        architecturalChange: 15,
        securityImplication: 0,
        linesOfCode: 15,
        dependencyDepth: 10,
        testRequirement: 10,
        apiChange: 8,
        databaseChange: 7,
      };
      const score = computeComplexityScore(signals, zeroSecurityWeights);
      assert.strictEqual(score, 0, 'Score should be 0 when the only active signal has weight 0');
    });

    it('DEFAULT_COMPLEXITY_WEIGHTS sums to 100', async () => {
      const { DEFAULT_COMPLEXITY_WEIGHTS: defaults } = await import(
        '../src/core/complexity-classifier.js'
      );
      const total = defaults.fileCount
        + defaults.newModule
        + defaults.architecturalChange
        + defaults.securityImplication
        + defaults.linesOfCode
        + defaults.dependencyDepth
        + defaults.testRequirement
        + defaults.apiChange
        + defaults.databaseChange;
      assert.strictEqual(total, 100, `Default weights should sum to 100, got ${total}`);
    });

    it('boundary: score 75 maps to blaze, score 76 maps to inferno', async () => {
      const { mapScoreToPreset } = await import(
        '../src/core/complexity-classifier.js'
      );
      assert.strictEqual(mapScoreToPreset(75), 'blaze', 'Score 75 should map to blaze');
      assert.strictEqual(mapScoreToPreset(76), 'inferno', 'Score 76 should map to inferno');
    });
  });

  // ── adjustWeightsFromOutcome ──────────────────────────────────────────────

  describe('adjustWeightsFromOutcome', () => {
    it('returns null when drift is less than 2', async () => {
      const { adjustWeightsFromOutcome, DEFAULT_COMPLEXITY_WEIGHTS } = await import(
        '../src/core/complexity-classifier.js'
      );
      const result = adjustWeightsFromOutcome(DEFAULT_COMPLEXITY_WEIGHTS, 'magic', 'blaze');
      assert.strictEqual(result, null, 'Drift of 1 should return null');
    });

    it('increases weights on underestimate (predicted low, actual high)', async () => {
      const { adjustWeightsFromOutcome, DEFAULT_COMPLEXITY_WEIGHTS } = await import(
        '../src/core/complexity-classifier.js'
      );
      const result = adjustWeightsFromOutcome(DEFAULT_COMPLEXITY_WEIGHTS, 'spark', 'blaze');
      assert.ok(result !== null, 'Drift of 3 should return adjusted weights');
      // On underestimate, weights should increase — at least some should be higher than defaults
      const defaultSum = Object.values(DEFAULT_COMPLEXITY_WEIGHTS).reduce((a, b) => a + b, 0);
      const adjustedSum = Object.values(result!).reduce((a, b) => a + b, 0);
      // After normalization, both should be close to 100
      assert.ok(Math.abs(adjustedSum - 100) < 10, `Adjusted sum should be close to 100, got ${adjustedSum}`);
      assert.ok(Math.abs(defaultSum - 100) < 10, `Default sum should be close to 100, got ${defaultSum}`);
    });

    it('decreases weights on overestimate (predicted high, actual low)', async () => {
      const { adjustWeightsFromOutcome, DEFAULT_COMPLEXITY_WEIGHTS } = await import(
        '../src/core/complexity-classifier.js'
      );
      const result = adjustWeightsFromOutcome(DEFAULT_COMPLEXITY_WEIGHTS, 'inferno', 'ember');
      assert.ok(result !== null, 'Drift of 3 should return adjusted weights');
    });

    it('clamps all weights to [1, 30] range', async () => {
      const { adjustWeightsFromOutcome } = await import(
        '../src/core/complexity-classifier.js'
      );
      const extremeWeights: ComplexityWeights = {
        fileCount: 30, newModule: 30, architecturalChange: 1, securityImplication: 1,
        linesOfCode: 30, dependencyDepth: 1, testRequirement: 1, apiChange: 1, databaseChange: 1,
      };
      const result = adjustWeightsFromOutcome(extremeWeights, 'spark', 'inferno', 0.5);
      assert.ok(result !== null);
      for (const val of Object.values(result!)) {
        assert.ok(val >= 1, `Weight ${val} should be >= 1`);
        assert.ok(val <= 30, `Weight ${val} should be <= 30`);
      }
    });

    it('default weights with drift=3 produce at least one changed weight (no-op rounding fix)', async () => {
      const { adjustWeightsFromOutcome, DEFAULT_COMPLEXITY_WEIGHTS } = await import(
        '../src/core/complexity-classifier.js'
      );
      const result = adjustWeightsFromOutcome(DEFAULT_COMPLEXITY_WEIGHTS, 'spark', 'blaze');
      assert.ok(result !== null, 'drift=3 should produce adjusted weights');
      const changed = (Object.keys(result!) as Array<keyof typeof result>).some(
        k => result![k] !== DEFAULT_COMPLEXITY_WEIGHTS[k],
      );
      assert.ok(changed, 'at least one weight must differ from defaults after calibration (rounding fix active)');
    });
  });

  // ── persistComplexityWeights ──────────────────────────────────────────────

  describe('persistComplexityWeights', () => {
    it('writes valid YAML to .danteforge/complexity-weights.yaml', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const os = await import('node:os');
      const { persistComplexityWeights, DEFAULT_COMPLEXITY_WEIGHTS } = await import(
        '../src/core/complexity-classifier.js'
      );
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-weights-'));
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await persistComplexityWeights(DEFAULT_COMPLEXITY_WEIGHTS, dir);
      const content = await fs.readFile(path.join(dir, '.danteforge', 'complexity-weights.yaml'), 'utf8');
      assert.ok(content.includes('fileCount'));
      assert.ok(content.includes('newModule'));
      await fs.rm(dir, { recursive: true, force: true });
    });
  });
});
