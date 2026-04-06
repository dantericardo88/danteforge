// Maturity Engine — 40 tests for 8-dimension scoring and assessment

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import {
  scoreMaturityDimensions,
  analyzeGaps,
  assessMaturity,
  type MaturityContext,
  type MaturityDimensions,
  type GapSeverity,
} from '../src/core/maturity-engine.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult } from '../src/core/pdse.js';

describe('maturity-engine', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(await fs.realpath(process.cwd()), '.tmp-maturity-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Functionality ──

  describe('scoreFunctionality', () => {
    it('returns 50 (neutral) when no PDSE scores exist', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.functionality, 50);
    });

    it('scores based on PDSE completeness and integrationFitness', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: { completeness: 18, integrationFitness: 9 },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // (18/20)*70 + (9/10)*30 = 63 + 27 = 90
      assert.equal(dimensions.functionality, 90);
    });

    it('averages across multiple artifacts', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: { completeness: 20, integrationFitness: 10 },
        } as ScoreResult,
        'PLAN.md': {
          dimensions: { completeness: 10, integrationFitness: 5 },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // avg completeness: 15, avg integration: 7.5
      // (15/20)*70 + (7.5/10)*30 = 52.5 + 22.5 = 75
      assert.equal(dimensions.functionality, 75);
    });
  });

  // ── Testing ──

  describe('scoreTesting', () => {
    it('returns 50 (neutral) when no test infrastructure exists', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 50);
    });

    it('adds 10 points for .c8rc.json', async () => {
      const c8Path = path.join(tmpDir, '.c8rc.json');
      await fs.writeFile(c8Path, '{}', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 60); // 50 + 10
    });

    it('adds points for test files', async () => {
      const testDir = path.join(tmpDir, 'tests');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'foo.test.ts'), '', 'utf8');
      await fs.writeFile(path.join(testDir, 'bar.test.ts'), '', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 54); // 50 + 4 (2 files * 2)
    });

    it('adds 20 points for 90%+ coverage', async () => {
      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      const coveragePath = path.join(evidenceDir, 'coverage-summary.json');
      await fs.writeFile(coveragePath, JSON.stringify({ total: { lines: { pct: 92 } } }), 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 70); // 50 + 20
    });

    it('adds 15 points for 85%+ coverage', async () => {
      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      const coveragePath = path.join(evidenceDir, 'coverage-summary.json');
      await fs.writeFile(coveragePath, JSON.stringify({ total: { lines: { pct: 87 } } }), 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 65); // 50 + 15
    });

    it('handles invalid coverage JSON gracefully', async () => {
      const evidenceDir = path.join(tmpDir, '.danteforge', 'evidence');
      await fs.mkdir(evidenceDir, { recursive: true });
      const coveragePath = path.join(evidenceDir, 'coverage-summary.json');
      await fs.writeFile(coveragePath, '{invalid json', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.testing, 50); // Neutral default
    });
  });

  // ── Error Handling ──

  describe('scoreErrorHandling', () => {
    it('returns 50 when no src directory exists', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.errorHandling, 50);
    });

    it('scores based on try/catch and throw ratio', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'test.ts');
      const content = `
        function foo() { try { throw new Error(); } catch {} }
        function bar() { throw new Error(); }
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 2 functions, 1 try, 2 throws => ratio 3/2 = 1.5 => 150 => capped at 100
      assert.equal(dimensions.errorHandling, 100);
    });

    it('adds 10 points for custom error classes', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'errors.ts');
      const content = `
        class CustomError extends Error {}
        function foo() {}
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 1 function, 0 try/throw => 0 base + 10 custom error bonus = 10
      assert.equal(dimensions.errorHandling, 10);
    });
  });

  // ── Security ──

  describe('scoreSecurity', () => {
    it('starts with 70 baseline', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.security, 70);
    });

    it('penalizes dangerous patterns', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'bad.ts');
      const content = `
        eval('alert(1)');
        element.innerHTML = '<script>alert(1)</script>';
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 70 - (2 patterns * 10) = 50
      assert.equal(dimensions.security, 50);
    });

    it('adds 10 points for .env file', async () => {
      const envPath = path.join(tmpDir, '.env');
      await fs.writeFile(envPath, 'API_KEY=secret', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.security, 80); // 70 + 10
    });

    it('detects SQL injection risks', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'db.ts');
      const content = `
        db.query('SELECT * FROM users WHERE id = ' + userId);
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 70 - 10 (SQL without parameterization) = 60
      assert.equal(dimensions.security, 60);
    });
  });

  // ── UX Polish ──

  describe('scoreUxPolish', () => {
    it('returns 50 for non-web projects', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'cli' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.uxPolish, 50);
    });

    it('adds points for loading states', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'component.tsx');
      const content = `
        const [isLoading, setIsLoading] = useState(false);
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.uxPolish, 65); // 50 + 15
    });

    it('adds points for ARIA labels', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'button.tsx');
      const content = `
        <button aria-label="Close">X</button>
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.uxPolish, 65); // 50 + 15
    });

    it('adds points for Tailwind config', async () => {
      const tailwindPath = path.join(tmpDir, 'tailwind.config.js');
      await fs.writeFile(tailwindPath, 'module.exports = {}', 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
        _readFile: async (p: string) => {
          if (p === tailwindPath) return 'module.exports = {}';
          throw new Error('Not found');
        },
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.uxPolish, 60); // 50 + 10
    });
  });

  // ── Documentation ──

  describe('scoreDocumentation', () => {
    it('returns 50 when no PDSE scores exist', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.documentation, 50);
    });

    it('scores based on PDSE clarity and freshness', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: { clarity: 18, freshness: 9 },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // (18/20)*70 + (9/10)*30 = 63 + 27 = 90
      assert.equal(dimensions.documentation, 90);
    });
  });

  // ── Performance ──

  describe('scorePerformance', () => {
    it('starts with 70 baseline', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.performance, 70);
    });

    it('penalizes nested loops', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'slow.ts');
      const content = `
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            sum += arr[i][j];
          }
        }
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 70 - 5 = 65
      assert.equal(dimensions.performance, 65);
    });

    it('penalizes SELECT *', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'db.ts');
      const content = `
        db.query('SELECT * FROM users');
      `;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 70 - 5 = 65
      assert.equal(dimensions.performance, 65);
    });
  });

  // ── Maintainability ──

  describe('scoreMaintainability', () => {
    it('returns 50 when no PDSE scores exist', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      assert.equal(dimensions.maintainability, 50);
    });

    it('scores based on PDSE testability and constitution alignment', async () => {
      const pdseScores = {
        'PLAN.md': {
          dimensions: { testability: 18, constitutionAlignment: 16 },
        } as ScoreResult,
      };

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores,
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // (18 + 16) / 40 * 100 = 85
      assert.equal(dimensions.maintainability, 85);
    });

    it('penalizes large functions (>100 LOC)', async () => {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, 'large.ts');
      const lines = Array(120).fill('console.log("line");').join('\n');
      const content = `function huge() {\n${lines}\n}`;
      await fs.writeFile(filePath, content, 'utf8');

      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const dimensions = await scoreMaturityDimensions(ctx);
      // 50 - 5 (1 large function) = 45
      assert.equal(dimensions.maintainability, 45);
    });
  });

  // ── Gap Analysis ──

  describe('analyzeGaps', () => {
    it('classifies critical gaps (>20 points)', () => {
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
      const criticalGaps = gaps.filter(g => g.severity === 'critical');
      assert.equal(criticalGaps.length, 1);
      assert.equal(criticalGaps[0]!.dimension, 'functionality');
      assert.equal(criticalGaps[0]!.gapSize, 25);
    });

    it('classifies major gaps (10-20 points)', () => {
      const dimensions: MaturityDimensions = {
        functionality: 75,
        testing: 80,
        errorHandling: 75,
        security: 72,
        uxPolish: 55,
        documentation: 58,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 4, 5);
      const majorGaps = gaps.filter(g => g.severity === 'major');
      assert.equal(majorGaps.length, 2);
      assert.ok(majorGaps.some(g => g.dimension === 'uxPolish'));
      assert.ok(majorGaps.some(g => g.dimension === 'documentation'));
    });

    it('classifies minor gaps (0-10 points)', () => {
      const dimensions: MaturityDimensions = {
        functionality: 75,
        testing: 80,
        errorHandling: 75,
        security: 72,
        uxPolish: 68,
        documentation: 65,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 4, 5);
      const minorGaps = gaps.filter(g => g.severity === 'minor');
      assert.ok(minorGaps.length > 0);
    });

    it('sorts gaps by size (largest first)', () => {
      const dimensions: MaturityDimensions = {
        functionality: 45,
        testing: 55,
        errorHandling: 65,
        security: 72,
        uxPolish: 68,
        documentation: 50,
        performance: 70,
        maintainability: 73,
      };

      const gaps = analyzeGaps(dimensions, 3, 4);
      assert.ok(gaps[0]!.gapSize >= gaps[1]!.gapSize);
      assert.ok(gaps[1]!.gapSize >= gaps[2]!.gapSize);
    });
  });

  // ── Full Assessment ──

  describe('assessMaturity', () => {
    it('computes weighted average across 8 dimensions', async () => {
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
      // Assessment should compute weighted average across all 8 dimensions
      assert.ok(assessment.overallScore >= 0 && assessment.overallScore <= 100);
      assert.ok(assessment.currentLevel >= 1 && assessment.currentLevel <= 6);
      assert.equal(assessment.targetLevel, 4);
      // Verify all dimensions are present
      assert.ok(assessment.dimensions.functionality);
      assert.ok(assessment.dimensions.testing);
      assert.ok(assessment.dimensions.errorHandling);
      assert.ok(assessment.dimensions.security);
      assert.ok(assessment.dimensions.uxPolish);
      assert.ok(assessment.dimensions.documentation);
      assert.ok(assessment.dimensions.performance);
      assert.ok(assessment.dimensions.maintainability);
    });

    it('generates founder explanation', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(assessment.founderExplanation.length > 0);
      assert.ok(assessment.founderExplanation.includes('level'));
    });

    it('returns "proceed" when current >= target', async () => {
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
        state: { projectType: 'cli' } as DanteState,
        pdseScores,
        targetLevel: 2,
      };

      const assessment = await assessMaturity(ctx);
      assert.ok(['proceed', 'target-exceeded'].includes(assessment.recommendation));
    });

    it('returns "blocked" when critical gaps exist', async () => {
      const pdseScores = {
        'SPEC.md': {
          dimensions: {
            completeness: 5,
            integrationFitness: 3,
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
    });

    it('returns "refine" when major gaps exist but no critical gaps', async () => {
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
    });

    it('includes timestamp in assessment', async () => {
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

    it('computes gaps for all dimensions below threshold', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 6,
      };

      const assessment = await assessMaturity(ctx);
      // With neutral scores (50/50), all dimensions should have gaps vs level 6
      assert.ok(assessment.gaps.length > 0);
    });

    it('returns consistent maturity levels for same input', async () => {
      const ctx: MaturityContext = {
        cwd: tmpDir,
        state: { projectType: 'web' } as DanteState,
        pdseScores: {},
        targetLevel: 4,
      };

      const assessment1 = await assessMaturity(ctx);
      const assessment2 = await assessMaturity(ctx);
      assert.equal(assessment1.currentLevel, assessment2.currentLevel);
    });
  });
});
