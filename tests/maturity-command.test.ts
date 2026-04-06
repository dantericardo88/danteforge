// Maturity Command — 12 tests for CLI output, JSON mode, and exit codes

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { maturity, type MaturityOptions } from '../src/cli/commands/maturity.js';
import type { DanteState } from '../src/core/state.js';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';

describe('maturity-command', () => {
  let tmpDir: string;
  let originalExitCode: number | undefined;
  let stdoutOutput: string;
  let originalStdoutWrite: typeof process.stdout.write;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(await fs.realpath(process.cwd()), '.tmp-maturity-cmd-'));
    originalExitCode = process.exitCode;
    process.exitCode = 0;

    // Capture stdout
    stdoutOutput = '';
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => {
      stdoutOutput += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    process.stdout.write = originalStdoutWrite;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('basic execution', () => {
    it('runs maturity assessment with default target (Beta)', async () => {
      const mockState: DanteState = {
        projectType: 'web',
      } as DanteState;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 3,
        targetLevel: 4,
        overallScore: 58,
        dimensions: {
          functionality: 75,
          testing: 82,
          errorHandling: 65,
          security: 70,
          uxPolish: 60,
          documentation: 55,
          performance: 70,
          maintainability: 68,
        },
        gaps: [],
        founderExplanation: 'Your code is at Alpha level.',
        recommendation: 'refine',
        timestamp: new Date().toISOString(),
      };

      const options: MaturityOptions = {
        cwd: tmpDir,
        _loadState: async () => mockState,
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => mockAssessment,
      };

      await maturity(options);

      assert.equal(process.exitCode, 0);
    });

    it('uses preset to set target level', async () => {
      const mockState: DanteState = {
        projectType: 'web',
      } as DanteState;

      let capturedTargetLevel: number | undefined;

      const options: MaturityOptions = {
        preset: 'blaze',
        cwd: tmpDir,
        _loadState: async () => mockState,
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async (ctx) => {
          capturedTargetLevel = ctx.targetLevel;
          return {
            currentLevel: 4,
            targetLevel: 5,
            overallScore: 68,
            dimensions: {
              functionality: 75,
              testing: 82,
              errorHandling: 65,
              security: 70,
              uxPolish: 60,
              documentation: 55,
              performance: 70,
              maintainability: 68,
            },
            gaps: [],
            founderExplanation: 'Your code is at Beta level.',
            recommendation: 'refine',
            timestamp: new Date().toISOString(),
          };
        },
      };

      await maturity(options);

      assert.equal(capturedTargetLevel, 5); // blaze targets Customer-Ready (level 5)
    });

    it('exits with code 1 for unknown preset', async () => {
      const options: MaturityOptions = {
        preset: 'unknown-preset',
        cwd: tmpDir,
        _loadState: async () => ({ projectType: 'web' } as DanteState),
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => ({} as MaturityAssessment),
      };

      await maturity(options);

      assert.equal(process.exitCode, 1);
    });

    it('exits with code 1 when recommendation is "blocked"', async () => {
      const mockState: DanteState = {
        projectType: 'web',
      } as DanteState;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 2,
        targetLevel: 5,
        overallScore: 35,
        dimensions: {
          functionality: 45,
          testing: 45,
          errorHandling: 35,
          security: 30,
          uxPolish: 28,
          documentation: 32,
          performance: 40,
          maintainability: 38,
        },
        gaps: [
          {
            dimension: 'functionality',
            currentScore: 45,
            targetScore: 70,
            gapSize: 25,
            severity: 'critical',
            recommendation: 'Complete missing features',
          },
        ],
        founderExplanation: 'Critical gaps detected.',
        recommendation: 'blocked',
        timestamp: new Date().toISOString(),
      };

      const options: MaturityOptions = {
        cwd: tmpDir,
        _loadState: async () => mockState,
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => mockAssessment,
      };

      await maturity(options);

      assert.equal(process.exitCode, 1);
    });
  });

  describe('JSON output mode', () => {
    it('outputs JSON when --json flag is set', async () => {
      const mockState: DanteState = {
        projectType: 'web',
      } as DanteState;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 4,
        targetLevel: 4,
        overallScore: 68,
        dimensions: {
          functionality: 75,
          testing: 82,
          errorHandling: 65,
          security: 70,
          uxPolish: 60,
          documentation: 55,
          performance: 70,
          maintainability: 68,
        },
        gaps: [],
        founderExplanation: 'Your code is at Beta level.',
        recommendation: 'proceed',
        timestamp: '2026-04-02T10:00:00.000Z',
      };

      const options: MaturityOptions = {
        json: true,
        cwd: tmpDir,
        _loadState: async () => mockState,
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => mockAssessment,
      };

      await maturity(options);

      assert.ok(stdoutOutput.includes('"currentLevel": 4'));
      assert.ok(stdoutOutput.includes('"targetLevel": 4'));
      assert.ok(stdoutOutput.includes('"overallScore": 68'));
      assert.ok(stdoutOutput.includes('"recommendation": "proceed"'));
    });

    it('outputs valid JSON that can be parsed', async () => {
      const mockState: DanteState = {
        projectType: 'web',
      } as DanteState;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 3,
        targetLevel: 4,
        overallScore: 58,
        dimensions: {
          functionality: 75,
          testing: 82,
          errorHandling: 65,
          security: 70,
          uxPolish: 60,
          documentation: 55,
          performance: 70,
          maintainability: 68,
        },
        gaps: [
          {
            dimension: 'documentation',
            currentScore: 55,
            targetScore: 70,
            gapSize: 15,
            severity: 'major',
            recommendation: 'Improve clarity',
          },
        ],
        founderExplanation: 'Your code is at Alpha level.',
        recommendation: 'refine',
        timestamp: '2026-04-02T10:00:00.000Z',
      };

      const options: MaturityOptions = {
        json: true,
        cwd: tmpDir,
        _loadState: async () => mockState,
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => mockAssessment,
      };

      await maturity(options);

      // Extract JSON from output (may have logger prefix)
      const jsonMatch = stdoutOutput.match(/\{[\s\S]*\}/);
      assert.ok(jsonMatch, 'Should contain JSON output');

      const parsed = JSON.parse(jsonMatch[0]!);
      assert.equal(parsed.currentLevel, 3);
      assert.equal(parsed.recommendation, 'refine');
      assert.equal(parsed.gaps.length, 1);
    });
  });

  describe('markdown report generation', () => {
    it('writes markdown report to evidence directory', async () => {
      const mockState: DanteState = {
        projectType: 'web',
      } as DanteState;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 4,
        targetLevel: 4,
        overallScore: 68,
        dimensions: {
          functionality: 75,
          testing: 82,
          errorHandling: 65,
          security: 70,
          uxPolish: 60,
          documentation: 55,
          performance: 70,
          maintainability: 68,
        },
        gaps: [],
        founderExplanation: 'Your code is at Beta level.',
        recommendation: 'proceed',
        timestamp: new Date().toISOString(),
      };

      const options: MaturityOptions = {
        cwd: tmpDir,
        _loadState: async () => mockState,
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => mockAssessment,
      };

      await maturity(options);

      const reportPath = path.join(tmpDir, '.danteforge', 'evidence', 'maturity', 'latest.md');
      const reportExists = await fs.access(reportPath).then(() => true).catch(() => false);
      assert.ok(reportExists, 'Markdown report should exist');

      const reportContent = await fs.readFile(reportPath, 'utf8');
      assert.ok(reportContent.includes('# DanteForge Maturity Assessment'));
      assert.ok(reportContent.includes('Beta'));
      assert.ok(reportContent.includes('68/100'));
    });

    it('includes gaps in markdown report', async () => {
      const mockState: DanteState = {
        projectType: 'web',
      } as DanteState;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 3,
        targetLevel: 4,
        overallScore: 58,
        dimensions: {
          functionality: 75,
          testing: 82,
          errorHandling: 65,
          security: 70,
          uxPolish: 60,
          documentation: 55,
          performance: 70,
          maintainability: 68,
        },
        gaps: [
          {
            dimension: 'documentation',
            currentScore: 55,
            targetScore: 70,
            gapSize: 15,
            severity: 'major',
            recommendation: 'Improve clarity',
          },
        ],
        founderExplanation: 'Your code is at Alpha level.',
        recommendation: 'refine',
        timestamp: new Date().toISOString(),
      };

      const options: MaturityOptions = {
        cwd: tmpDir,
        _loadState: async () => mockState,
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => mockAssessment,
      };

      await maturity(options);

      const reportPath = path.join(tmpDir, '.danteforge', 'evidence', 'maturity', 'latest.md');
      const reportContent = await fs.readFile(reportPath, 'utf8');
      // Should include gap information
      assert.ok(reportContent.includes('Documentation') || reportContent.includes('documentation'));
      assert.ok(reportContent.includes('Improve clarity') || reportContent.includes('Quality Gaps'));
    });
  });

  describe('error handling', () => {
    it('exits with code 1 on loadState failure', async () => {
      const options: MaturityOptions = {
        cwd: tmpDir,
        _loadState: async () => {
          throw new Error('State load failed');
        },
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => ({} as MaturityAssessment),
      };

      await maturity(options);

      assert.equal(process.exitCode, 1);
    });

    it('exits with code 1 on assessment failure', async () => {
      const options: MaturityOptions = {
        cwd: tmpDir,
        _loadState: async () => ({ projectType: 'web' } as DanteState),
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => {
          throw new Error('Assessment failed');
        },
      };

      await maturity(options);

      assert.equal(process.exitCode, 1);
    });

    it('continues even if markdown report write fails', async () => {
      const mockState: DanteState = {
        projectType: 'web',
      } as DanteState;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 4,
        targetLevel: 4,
        overallScore: 68,
        dimensions: {
          functionality: 75,
          testing: 82,
          errorHandling: 65,
          security: 70,
          uxPolish: 60,
          documentation: 55,
          performance: 70,
          maintainability: 68,
        },
        gaps: [],
        founderExplanation: 'Your code is at Beta level.',
        recommendation: 'proceed',
        timestamp: new Date().toISOString(),
      };

      const options: MaturityOptions = {
        cwd: '/nonexistent-readonly-dir',
        _loadState: async () => mockState,
        _scoreArtifacts: async () => ({}),
        _assessMaturity: async () => mockAssessment,
      };

      await maturity(options);

      // Should still exit 0 (proceeds despite report write failure)
      assert.equal(process.exitCode, 0);
    });
  });
});
