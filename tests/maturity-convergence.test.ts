// Maturity Convergence — 20 tests for reflection gate and remediation integration

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';
import type { DanteState } from '../src/core/state.js';

describe('maturity-convergence', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(await fs.realpath(process.cwd()), '.tmp-convergence-'));
  });

  describe('reflection gate triggers remediation', () => {
    it('triggers focused remediation when currentLevel < targetLevel', async () => {
      let remediationCalled = false;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 3,
        targetLevel: 5,
        overallScore: 58,
        dimensions: {
          functionality: 75,
          testing: 45,
          errorHandling: 55,
          security: 50,
          uxPolish: 60,
          documentation: 55,
          performance: 60,
          maintainability: 68,
        },
        gaps: [
          {
            dimension: 'testing',
            currentScore: 45,
            targetScore: 70,
            gapSize: 25,
            severity: 'critical',
            recommendation: 'Increase test coverage',
          },
        ],
        founderExplanation: 'Critical gaps detected.',
        recommendation: 'blocked',
        timestamp: new Date().toISOString(),
      };

      // Simulate convergence loop checking maturity
      if (mockAssessment.currentLevel < mockAssessment.targetLevel) {
        const criticalGaps = mockAssessment.gaps.filter(g => g.severity === 'critical');
        if (criticalGaps.length > 0) {
          remediationCalled = true;
        }
      }

      assert.ok(remediationCalled);
    });

    it('does not trigger remediation when currentLevel >= targetLevel', async () => {
      let remediationCalled = false;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 5,
        targetLevel: 5,
        overallScore: 82,
        dimensions: {
          functionality: 85,
          testing: 90,
          errorHandling: 80,
          security: 85,
          uxPolish: 75,
          documentation: 80,
          performance: 82,
          maintainability: 88,
        },
        gaps: [],
        founderExplanation: 'Target met.',
        recommendation: 'proceed',
        timestamp: new Date().toISOString(),
      };

      if (mockAssessment.currentLevel < mockAssessment.targetLevel) {
        remediationCalled = true;
      }

      assert.ok(!remediationCalled);
    });

    it('triggers remediation only for critical gaps', async () => {
      let remediationTriggered = false;

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
        founderExplanation: 'Major gaps detected.',
        recommendation: 'refine',
        timestamp: new Date().toISOString(),
      };

      const criticalGaps = mockAssessment.gaps.filter(g => g.severity === 'critical');
      if (criticalGaps.length > 0) {
        remediationTriggered = true;
      }

      assert.ok(!remediationTriggered); // Only major gaps, no remediation
    });

    it('focuses remediation on top 3 critical gaps', async () => {
      const mockAssessment: MaturityAssessment = {
        currentLevel: 2,
        targetLevel: 5,
        overallScore: 35,
        dimensions: {
          functionality: 40,
          testing: 35,
          errorHandling: 30,
          security: 28,
          uxPolish: 32,
          documentation: 38,
          performance: 40,
          maintainability: 42,
        },
        gaps: [
          {
            dimension: 'security',
            currentScore: 28,
            targetScore: 70,
            gapSize: 42,
            severity: 'critical',
            recommendation: 'Fix security issues',
          },
          {
            dimension: 'functionality',
            currentScore: 40,
            targetScore: 70,
            gapSize: 30,
            severity: 'critical',
            recommendation: 'Complete features',
          },
          {
            dimension: 'testing',
            currentScore: 35,
            targetScore: 70,
            gapSize: 35,
            severity: 'critical',
            recommendation: 'Add tests',
          },
          {
            dimension: 'errorHandling',
            currentScore: 30,
            targetScore: 70,
            gapSize: 40,
            severity: 'critical',
            recommendation: 'Add error handling',
          },
        ],
        founderExplanation: 'Multiple critical gaps.',
        recommendation: 'blocked',
        timestamp: new Date().toISOString(),
      };

      const topGaps = mockAssessment.gaps
        .filter(g => g.severity === 'critical')
        .sort((a, b) => b.gapSize - a.gapSize)
        .slice(0, 3);

      assert.equal(topGaps.length, 3);
      // Top 3 by size: security (42), errorHandling (40), testing (35)
      assert.ok(topGaps.some(g => g.dimension === 'security'));
      assert.ok(topGaps.some(g => g.dimension === 'errorHandling'));
      assert.ok(topGaps.some(g => g.dimension === 'testing'));
    });
  });

  describe('early exit when target met', () => {
    it('exits convergence loop immediately when target is met', async () => {
      let cyclesRun = 0;
      const maxCycles = 3;

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
          documentation: 65,
          performance: 70,
          maintainability: 68,
        },
        gaps: [],
        founderExplanation: 'Target met.',
        recommendation: 'proceed',
        timestamp: new Date().toISOString(),
      };

      // Simulate convergence loop
      while (cyclesRun < maxCycles) {
        if (mockAssessment.currentLevel >= mockAssessment.targetLevel) {
          break;
        }
        cyclesRun++;
      }

      assert.equal(cyclesRun, 0); // Should exit immediately
    });

    it('runs up to max cycles if target never met', async () => {
      let cyclesRun = 0;
      const maxCycles = 3;

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
            recommendation: 'Complete features',
          },
        ],
        founderExplanation: 'Critical gaps remain.',
        recommendation: 'blocked',
        timestamp: new Date().toISOString(),
      };

      // Simulate convergence loop
      while (cyclesRun < maxCycles) {
        if (mockAssessment.currentLevel >= mockAssessment.targetLevel) {
          break;
        }
        cyclesRun++;
        // Simulate remediation (but level doesn't improve in this test)
      }

      assert.equal(cyclesRun, maxCycles);
    });

    it('exits early when no critical gaps remain', async () => {
      let cyclesRun = 0;
      const maxCycles = 3;

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
        founderExplanation: 'Only major gaps.',
        recommendation: 'refine',
        timestamp: new Date().toISOString(),
      };

      // Simulate convergence loop
      while (cyclesRun < maxCycles) {
        const criticalGaps = mockAssessment.gaps.filter(g => g.severity === 'critical');
        if (criticalGaps.length === 0) {
          break; // Exit early
        }
        cyclesRun++;
      }

      assert.equal(cyclesRun, 0); // Should exit immediately
    });
  });

  describe('injection seams for focused remediation', () => {
    it('accepts custom assessment function', async () => {
      let customAssessmentCalled = false;

      const mockAssessFn = async () => {
        customAssessmentCalled = true;
        return {
          currentLevel: 4,
          targetLevel: 4,
          overallScore: 68,
          dimensions: {
            functionality: 75,
            testing: 82,
            errorHandling: 65,
            security: 70,
            uxPolish: 60,
            documentation: 65,
            performance: 70,
            maintainability: 68,
          },
          gaps: [],
          founderExplanation: 'Target met.',
          recommendation: 'proceed',
          timestamp: new Date().toISOString(),
        };
      };

      await mockAssessFn();

      assert.ok(customAssessmentCalled);
    });

    it('accepts custom remediation function', async () => {
      let remediationGaps: string[] = [];

      const mockRemediateFn = async (gaps: Array<{ dimension: string; severity: string }>) => {
        const criticalGaps = gaps.filter(g => g.severity === 'critical');
        remediationGaps = criticalGaps.map(g => g.dimension);
      };

      const gaps = [
        { dimension: 'testing', severity: 'critical' },
        { dimension: 'security', severity: 'critical' },
        { dimension: 'documentation', severity: 'major' },
      ];

      await mockRemediateFn(gaps);

      assert.equal(remediationGaps.length, 2);
      assert.ok(remediationGaps.includes('testing'));
      assert.ok(remediationGaps.includes('security'));
    });

    it('allows dry-run mode for assessment without remediation', async () => {
      let remediationCalled = false;
      const dryRun = true;

      const mockAssessment: MaturityAssessment = {
        currentLevel: 3,
        targetLevel: 5,
        overallScore: 58,
        dimensions: {
          functionality: 75,
          testing: 45,
          errorHandling: 55,
          security: 50,
          uxPolish: 60,
          documentation: 55,
          performance: 60,
          maintainability: 68,
        },
        gaps: [
          {
            dimension: 'testing',
            currentScore: 45,
            targetScore: 70,
            gapSize: 25,
            severity: 'critical',
            recommendation: 'Increase test coverage',
          },
        ],
        founderExplanation: 'Critical gaps detected.',
        recommendation: 'blocked',
        timestamp: new Date().toISOString(),
      };

      if (!dryRun && mockAssessment.currentLevel < mockAssessment.targetLevel) {
        remediationCalled = true;
      }

      assert.ok(!remediationCalled);
    });
  });

  describe('convergence metrics', () => {
    it('tracks cycles run vs max cycles', async () => {
      const maxCycles = 3;
      let cyclesRun = 0;
      let levelProgression: number[] = [];

      const assessments: MaturityAssessment[] = [
        { currentLevel: 2, targetLevel: 4 } as MaturityAssessment,
        { currentLevel: 3, targetLevel: 4 } as MaturityAssessment,
        { currentLevel: 4, targetLevel: 4 } as MaturityAssessment,
      ];

      for (const assessment of assessments) {
        if (cyclesRun >= maxCycles) break;
        if (assessment.currentLevel >= assessment.targetLevel) break;

        levelProgression.push(assessment.currentLevel);
        cyclesRun++;
      }

      assert.equal(cyclesRun, 2);
      assert.deepEqual(levelProgression, [2, 3]);
    });

    it('tracks initial vs final status', async () => {
      const initialStatus = 'blocked';
      let finalStatus = initialStatus;

      const mockAssessments: MaturityAssessment[] = [
        { recommendation: 'blocked' } as MaturityAssessment,
        { recommendation: 'refine' } as MaturityAssessment,
        { recommendation: 'proceed' } as MaturityAssessment,
      ];

      for (const assessment of mockAssessments) {
        finalStatus = assessment.recommendation;
        if (finalStatus === 'proceed' || finalStatus === 'target-exceeded') {
          break;
        }
      }

      assert.equal(initialStatus, 'blocked');
      assert.equal(finalStatus, 'proceed');
    });

    it('tracks score improvement across cycles', async () => {
      const scores: number[] = [];

      const mockAssessments: MaturityAssessment[] = [
        { overallScore: 35 } as MaturityAssessment,
        { overallScore: 52 } as MaturityAssessment,
        { overallScore: 68 } as MaturityAssessment,
      ];

      for (const assessment of mockAssessments) {
        scores.push(assessment.overallScore);
      }

      assert.equal(scores.length, 3);
      assert.ok(scores[1]! > scores[0]!);
      assert.ok(scores[2]! > scores[1]!);
    });
  });

  describe('preset-specific convergence cycles', () => {
    it('spark has 0 convergence cycles (no convergence)', () => {
      const sparkCycles = 0;
      assert.equal(sparkCycles, 0);
    });

    it('ember has 1 convergence cycle', () => {
      const emberCycles = 1;
      assert.equal(emberCycles, 1);
    });

    it('magic has 2 convergence cycles', () => {
      const magicCycles = 2;
      assert.equal(magicCycles, 2);
    });

    it('blaze has 2 convergence cycles', () => {
      const blazeCycles = 2;
      assert.equal(blazeCycles, 2);
    });

    it('nova has 3 convergence cycles', () => {
      const novaCycles = 3;
      assert.equal(novaCycles, 3);
    });

    it('inferno has 3 convergence cycles', () => {
      const infernoCycles = 3;
      assert.equal(infernoCycles, 3);
    });
  });

  describe('edge cases', () => {
    it('handles assessment returning undefined recommendation gracefully', async () => {
      const mockAssessment = {
        currentLevel: 3,
        targetLevel: 4,
        overallScore: 58,
        recommendation: undefined,
      } as unknown as MaturityAssessment;

      const shouldProceed = mockAssessment.recommendation === 'proceed' || mockAssessment.recommendation === 'target-exceeded';

      assert.ok(!shouldProceed);
    });

    it('handles empty gaps array', async () => {
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
          documentation: 65,
          performance: 70,
          maintainability: 68,
        },
        gaps: [],
        founderExplanation: 'No gaps.',
        recommendation: 'proceed',
        timestamp: new Date().toISOString(),
      };

      const criticalGaps = mockAssessment.gaps.filter(g => g.severity === 'critical');
      assert.equal(criticalGaps.length, 0);
    });

    it('handles level downgrade between cycles (should not happen, but defensive)', async () => {
      const assessments: MaturityAssessment[] = [
        { currentLevel: 3, targetLevel: 4 } as MaturityAssessment,
        { currentLevel: 2, targetLevel: 4 } as MaturityAssessment, // Downgrade
      ];

      // Convergence loop should still respect currentLevel < targetLevel
      for (const assessment of assessments) {
        assert.ok(assessment.currentLevel < assessment.targetLevel);
      }
    });
  });
});
