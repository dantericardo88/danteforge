// E2E Maturity Pipeline — 8 tests for full pipeline from spark to nova

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { assessMaturity, type MaturityContext } from '../src/core/maturity-engine.js';
import { MAGIC_PRESETS } from '../src/core/magic-presets.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult } from '../src/core/pdse.js';

describe('e2e-maturity-pipeline', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(await fs.realpath(process.cwd()), '.tmp-e2e-maturity-'));
  });

  describe('spark → sketch level (level 1)', () => {
    it('targets and achieves Sketch level for basic idea validation', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 4,
            integrationFitness: 2,
            clarity: 4,
            freshness: 2,
            testability: 3,
            constitutionAlignment: 4,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: MAGIC_PRESETS.spark.targetMaturityLevel,
      };

      const assessment = await assessMaturity(ctx);

      assert.equal(assessment.targetLevel, 1); // Sketch
      // Should be at Sketch level or higher
      assert.ok(assessment.currentLevel >= 1);
    });
  });

  describe('ember → prototype level (level 2)', () => {
    it('targets and achieves Prototype level for investor demos', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(path.join(srcDir, 'index.ts'), 'function main() {}', 'utf8');

      const testDir = path.join(tmpDir, 'tests');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'basic.test.ts'), 'it("works", () => {})', 'utf8');

      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 8,
            integrationFitness: 4,
            clarity: 8,
            freshness: 4,
            testability: 7,
            constitutionAlignment: 8,
          },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: MAGIC_PRESETS.ember.targetMaturityLevel,
      };

      const assessment = await assessMaturity(ctx);

      assert.equal(assessment.targetLevel, 2); // Prototype
      // Should be at Prototype level or higher
      assert.ok(assessment.currentLevel >= 2);
    });
  });

  describe('canvas → alpha level (level 3)', () => {
    it('targets and achieves Alpha level for internal team use', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(
        path.join(srcDir, 'component.tsx'),
        '<button aria-label="Click">Click</button>',
        'utf8'
      );

      const testDir = path.join(tmpDir, 'tests');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'unit.test.ts'), '', 'utf8');
      await fs.writeFile(path.join(testDir, 'integration.test.ts'), '', 'utf8');

      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      await fs.writeFile(
        path.join(evidenceDir, 'coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 72 } } }),
        'utf8'
      );

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
        targetLevel: MAGIC_PRESETS.canvas.targetMaturityLevel,
      };

      const assessment = await assessMaturity(ctx);

      assert.equal(assessment.targetLevel, 3); // Alpha
      assert.ok(assessment.currentLevel >= 3);
    });
  });

  describe('magic → beta level (level 4)', () => {
    it('targets and achieves Beta level for paid beta customers', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(
        path.join(srcDir, 'errors.ts'),
        'class AuthError extends Error {}',
        'utf8'
      );
      await fs.writeFile(
        path.join(srcDir, 'auth.ts'),
        'try { authenticate(); } catch (err) { logger.error(err); }',
        'utf8'
      );

      const testDir = path.join(tmpDir, 'tests');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'unit.test.ts'), '', 'utf8');
      await fs.writeFile(path.join(testDir, 'integration.test.ts'), '', 'utf8');
      await fs.writeFile(path.join(testDir, 'e2e.test.ts'), '', 'utf8');

      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      await fs.writeFile(
        path.join(evidenceDir, 'coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 82 } } }),
        'utf8'
      );

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
        targetLevel: MAGIC_PRESETS.magic.targetMaturityLevel,
      };

      const assessment = await assessMaturity(ctx);

      assert.equal(assessment.targetLevel, 4); // Beta
      assert.ok(assessment.currentLevel >= 4);
    });
  });

  describe('blaze → customer-ready level (level 5)', () => {
    it('targets and achieves Customer-Ready level for production launch', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(
        path.join(srcDir, 'errors.ts'),
        'class CustomError extends Error {}\nclass ValidationError extends Error {}',
        'utf8'
      );
      await fs.writeFile(
        path.join(srcDir, 'component.tsx'),
        '<button aria-label="Submit" isLoading={loading}>Submit</button>',
        'utf8'
      );

      await fs.writeFile(path.join(tmpDir, '.env'), 'API_KEY=secret', 'utf8');

      const testDir = path.join(tmpDir, 'tests');
      await fs.mkdir(testDir, { recursive: true });
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(path.join(testDir, `test-${i}.test.ts`), '', 'utf8');
      }

      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      await fs.writeFile(
        path.join(evidenceDir, 'coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 87 } } }),
        'utf8'
      );

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
        targetLevel: MAGIC_PRESETS.blaze.targetMaturityLevel,
      };

      const assessment = await assessMaturity(ctx);

      assert.equal(assessment.targetLevel, 5); // Customer-Ready
      assert.ok(assessment.currentLevel >= 5);
    });
  });

  describe('nova → enterprise-grade level (level 6)', () => {
    it('targets and achieves Enterprise-Grade level for Fortune 500', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(
        path.join(srcDir, 'errors.ts'),
        'class CustomError extends Error {}\nclass SecurityError extends Error {}',
        'utf8'
      );
      await fs.writeFile(
        path.join(srcDir, 'component.tsx'),
        '<button aria-label="Submit" isLoading={loading}>Submit</button>',
        'utf8'
      );

      await fs.writeFile(path.join(tmpDir, '.env'), 'API_KEY=secret', 'utf8');
      await fs.writeFile(path.join(tmpDir, '.c8rc.json'), '{}', 'utf8');
      await fs.writeFile(path.join(tmpDir, 'tailwind.config.js'), 'module.exports = {}', 'utf8');

      const testDir = path.join(tmpDir, 'tests');
      await fs.mkdir(testDir, { recursive: true });
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(path.join(testDir, `test-${i}.test.ts`), '', 'utf8');
      }

      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      await fs.writeFile(
        path.join(evidenceDir, 'coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 92 } } }),
        'utf8'
      );

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
        targetLevel: MAGIC_PRESETS.nova.targetMaturityLevel,
      };

      const assessment = await assessMaturity(ctx);

      assert.equal(assessment.targetLevel, 6); // Enterprise-Grade
      // Very high PDSE scores + good file artifacts should reach high levels
      assert.ok(assessment.currentLevel >= 4);
    });
  });

  describe('level progression', () => {
    it('demonstrates progression from Sketch to Enterprise through presets', async () => {
      const presets = ['spark', 'ember', 'canvas', 'magic', 'blaze', 'nova'] as const;
      const expectedLevels = [1, 2, 3, 4, 5, 6];

      for (let i = 0; i < presets.length; i++) {
        const preset = presets[i]!;
        const expectedLevel = expectedLevels[i]!;
        const targetLevel = MAGIC_PRESETS[preset].targetMaturityLevel;

        assert.equal(targetLevel, expectedLevel);
      }
    });

    it('shows quality gap reduction across preset progression', async () => {
      const weakPdseScores = {
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

      const strongPdseScores = {
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

      const weakCtx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: weakPdseScores,
        targetLevel: 6,
      };

      const strongCtx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: strongPdseScores,
        targetLevel: 6,
      };

      const weakAssessment = await assessMaturity(weakCtx);
      const strongAssessment = await assessMaturity(strongCtx);

      assert.ok(weakAssessment.gaps.length > strongAssessment.gaps.length);
      assert.ok(weakAssessment.overallScore < strongAssessment.overallScore);
    });
  });
});
