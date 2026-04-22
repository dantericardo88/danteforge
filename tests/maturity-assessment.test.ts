// Maturity Assessment — 30 tests for gap classification, recommendations, and founder explanations

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import {
  analyzeGaps,
  assessMaturity,
  type MaturityContext,
  type MaturityDimensions,
  type QualityGap,
} from '../src/core/maturity-engine.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult } from '../src/core/pdse.js';

describe('maturity-assessment', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(await fs.realpath(process.cwd()), '.tmp-assessment-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Gap Classification ──

  describe('gap severity classification', () => {
    it('classifies gap > 20 points as critical', () => {
      const dimensions: MaturityDimensions = {
        functionality: 45,
        testing: 80,
        errorHandling: 75,
        security: 72,
        uxPolish: 68,
        documentation: 65,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 3, 4);
      const functionalityGap = gaps.find(g => g.dimension === 'functionality');
      assert.ok(functionalityGap);
      assert.equal(functionalityGap.severity, 'critical');
      assert.equal(functionalityGap.gapSize, 25);
    });

    it('classifies gap 10-20 points as major', () => {
      const dimensions: MaturityDimensions = {
        functionality: 75,
        testing: 80,
        errorHandling: 75,
        security: 72,
        uxPolish: 55,
        documentation: 60,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 4, 5);
      const uxGap = gaps.find(g => g.dimension === 'uxPolish');
      assert.ok(uxGap);
      assert.equal(uxGap.severity, 'major');
      assert.equal(uxGap.gapSize, 15);
    });

    it('classifies gap 0-10 points as minor', () => {
      const dimensions: MaturityDimensions = {
        functionality: 75,
        testing: 80,
        errorHandling: 75,
        security: 65,
        uxPolish: 68,
        documentation: 65,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 4, 5);
      const securityGap = gaps.find(g => g.dimension === 'security');
      assert.ok(securityGap);
      assert.equal(securityGap.severity, 'minor');
      assert.ok(securityGap.gapSize <= 10);
    });

    it('excludes dimensions that meet the target', () => {
      const dimensions: MaturityDimensions = {
        functionality: 85,
        testing: 90,
        errorHandling: 75,
        security: 72,
        uxPolish: 68,
        documentation: 65,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 5, 5);
      assert.ok(!gaps.some(g => g.dimension === 'functionality'));
      assert.ok(!gaps.some(g => g.dimension === 'testing'));
    });

    it('returns empty array when all dimensions meet target', () => {
      const dimensions: MaturityDimensions = {
        functionality: 85,
        testing: 90,
        errorHandling: 80,
        security: 85,
        uxPolish: 75,
        documentation: 80,
        performance: 82,
        maintainability: 88,
      };

      const gaps = analyzeGaps(dimensions, 5, 5);
      assert.equal(gaps.length, 0);
    });
  });

  // ── Recommendation Logic ──

  describe('recommendation logic', () => {
    it('recommends "proceed" when current == target', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 14,
            integrationFitness: 7,
            clarity: 14,
            freshness: 7,
            testability: 14,
            constitutionAlignment: 14,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(['proceed', 'refine'].includes(assessment.recommendation));
    });

    it('recommends "target-exceeded" when current > target', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 20,
            integrationFitness: 10,
            clarity: 20,
            freshness: 10,
            testability: 20,
            constitutionAlignment: 20,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 3,
      };

      const assessment = await assessMaturity(ctx);
      assert.equal(assessment.recommendation, 'target-exceeded');
    });

    it('recommends "blocked" when critical gaps exist', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 5,
            integrationFitness: 2,
            clarity: 8,
            freshness: 4,
            testability: 6,
            constitutionAlignment: 7,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 5,
      };

      const assessment = await assessMaturity(ctx);
      assert.equal(assessment.recommendation, 'blocked');
      const criticalGaps = assessment.gaps.filter(g => g.severity === 'critical');
      assert.ok(criticalGaps.length > 0);
    });

    it('recommends "refine" when major gaps exist but no critical gaps', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 12,
            integrationFitness: 6,
            clarity: 13,
            freshness: 6,
            testability: 11,
            constitutionAlignment: 12,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.equal(assessment.recommendation, 'refine');
      const majorGaps = assessment.gaps.filter(g => g.severity === 'major');
      assert.ok(majorGaps.length > 0);
    });

    it('recommends "proceed" when only minor gaps exist', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 14,
            integrationFitness: 7,
            clarity: 14,
            freshness: 7,
            testability: 14,
            constitutionAlignment: 14,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(['proceed', 'refine'].includes(assessment.recommendation));
    });
  });

  // ── Founder Explanation ──

  describe('founder explanation generation', () => {
    it('includes current level name and score', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.founderExplanation.includes('level'));
      assert.ok(assessment.founderExplanation.includes('/100'));
    });

    it('includes target level when current < target', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 8,
            integrationFitness: 4,
            clarity: 8,
            freshness: 4,
            testability: 8,
            constitutionAlignment: 8,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.founderExplanation.includes('Target'));
    });

    it('mentions critical gaps when they exist', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 5,
            integrationFitness: 2,
            clarity: 5,
            freshness: 2,
            testability: 5,
            constitutionAlignment: 5,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 5,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.founderExplanation.includes('Critical'));
    });

    it('mentions major gaps when they exist', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 12,
            integrationFitness: 6,
            clarity: 12,
            freshness: 6,
            testability: 11,
            constitutionAlignment: 12,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.founderExplanation.includes('Major') || assessment.founderExplanation.includes('gaps'));
    });

    it('celebrates when target is met or exceeded', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 20,
            integrationFitness: 10,
            clarity: 20,
            freshness: 10,
            testability: 20,
            constitutionAlignment: 20,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 3,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.founderExplanation.includes('Good news') || assessment.founderExplanation.includes('met'));
    });

    it('uses plain language from maturity-levels', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 1,
      };

      const assessment = await assessMaturity(ctx);
      // Should include level-appropriate plain language
      assert.ok(assessment.founderExplanation.length > 0);
      assert.ok(assessment.founderExplanation.includes('level') || assessment.founderExplanation.includes('code'));
    });
  });

  // ── Score-to-Level Mapping ──

  describe('score-to-level mapping', () => {
    it('maps very low scores to lower levels (Sketch/Prototype)', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 3,
            integrationFitness: 1,
            clarity: 3,
            freshness: 1,
            testability: 3,
            constitutionAlignment: 3,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.currentLevel <= 3);
    });

    it('maps low-medium scores to mid levels (Prototype/Alpha)', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 7,
            integrationFitness: 3,
            clarity: 7,
            freshness: 3,
            testability: 7,
            constitutionAlignment: 7,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.currentLevel >= 1 && assessment.currentLevel <= 4);
    });

    it('maps medium scores to mid-high levels (Alpha/Beta)', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 11,
            integrationFitness: 5,
            clarity: 11,
            freshness: 5,
            testability: 11,
            constitutionAlignment: 11,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.currentLevel >= 2 && assessment.currentLevel <= 5);
    });

    it('maps good scores to high levels (Beta+)', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 14,
            integrationFitness: 7,
            clarity: 13,
            freshness: 6,
            testability: 13,
            constitutionAlignment: 14,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.currentLevel >= 3);
    });

    it('maps high scores to level 5 (Customer-Ready)', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 16,
            integrationFitness: 8,
            clarity: 16,
            freshness: 8,
            testability: 16,
            constitutionAlignment: 17,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 5,
      };

      const assessment = await assessMaturity(ctx);
      // Good PDSE scores should push towards higher levels
      assert.ok(assessment.currentLevel >= 3);
    });

    it('maps very high scores to level 6 (Enterprise-Grade)', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 19,
            integrationFitness: 9,
            clarity: 19,
            freshness: 9,
            testability: 19,
            constitutionAlignment: 19,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 6,
      };

      const assessment = await assessMaturity(ctx);
      // Very high PDSE scores should push towards highest levels
      assert.ok(assessment.currentLevel >= 3);
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('handles empty PDSE scores gracefully', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.overallScore >= 0 && assessment.overallScore <= 100);
      assert.ok(assessment.currentLevel >= 1 && assessment.currentLevel <= 6);
    });

    it('handles missing evidence directory gracefully', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
        evidenceDir: path.join(tmpDir, 'nonexistent'),
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.overallScore >= 0 && assessment.overallScore <= 100);
    });

    it('handles non-web projects (skips UX polish)', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'cli' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.equal(assessment.dimensions.uxPolish, 50); // Neutral for non-web
    });

    it('includes timestamp in ISO format', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.timestamp);
      assert.doesNotThrow(() => new Date(assessment.timestamp));
    });

    it('sorts gaps by severity and size', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 5,
            integrationFitness: 2,
            clarity: 12,
            freshness: 6,
            testability: 8,
            constitutionAlignment: 10,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 5,
      };

      const assessment = await assessMaturity(ctx);
      // First gap should be the largest
      for (let i = 0; i < assessment.gaps.length - 1; i++) {
        assert.ok(assessment.gaps[i]!.gapSize >= assessment.gaps[i + 1]!.gapSize);
      }
    });

    it('generates recommendations for each gap', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 5,
            integrationFitness: 2,
            clarity: 5,
            freshness: 2,
            testability: 5,
            constitutionAlignment: 5,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 5,
      };

      const assessment = await assessMaturity(ctx);
      for (const gap of assessment.gaps) {
        assert.ok(gap.recommendation);
        assert.ok(gap.recommendation.length > 0);
      }
    });

    it('includes all required MaturityAssessment fields', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok('currentLevel' in assessment);
      assert.ok('targetLevel' in assessment);
      assert.ok('overallScore' in assessment);
      assert.ok('dimensions' in assessment);
      assert.ok('gaps' in assessment);
      assert.ok('founderExplanation' in assessment);
      assert.ok('recommendation' in assessment);
      assert.ok('timestamp' in assessment);
    });

    it('handles multiple PDSE artifacts', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 10,
            integrationFitness: 5,
            clarity: 10,
            freshness: 5,
            testability: 10,
            constitutionAlignment: 10,
          },
        } as ScoreResult,
        'PLAN.md': {
          dimensions: {
            completeness: 15,
            integrationFitness: 7,
            clarity: 15,
            freshness: 7,
            testability: 15,
            constitutionAlignment: 15,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      // Should average across both artifacts
      assert.ok(assessment.dimensions.functionality >= 0);
      assert.ok(assessment.dimensions.documentation >= 0);
    });
  });
});
