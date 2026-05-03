import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalScoreToHarshResult,
  computeCanonicalScore,
  type ScoringDimension,
} from '../src/core/harsh-scorer.js';
import {
  normalizeComparisonToAssessment,
} from '../src/cli/commands/assess.js';
import type { CompetitorComparison } from '../src/core/competitor-scanner.js';
import { runTsxCli } from './helpers/cli-runner.ts';

describe('canonical score determinism', () => {
  it('returns identical results when called twice on the same SHA', async () => {
    const a = await computeCanonicalScore(process.cwd());
    const b = await computeCanonicalScore(process.cwd());

    assert.equal(a.overall, b.overall);
    assert.equal(a.gitSha, b.gitSha);
    assert.equal(a.source, 'canonical-v1');
    assert.equal(b.source, 'canonical-v1');

    for (const k of Object.keys(a.dimensions)) {
      assert.equal(a.dimensions[k as ScoringDimension], b.dimensions[k as ScoringDimension], k);
    }
  });

  it('keeps dimension table values and gap-analysis values internally consistent', async () => {
    const canonical = await computeCanonicalScore(process.cwd());
    const assessment = canonicalScoreToHarshResult(canonical);
    const staleComparison: CompetitorComparison = {
      projectName: 'DanteForge',
      competitorSource: 'dev-tool-default',
      ourDimensions: { ...assessment.dimensions, autonomy: 45 },
      competitors: [
        {
          name: 'GitHub',
          type: 'closed-source',
          scores: { ...assessment.dimensions, autonomy: 70 },
          evidence: {},
        },
      ],
      leaderboard: [
        { name: 'DanteForge', avgScore: canonical.overall * 10, rank: 1 },
        { name: 'GitHub', avgScore: 70, rank: 2 },
      ],
      gapReport: Object.keys(assessment.dimensions).map((dimension) => ({
        dimension: dimension as ScoringDimension,
        ourScore: dimension === 'autonomy' ? 45 : assessment.dimensions[dimension as ScoringDimension],
        bestScore: dimension === 'autonomy' ? 70 : assessment.dimensions[dimension as ScoringDimension],
        bestCompetitor: dimension === 'autonomy' ? 'GitHub' : 'us',
        delta: dimension === 'autonomy' ? 25 : 0,
        severity: dimension === 'autonomy' ? 'critical' : 'leading',
      })),
      overallGap: 25,
      analysisTimestamp: canonical.computedAt,
    };

    const normalized = normalizeComparisonToAssessment(staleComparison, assessment);
    assert.ok(normalized);

    for (const gap of normalized.gapReport) {
      const tableValue = assessment.displayDimensions[gap.dimension];
      const gapValue = gap.ourScore / 10;
      assert.equal(gapValue, tableValue, gap.dimension);
    }
  });

  it('assess --json emits JSON-only canonical score with all 20 dimensions', () => {
    const result = runTsxCli(['assess', '--json'], { timeout: 180000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.equal(result.stderr.trim(), '');

    const parsed = JSON.parse(result.stdout) as {
      overall: number;
      dimensions: Record<string, number>;
      gitSha: string;
      source: string;
    };
    assert.equal(typeof parsed.overall, 'number');
    assert.equal(typeof parsed.gitSha, 'string');
    assert.equal(parsed.source, 'canonical-v1');
    assert.equal(Object.keys(parsed.dimensions).length, 20);
  });
});
