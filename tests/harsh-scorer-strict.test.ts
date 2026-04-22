// Tests for the 4 new strict dimensions added in Sprint 49
// and automation ceiling enforcement added in Sprint 49b
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeStrictDimensions } from '../src/core/harsh-scorer.js';
import { applyStrictOverrides } from '../src/core/ascend-engine.js';

// Injection seam types
type GitLogFn = (args: string[], cwd: string) => Promise<string>;
type ExistsFn = (p: string) => Promise<boolean>;
type ListDirFn = (p: string) => Promise<string[]>;

const noGit: GitLogFn = async () => '';
const noExists: ExistsFn = async () => false;
const noDir: ListDirFn = async () => [];

describe('computeStrictDimensions — Sprint 49 new dimensions', () => {
  it('specDrivenPipeline: scores low with no artifacts', async () => {
    const result = await computeStrictDimensions('/tmp/empty', noGit, noExists, noDir);
    // Base 10, no artifacts → expect ≤ 15
    assert.ok(result.specDrivenPipeline <= 20, `Expected low specDrivenPipeline, got ${result.specDrivenPipeline}`);
  });

  it('specDrivenPipeline: scores high with all 4 PDSE artifacts', async () => {
    const existsWithArtifacts: ExistsFn = async (p) => {
      return p.includes('CONSTITUTION.md') || p.includes('SPEC.md') ||
             p.includes('PLAN.md') || p.includes('TASKS.md') ||
             p.includes('evidence');
    };
    const withEvidence: ListDirFn = async (p) => {
      if (p.includes('evidence')) return ['verify-001.json'];
      if (p.includes('tests')) return ['foo.test.ts', 'e2e-pipeline.test.ts'];
      return [];
    };
    const result = await computeStrictDimensions('/tmp/full', noGit, existsWithArtifacts, withEvidence);
    // Base 10 + 4×15 + 10 evidence + 5 e2e = 85, capped at 85
    assert.ok(result.specDrivenPipeline >= 70, `Expected high specDrivenPipeline, got ${result.specDrivenPipeline}`);
    assert.ok(result.specDrivenPipeline <= 85, `specDrivenPipeline must be capped at 85, got ${result.specDrivenPipeline}`);
  });

  it('developerExperience: scores low with no docs or examples', async () => {
    const result = await computeStrictDimensions('/tmp/empty', noGit, noExists, noDir);
    // Base 15 only
    assert.ok(result.developerExperience <= 20, `Expected low developerExperience, got ${result.developerExperience}`);
  });

  it('developerExperience: scores high with CLAUDE.md + README + examples + tests', async () => {
    const existsWithDocs: ExistsFn = async (p) => {
      return p.includes('CLAUDE.md') || p.includes('README.md') || p.includes('examples');
    };
    const withTests: ListDirFn = async (p) => {
      if (p.includes('examples')) return ['todo-app'];
      if (p.includes('tests')) return Array.from({ length: 110 }, (_, i) => `test-${i}.test.ts`);
      return [];
    };
    const result = await computeStrictDimensions('/tmp/docs', noGit, existsWithDocs, withTests);
    // Base 15 + CLAUDE.md 20 + README 15 + examples 20 + tests≥100 15 = 85
    assert.ok(result.developerExperience >= 60, `Expected high developerExperience, got ${result.developerExperience}`);
  });

  it('planningQuality: scores low with no planning artifacts', async () => {
    const result = await computeStrictDimensions('/tmp/empty', noGit, noExists, noDir);
    assert.ok(result.planningQuality <= 20, `Expected low planningQuality, got ${result.planningQuality}`);
  });

  it('planningQuality: scores high with PLAN.md + SPEC.md + CONSTITUTION.md + plan commits', async () => {
    const existsWithPlans: ExistsFn = async (p) => {
      return p.includes('PLAN.md') || p.includes('SPEC.md') || p.includes('CONSTITUTION.md');
    };
    const planGit: GitLogFn = async (args) => {
      const grep = args.find(a => a.startsWith('--grep='));
      if (grep?.includes('plan')) return 'abc plan: init\ndef plan: tasks\nghi plan: update';
      if (grep?.includes('spec')) return 'xyz spec: add\nuvw spec: clarify\nrst spec: finalize';
      return 'sha1 commit1\nsha2 commit2\nsha3 commit3';
    };
    const result = await computeStrictDimensions('/tmp/planned', planGit, existsWithPlans, noDir);
    // Base 15 + PLAN 20 + SPEC 15 + CONSTITUTION 15 + plan commits 10 + spec commits 10 = 85
    assert.ok(result.planningQuality >= 70, `Expected high planningQuality, got ${result.planningQuality}`);
  });

  it('convergenceSelfHealing: scores low with no circuit-breaker or evidence', async () => {
    const result = await computeStrictDimensions('/tmp/empty', noGit, noExists, noDir);
    assert.ok(result.convergenceSelfHealing <= 20, `Expected low convergenceSelfHealing, got ${result.convergenceSelfHealing}`);
  });

  it('convergenceSelfHealing: scores high with circuit-breaker + compressor + autoforge evidence', async () => {
    const existsWithInfra: ExistsFn = async (p) => {
      return p.includes('circuit-breaker.ts') || p.includes('context-compressor.ts') ||
             p.includes('convergence-proof.json');
    };
    const withAutoforgeEvidence: ListDirFn = async (p) => {
      if (p.includes('autoforge')) return ['run-001.json', 'run-002.json', 'run-003.json'];
      return [];
    };
    const result = await computeStrictDimensions('/tmp/healed', noGit, existsWithInfra, withAutoforgeEvidence);
    // Base 15 + CB 25 + CC 20 + ≥3 evidence 15 + proof 10 = 85
    assert.ok(result.convergenceSelfHealing >= 70, `Expected high convergenceSelfHealing, got ${result.convergenceSelfHealing}`);
  });

  it('all new strict dims clamp to [0, 100]', async () => {
    const result = await computeStrictDimensions('/tmp/any', noGit, noExists, noDir);
    for (const key of ['specDrivenPipeline', 'developerExperience', 'planningQuality', 'convergenceSelfHealing'] as const) {
      assert.ok(result[key] >= 0 && result[key] <= 100, `${key} must be in [0,100], got ${result[key]}`);
    }
  });

  it('selfImprovement: scores higher with ≥10 retro session outputs in .danteforge/retros/', async () => {
    const withRetroOutputs: ListDirFn = async (p) => {
      if (p.includes('retros') && !p.includes('evidence')) {
        return Array.from({ length: 12 }, (_, i) => `retro-session-${i}.json`);
      }
      return [];
    };
    const result = await computeStrictDimensions('/tmp/retroed', noGit, noExists, withRetroOutputs);
    // Base 20 + 0 (no retro commits) + 0 (no lesson commits) + 0 (no evidence/retro) + 0 (no lessons.md) + 15 (≥10 retro outputs) = 35
    assert.ok(result.selfImprovement >= 35, `Expected selfImprovement boosted by retro outputs, got ${result.selfImprovement}`);
  });
});

describe('applyStrictOverrides — automation ceiling enforcement', () => {
  // Stub computeStrictDimensions that returns all zeros (so only the ceiling clamp matters)
  const zeroStrict: typeof computeStrictDimensions = async () => ({
    autonomy: 0, selfImprovement: 0, tokenEconomy: 0,
    specDrivenPipeline: 0, developerExperience: 0, planningQuality: 0, convergenceSelfHealing: 0,
  });

  it('clamps enterpriseReadiness to ceiling 6.0 when harsh scorer returns a higher value', async () => {
    const result = {
      displayScore: 9.0,
      displayDimensions: { enterpriseReadiness: 8.5 } as Record<string, number>,
      rawScores: {},
      summary: '',
      recommendations: [],
    } as never;

    await applyStrictOverrides(result, '/tmp', zeroStrict);

    assert.ok(
      result.displayDimensions.enterpriseReadiness <= 6.0,
      `enterpriseReadiness should be clamped to ≤6.0, got ${result.displayDimensions.enterpriseReadiness}`,
    );
  });

  it('clamps communityAdoption to ceiling 4.0 when harsh scorer returns a higher value', async () => {
    const result = {
      displayScore: 9.0,
      displayDimensions: { communityAdoption: 7.5 } as Record<string, number>,
      rawScores: {},
      summary: '',
      recommendations: [],
    } as never;

    await applyStrictOverrides(result, '/tmp', zeroStrict);

    assert.ok(
      result.displayDimensions.communityAdoption <= 4.0,
      `communityAdoption should be clamped to ≤4.0, got ${result.displayDimensions.communityAdoption}`,
    );
  });
});
