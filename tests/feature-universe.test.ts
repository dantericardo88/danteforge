// Feature Universe — tests for feature extraction, union building, project scoring,
// pipe-line parsing, deduplication, cache I/O, and forge prompt generation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import {
  extractCompetitorFeatures,
  buildFeatureUniverse,
  scoreProjectAgainstUniverse,
  parseFeatureLines,
  saveFeatureUniverse,
  loadFeatureUniverse,
  saveFeatureScores,
  loadFeatureScores,
  buildFeatureForgePrompt,
  formatFeatureUniverseReport,
  type FeatureItem,
  type FeatureUniverse,
  type FeatureUniverseAssessment,
  type FeatureScore,
} from '../src/core/feature-universe.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFeatureItem(overrides: Partial<FeatureItem> = {}): FeatureItem {
  return {
    id: 'feat-001',
    name: 'Circuit breaker with exponential backoff',
    description: 'Detects repeated failures and pauses with increasing delay',
    category: 'autonomy',
    competitorsThatHaveIt: ['Devin'],
    bestImplementationHint: 'Uses CLOSED/OPEN/HALF_OPEN states',
    ...overrides,
  };
}

function makeUniverse(featureCount = 3): FeatureUniverse {
  return {
    features: Array.from({ length: featureCount }, (_, i) => makeFeatureItem({
      id: `feat-${String(i + 1).padStart(3, '0')}`,
      name: `Feature ${i + 1}`,
      competitorsThatHaveIt: ['CompA', 'CompB'],
    })),
    competitors: ['CompA', 'CompB'],
    generatedAt: '2026-04-04T00:00:00Z',
    version: 1,
    sourceDescription: 'Test universe',
  };
}

function makeScores(universe: FeatureUniverse, baseScore = 8): FeatureScore[] {
  return universe.features.map((f) => ({
    featureId: f.id,
    featureName: f.name,
    score: baseScore,
    evidence: 'Found in codebase',
    verdict: baseScore >= 7 ? 'implemented' as const : baseScore >= 4 ? 'partial' as const : 'missing' as const,
  }));
}

// ── parseFeatureLines ─────────────────────────────────────────────────────────

describe('parseFeatureLines', () => {
  it('parses valid FEATURE lines', () => {
    const input = [
      'FEATURE|autonomy|Circuit breaker|Detects failures|Uses CLOSED/OPEN states',
      'FEATURE|planning|Spec decomposition|Breaks goals into tasks|Via LLM prompting',
      'FEATURE|quality|Coverage gates|Enforces test coverage|c8 integration',
    ].join('\n');

    const features = parseFeatureLines(input, ['Devin']);
    assert.equal(features.length, 3);
    assert.equal(features[0]!.name, 'Circuit breaker');
    assert.equal(features[0]!.category, 'autonomy');
    assert.equal(features[0]!.competitorsThatHaveIt[0], 'Devin');
    assert.equal(features[0]!.bestImplementationHint, 'Uses CLOSED/OPEN states');
    assert.equal(features[1]!.category, 'planning');
    assert.equal(features[2]!.category, 'quality');
  });

  it('skips non-FEATURE lines', () => {
    const input = 'Some text\nFEATURE|dx|Good DX|Makes things easy|Via nice CLI\nMore text';
    const features = parseFeatureLines(input);
    assert.equal(features.length, 1);
  });

  it('assigns sequential IDs starting at feat-001', () => {
    const input = [
      'FEATURE|other|Alpha|Desc A|Hint A',
      'FEATURE|other|Beta|Desc B|Hint B',
      'FEATURE|other|Gamma|Desc C|Hint C',
    ].join('\n');
    const features = parseFeatureLines(input);
    assert.equal(features[0]!.id, 'feat-001');
    assert.equal(features[1]!.id, 'feat-002');
    assert.equal(features[2]!.id, 'feat-003');
  });

  it('defaults unknown category to other', () => {
    const input = 'FEATURE|unknown_category|Feature|Desc|Hint';
    const features = parseFeatureLines(input);
    assert.equal(features[0]!.category, 'other');
  });

  it('handles missing hint gracefully', () => {
    const input = 'FEATURE|integration|API client|HTTP abstraction|';
    const features = parseFeatureLines(input);
    assert.equal(features[0]!.bestImplementationHint, undefined);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(parseFeatureLines(''), []);
  });

  it('skips lines with too few fields', () => {
    const input = 'FEATURE|only|two fields';
    assert.deepEqual(parseFeatureLines(input), []);
  });
});

// ── extractCompetitorFeatures ─────────────────────────────────────────────────

describe('extractCompetitorFeatures', () => {
  it('returns parsed features from LLM response', async () => {
    const response = [
      'FEATURE|autonomy|Self-healing loop|Retries with backoff|Circuit breaker pattern',
      'FEATURE|planning|Goal decomposition|Breaks goals into tasks|Tree-of-thought',
    ].join('\n');

    const features = await extractCompetitorFeatures(
      'Devin',
      { projectName: 'TestProject' },
      { _callLLM: async () => response },
    );
    assert.equal(features.length, 2);
    assert.equal(features[0]!.competitorsThatHaveIt[0], 'Devin');
  });

  it('returns empty array when LLM throws', async () => {
    const features = await extractCompetitorFeatures(
      'Devin',
      { projectName: 'TestProject' },
      { _callLLM: async () => { throw new Error('LLM down'); } },
    );
    assert.deepEqual(features, []);
  });

  it('returns empty array when LLM returns no valid lines', async () => {
    const features = await extractCompetitorFeatures(
      'Devin',
      { projectName: 'TestProject' },
      { _callLLM: async () => 'No features here, sorry.' },
    );
    assert.deepEqual(features, []);
  });
});

// ── buildFeatureUniverse ──────────────────────────────────────────────────────

describe('buildFeatureUniverse', () => {
  it('returns empty universe when no competitors provided', async () => {
    const universe = await buildFeatureUniverse([], { projectName: 'Test' });
    assert.equal(universe.features.length, 0);
    assert.equal(universe.competitors.length, 0);
  });

  it('extracts and deduplicates features across competitors', async () => {
    let callCount = 0;
    const responses = [
      // Competitor 1 features
      'FEATURE|autonomy|Circuit breaker|Detects failures|CLOSED/OPEN states\nFEATURE|planning|Spec gen|Generates spec|LLM call',
      // Competitor 2 features
      'FEATURE|autonomy|Circuit breaker|Same feature diff name|Uses retry logic\nFEATURE|execution|Worktree isolation|Git worktrees|git worktree cmd',
      // Deduplication call — returns merged JSON
      JSON.stringify([
        { id: 'feat-001', name: 'Circuit breaker', description: 'Detects failures', category: 'autonomy', competitorsThatHaveIt: ['CompA', 'CompB'], bestImplementationHint: 'CLOSED/OPEN states' },
        { id: 'feat-002', name: 'Spec generation', description: 'Generates spec', category: 'planning', competitorsThatHaveIt: ['CompA'], bestImplementationHint: 'LLM call' },
        { id: 'feat-003', name: 'Worktree isolation', description: 'Git worktrees', category: 'execution', competitorsThatHaveIt: ['CompB'], bestImplementationHint: 'git worktree cmd' },
      ]),
    ];

    const universe = await buildFeatureUniverse(
      ['CompA', 'CompB'],
      { projectName: 'TestProject' },
      { _callLLM: async () => responses[callCount++] ?? '' },
    );

    assert.equal(universe.competitors.length, 2);
    assert.ok(universe.features.length >= 2, 'Should have at least 2 features');
    assert.equal(universe.version, 1);
  });

  it('falls back to naive union when deduplication LLM fails', async () => {
    let callCount = 0;
    const universe = await buildFeatureUniverse(
      ['CompA'],
      { projectName: 'TestProject' },
      {
        _callLLM: async () => {
          callCount++;
          if (callCount === 1) {
            return 'FEATURE|quality|Test seams|Injected test dependencies|Factory pattern';
          }
          throw new Error('dedup LLM down');
        },
      },
    );
    assert.ok(universe.features.length >= 1);
  });
});

// ── scoreProjectAgainstUniverse ───────────────────────────────────────────────

describe('scoreProjectAgainstUniverse', () => {
  it('returns empty assessment for empty universe', async () => {
    const universe = makeUniverse(0);
    const result = await scoreProjectAgainstUniverse(
      { ...universe, features: [] },
      { projectName: 'Test' },
      { _callLLM: async () => '' },
    );
    assert.equal(result.scores.length, 0);
    assert.equal(result.overallScore, 0);
  });

  it('parses SCORE lines from LLM response', async () => {
    const universe = makeUniverse(2);
    const scoreResponse = [
      'SCORE|feat-001|9|implemented|Found in src/core/autoforge-loop.ts',
      'SCORE|feat-002|4|partial|Partial implementation in self-improve.ts',
    ].join('\n');

    const result = await scoreProjectAgainstUniverse(
      universe,
      { projectName: 'TestProject' },
      { _callLLM: async () => scoreResponse },
    );

    assert.equal(result.scores.length, 2);
    const s1 = result.scores.find((s) => s.featureId === 'feat-001');
    assert.ok(s1, 'feat-001 scored');
    assert.equal(s1!.score, 9);
    assert.equal(s1!.verdict, 'implemented');
  });

  it('fills in zero scores for features the LLM missed', async () => {
    const universe = makeUniverse(3);
    // LLM only returns score for feat-001
    const scoreResponse = 'SCORE|feat-001|8|implemented|Found it';

    const result = await scoreProjectAgainstUniverse(
      universe,
      { projectName: 'TestProject' },
      { _callLLM: async () => scoreResponse },
    );

    assert.equal(result.scores.length, 3, 'All 3 features have a score');
    const missed = result.scores.filter((s) => s.featureId !== 'feat-001');
    assert.ok(missed.every((s) => s.score === 0 && s.verdict === 'missing'));
  });

  it('computes overallScore as average of all feature scores', async () => {
    const universe = makeUniverse(2);
    const scoreResponse = [
      'SCORE|feat-001|8|implemented|Evidence A',
      'SCORE|feat-002|6|partial|Evidence B',
    ].join('\n');

    const result = await scoreProjectAgainstUniverse(
      universe,
      { projectName: 'TestProject' },
      { _callLLM: async () => scoreResponse },
    );

    assert.equal(result.overallScore, 7.0); // (8+6)/2 = 7.0
  });

  it('counts implemented, partial, missing correctly', async () => {
    const universe = makeUniverse(4);
    const scoreResponse = [
      'SCORE|feat-001|9|implemented|Evidence',
      'SCORE|feat-002|7|implemented|Evidence',
      'SCORE|feat-003|5|partial|Evidence',
      'SCORE|feat-004|2|missing|Evidence',
    ].join('\n');

    const result = await scoreProjectAgainstUniverse(
      universe,
      { projectName: 'TestProject' },
      { _callLLM: async () => scoreResponse },
    );

    assert.equal(result.implementedCount, 2);
    assert.equal(result.partialCount, 1);
    assert.equal(result.missingCount, 1);
    assert.equal(result.coveragePercent, 75); // 3/4 = 75%
  });

  it('handles LLM failure gracefully — returns zero scores', async () => {
    const universe = makeUniverse(2);
    const result = await scoreProjectAgainstUniverse(
      universe,
      { projectName: 'TestProject' },
      { _callLLM: async () => { throw new Error('LLM down'); } },
    );
    assert.equal(result.scores.length, 2);
    assert.ok(result.scores.every((s) => s.score === 0));
  });

  it('processes features in batches of 10', async () => {
    const universe = makeUniverse(25);
    const batchCalls: number[] = [];

    const result = await scoreProjectAgainstUniverse(
      universe,
      { projectName: 'TestProject' },
      {
        _callLLM: async (prompt) => {
          // Count how many SCORE requests per call by counting feature IDs in prompt
          const featureCount = (prompt.match(/\[feat-\d+\]/g) ?? []).length;
          batchCalls.push(featureCount);
          // Return scores for all features in this batch
          return universe.features
            .filter((f) => prompt.includes(f.id))
            .map((f) => `SCORE|${f.id}|7|implemented|Found it`)
            .join('\n');
        },
      },
    );

    assert.ok(batchCalls.length >= 3, `Expected >= 3 batch calls for 25 features, got ${batchCalls.length}`);
    assert.ok(batchCalls.every((c) => c <= 10), 'Each batch should have <= 10 features');
    assert.equal(result.scores.length, 25);
  });
});

// ── Cache I/O ─────────────────────────────────────────────────────────────────

describe('saveFeatureUniverse / loadFeatureUniverse', () => {
  it('round-trips universe through disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feature-universe-test-'));
    try {
      const universe = makeUniverse(3);
      const written: string[] = [];
      await saveFeatureUniverse(universe, tmpDir, async (p, c) => {
        written.push(p);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, c, 'utf-8');
      });
      assert.ok(written.some((p) => p.endsWith('feature-universe.json')));

      const loaded = await loadFeatureUniverse(tmpDir, async (p) => fs.readFile(p, 'utf-8'));
      assert.ok(loaded !== null);
      assert.equal(loaded!.features.length, 3);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it('returns null when universe file does not exist', async () => {
    const result = await loadFeatureUniverse('/nonexistent/path');
    assert.equal(result, null);
  });
});

describe('saveFeatureScores / loadFeatureScores', () => {
  it('round-trips assessment through disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feature-scores-test-'));
    try {
      const universe = makeUniverse(2);
      const scores = makeScores(universe);
      const assessment: FeatureUniverseAssessment = {
        universe, scores,
        overallScore: 8.0, implementedCount: 2, partialCount: 0, missingCount: 0,
        coveragePercent: 100, timestamp: '2026-04-04T00:00:00Z',
      };
      await saveFeatureScores(assessment, tmpDir, async (p, c) => {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, c, 'utf-8');
      });
      const loaded = await loadFeatureScores(tmpDir, async (p) => fs.readFile(p, 'utf-8'));
      assert.ok(loaded !== null);
      assert.equal(loaded!.overallScore, 8.0);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});

// ── buildFeatureForgePrompt ───────────────────────────────────────────────────

describe('buildFeatureForgePrompt', () => {
  it('says Implement for missing features (score < 4)', () => {
    const score: FeatureScore = { featureId: 'feat-001', featureName: 'Circuit breaker', score: 2, evidence: 'Not found', verdict: 'missing' };
    const feature = makeFeatureItem();
    const prompt = buildFeatureForgePrompt(score, feature, 'TestProject');
    assert.ok(prompt.startsWith('Implement'), `Expected "Implement", got: ${prompt.slice(0, 20)}`);
    assert.ok(prompt.includes('Circuit breaker'));
  });

  it('says Improve for partial features (score >= 4)', () => {
    const score: FeatureScore = { featureId: 'feat-001', featureName: 'Circuit breaker', score: 5, evidence: 'Partial', verdict: 'partial' };
    const feature = makeFeatureItem();
    const prompt = buildFeatureForgePrompt(score, feature, 'TestProject');
    assert.ok(prompt.startsWith('Improve'));
  });

  it('includes competitor name and implementation hint', () => {
    const score: FeatureScore = { featureId: 'feat-001', featureName: 'Circuit breaker', score: 0, evidence: 'Not found', verdict: 'missing' };
    const feature = makeFeatureItem({ bestImplementationHint: 'Uses CLOSED/OPEN states' });
    const prompt = buildFeatureForgePrompt(score, feature, 'TestProject');
    assert.ok(prompt.includes('Devin'), 'Should reference competitor');
    assert.ok(prompt.includes('CLOSED/OPEN'), 'Should include implementation hint');
  });
});

// ── formatFeatureUniverseReport ───────────────────────────────────────────────

describe('formatFeatureUniverseReport', () => {
  it('includes header and summary', () => {
    const universe = makeUniverse(3);
    const scores = makeScores(universe, 8);
    const assessment: FeatureUniverseAssessment = {
      universe, scores, overallScore: 8.0,
      implementedCount: 3, partialCount: 0, missingCount: 0,
      coveragePercent: 100, timestamp: '2026-04-04T00:00:00Z',
    };
    const report = formatFeatureUniverseReport(assessment, { minScore: 9.0, featureCoverage: 90 });
    assert.ok(report.includes('Feature Universe Report'));
    assert.ok(report.includes('8.0/10'));
    assert.ok(report.includes('100%'));
  });

  it('shows missing section when features have low scores', () => {
    const universe = makeUniverse(2);
    const scores: FeatureScore[] = [
      { featureId: 'feat-001', featureName: 'Feature 1', score: 9, evidence: 'Found', verdict: 'implemented' },
      { featureId: 'feat-002', featureName: 'Feature 2', score: 0, evidence: 'Not found', verdict: 'missing' },
    ];
    const assessment: FeatureUniverseAssessment = {
      universe, scores, overallScore: 4.5,
      implementedCount: 1, partialCount: 0, missingCount: 1,
      coveragePercent: 50, timestamp: '2026-04-04T00:00:00Z',
    };
    const report = formatFeatureUniverseReport(assessment, { minScore: 9.0, featureCoverage: 90 });
    assert.ok(report.includes('Missing'));
    assert.ok(report.includes('Feature 2'));
  });
});
