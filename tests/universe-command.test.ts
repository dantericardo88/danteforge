// universe command — tests for display format, refresh flag, JSON output,
// empty state (no competitors), and assessment loading.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  universe,
  type UniverseOptions,
} from '../src/cli/commands/universe.js';
import type { FeatureUniverse, FeatureUniverseAssessment, FeatureItem } from '../src/core/feature-universe.js';
import type { CompletionTarget } from '../src/core/completion-target.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFeature(i: number): FeatureItem {
  return {
    id: `feat-${String(i).padStart(3, '0')}`,
    name: `Feature ${i}`,
    description: `Description of feature ${i}`,
    category: 'autonomy',
    competitorsThatHaveIt: ['CompA', 'CompB'],
    bestImplementationHint: `Hint for feature ${i}`,
  };
}

function makeUniverse(count = 3): FeatureUniverse {
  return {
    features: Array.from({ length: count }, (_, i) => makeFeature(i + 1)),
    competitors: ['CompA', 'CompB'],
    generatedAt: '2026-04-04T00:00:00Z',
    version: 1,
    sourceDescription: 'Derived from 2 competitor analysis',
  };
}

function makeAssessment(universe: FeatureUniverse, overallScore = 7.5): FeatureUniverseAssessment {
  return {
    universe,
    scores: universe.features.map((f, i) => ({
      featureId: f.id,
      featureName: f.name,
      score: i === 0 ? 9 : i === 1 ? 6 : 2,
      evidence: `Evidence for ${f.name}`,
      verdict: i === 0 ? 'implemented' as const : i === 1 ? 'partial' as const : 'missing' as const,
    })),
    overallScore,
    implementedCount: 1,
    partialCount: 1,
    missingCount: 1,
    coveragePercent: 67,
    timestamp: '2026-04-04T00:00:00Z',
  };
}

function makeTarget(): CompletionTarget {
  return {
    mode: 'feature-universe', minScore: 9.0, featureCoverage: 90,
    description: 'Feature universe', definedAt: '', definedBy: 'default',
  };
}

function makeOptions(overrides: Partial<UniverseOptions> = {}): UniverseOptions {
  const uni = makeUniverse();
  const assessment = makeAssessment(uni);
  return {
    cwd: '/fake/project',
    _loadUniverse: async () => uni,
    _scoreUniverse: async () => assessment,
    _loadScores: async () => assessment,
    _getTarget: async () => makeTarget(),
    _competitorNames: ['CompA', 'CompB'],  // bypass competitor resolution
    _buildUniverse: async () => uni,       // default build fallback
    ...overrides,
  };
}

// ── universe command ──────────────────────────────────────────────────────────

describe('universe', () => {
  it('returns the assessment when universe and scores exist', async () => {
    const result = await universe(makeOptions());
    assert.ok(result !== null, 'Assessment returned');
    assert.ok(result!.scores.length > 0);
  });

  it('returns null when no competitors found', async () => {
    const result = await universe(makeOptions({
      _loadUniverse: async () => null,
      _buildUniverse: undefined,   // no build injection → triggers competitor check
      _competitorNames: [],        // empty → no competitors → returns null
      _loadScores: async () => null,
    }));
    assert.equal(result, null, 'Should return null when no competitors');
  });

  it('skips loading universe when --refresh is set', async () => {
    let loadCalled = false;
    let buildCalled = false;
    const uni = makeUniverse();

    await universe(makeOptions({
      refresh: true,
      _loadUniverse: async () => { loadCalled = true; return uni; },
      _buildUniverse: async () => { buildCalled = true; return uni; },
      _loadScores: async () => null,
      _scoreUniverse: async () => makeAssessment(uni),
    }));

    assert.equal(loadCalled, false, 'Should not load cached universe on refresh');
    assert.equal(buildCalled, true, 'Should build fresh universe on refresh');
  });

  it('skips loading scores when --refresh is set', async () => {
    let loadScoresCalled = false;
    let scoreCalled = false;
    const uni = makeUniverse();

    await universe(makeOptions({
      refresh: true,
      _loadUniverse: async () => null,
      _buildUniverse: async () => uni,
      _loadScores: async () => { loadScoresCalled = true; return makeAssessment(uni); },
      _scoreUniverse: async () => { scoreCalled = true; return makeAssessment(uni); },
    }));

    assert.equal(loadScoresCalled, false, 'Should not load cached scores on refresh');
    assert.equal(scoreCalled, true, 'Should score fresh on refresh');
  });

  it('outputs JSON when --json flag set', async () => {
    const result = await universe(makeOptions({ json: true }));
    assert.ok(result !== null);
    assert.ok(typeof result!.overallScore === 'number');
  });

  it('uses cached scores when available and not refreshing', async () => {
    let scoreFnCalled = false;
    const uni = makeUniverse();
    const cachedAssessment = makeAssessment(uni, 8.5);

    const result = await universe(makeOptions({
      _loadUniverse: async () => uni,
      _loadScores: async () => cachedAssessment,
      _scoreUniverse: async () => { scoreFnCalled = true; return makeAssessment(uni); },
    }));

    assert.equal(scoreFnCalled, false, 'Should use cached scores');
    assert.equal(result!.overallScore, 8.5);
  });

  it('scores fresh when no cached scores', async () => {
    let scoreFnCalled = false;
    const uni = makeUniverse();

    await universe(makeOptions({
      _loadUniverse: async () => uni,
      _loadScores: async () => null,
      _scoreUniverse: async () => { scoreFnCalled = true; return makeAssessment(uni); },
    }));

    assert.equal(scoreFnCalled, true, 'Should score when no cache');
  });

  it('uses target from _getTarget for pass/fail display', async () => {
    const uni = makeUniverse();
    const highScoreAssessment = makeAssessment(uni, 9.5);
    highScoreAssessment.coveragePercent = 95;
    highScoreAssessment.implementedCount = 3;
    highScoreAssessment.missingCount = 0;

    // Should not throw even at high score
    const result = await universe(makeOptions({
      _loadUniverse: async () => uni,
      _loadScores: async () => highScoreAssessment,
      _getTarget: async () => ({
        mode: 'feature-universe' as const, minScore: 9.0, featureCoverage: 90,
        description: 'Test target', definedAt: '', definedBy: 'default' as const,
      }),
    }));
    assert.ok(result !== null);
  });
});
