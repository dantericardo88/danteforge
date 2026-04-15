import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompetitorProfiles,
  findLeapfrogOpportunities,
  buildCompetitorPrompt,
  buildLeapfrogPlan,
  type CompetitorProfile,
} from '../src/core/competitive-planner.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<CompetitorProfile> = {}): CompetitorProfile {
  return {
    name: 'RivalCo',
    url: 'https://rivalco.example',
    strengths: ['security', 'performance'],
    weaknesses: ['documentation'],
    recentFeatures: ['auth tokens', 'rate limiting', 'caching'],
    estimatedScore: 8,
    ...overrides,
  };
}

// ── T1: buildCompetitorProfiles — parses valid JSON array ─────────────────────

describe('buildCompetitorProfiles', () => {
  it('T1: parses valid JSON array into CompetitorProfile[]', () => {
    const profiles: CompetitorProfile[] = [makeProfile()];
    const result = buildCompetitorProfiles(JSON.stringify(profiles));
    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'RivalCo');
    assert.equal(result[0]!.estimatedScore, 8);
  });

  it('T2: returns [] on invalid JSON (no throw)', () => {
    const result = buildCompetitorProfiles('this is not json {{ broken');
    assert.deepEqual(result, []);
  });

  it('T3: strips markdown fences before parsing', () => {
    const profiles: CompetitorProfile[] = [makeProfile({ name: 'FencedCo' })];
    const fenced = `\`\`\`json\n${JSON.stringify(profiles)}\n\`\`\``;
    const result = buildCompetitorProfiles(fenced);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'FencedCo');
  });

  it('T3b: strips plain ``` fences (no json label)', () => {
    const profiles: CompetitorProfile[] = [makeProfile({ name: 'PlainFence' })];
    const fenced = `\`\`\`\n${JSON.stringify(profiles)}\n\`\`\``;
    const result = buildCompetitorProfiles(fenced);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'PlainFence');
  });

  it('T2b: returns [] when parsed value is not an array', () => {
    const result = buildCompetitorProfiles(JSON.stringify({ name: 'single' }));
    assert.deepEqual(result, []);
  });

  it('T2c: filters out items that are missing required fields', () => {
    // Missing estimatedScore field
    const items = [{ name: 'Bad', url: 'x', strengths: [], weaknesses: [], recentFeatures: [] }];
    const result = buildCompetitorProfiles(JSON.stringify(items));
    assert.equal(result.length, 0);
  });
});

// ── T4-T6: findLeapfrogOpportunities ─────────────────────────────────────────

describe('findLeapfrogOpportunities', () => {
  const candidate = {
    patternName: 'circuit-breaker',
    unlocksGapClosure: ['security'],
  };

  it('T4: returns opportunities where competitor score > our score + 1', () => {
    const profile = makeProfile({ estimatedScore: 9, strengths: ['security'] });
    // estimatedScore=9, isStrength → dimScore=9; ourScore=3 → 9 >= 3+1 ✓
    const result = findLeapfrogOpportunities({ security: 3 }, [profile], [candidate]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.dimension, 'security');
  });

  it('T4b: does NOT create opportunity when competitor is not meaningfully ahead', () => {
    // competitorBestScore must be >= ourScore + 1 to trigger; equal does NOT trigger
    // estimatedScore=5, isStrength=true → dimScore=5; ourScore=4 → 5 < 4+1=5 is false → skip
    // Use estimatedScore=4, ourScore=4: dimScore=4 (strength), 4 < 4+1=5 → skip
    const profile = makeProfile({ estimatedScore: 4, strengths: ['security'] });
    const result = findLeapfrogOpportunities({ security: 4 }, [profile], [candidate]);
    assert.equal(result.length, 0);
  });

  it('T5: sorts by leapfrogScore descending', () => {
    const profileSec = makeProfile({ estimatedScore: 9, strengths: ['security'], weaknesses: [] });
    const profilePerf = makeProfile({ estimatedScore: 7, strengths: ['performance'], weaknesses: [] });
    const candidates = [
      { patternName: 'circuit-breaker', unlocksGapClosure: ['security'] },
      { patternName: 'cache-layer', unlocksGapClosure: ['performance'] },
    ];
    const result = findLeapfrogOpportunities(
      { security: 1, performance: 1 },
      [profileSec, profilePerf],
      candidates,
    );
    assert.equal(result.length, 2);
    assert.ok(result[0]!.leapfrogScore >= result[1]!.leapfrogScore);
  });

  it('T6: urgency=immediate when leapfrogScore >= 8', () => {
    // computeLeapfrogScore(0, 9) = (10-9) + (9-0) = 1 + 9 = 10 ≥ 8 → immediate
    const profile = makeProfile({ estimatedScore: 9, strengths: ['security'] });
    const result = findLeapfrogOpportunities({ security: 0 }, [profile], [candidate]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.urgency, 'immediate');
  });

  it('T6b: urgency=high when leapfrogScore in [6,8)', () => {
    // computeLeapfrogScore(2, 8) = (10-8) + (8-2) = 2+6 = 8 → immediate
    // Try ourScore=4, comp=8: (10-8)+(8-4)=2+4=6 → high
    const profile = makeProfile({ estimatedScore: 8, strengths: ['security'] });
    const result = findLeapfrogOpportunities({ security: 4 }, [profile], [candidate]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.urgency, 'high');
  });

  it('T4c: returns [] when no competitors provided', () => {
    const result = findLeapfrogOpportunities({ security: 3 }, [], [candidate]);
    assert.deepEqual(result, []);
  });

  it('T4d: returns [] when no matching adoption candidates', () => {
    const profile = makeProfile({ estimatedScore: 9, strengths: ['security'] });
    const result = findLeapfrogOpportunities({ security: 0 }, [profile], []);
    assert.deepEqual(result, []);
  });
});

// ── T7: buildCompetitorPrompt ─────────────────────────────────────────────────

describe('buildCompetitorPrompt', () => {
  it('T7: returns non-empty string containing projectDescription', () => {
    const desc = 'An agentic DevCLI for TypeScript projects';
    const result = buildCompetitorPrompt(desc, ['security', 'performance']);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    assert.ok(result.includes(desc), `Expected prompt to contain: ${desc}`);
  });

  it('T7b: includes all provided dimensions in the prompt', () => {
    const dims = ['testing', 'api-design', 'error-handling'];
    const result = buildCompetitorPrompt('MyProject', dims);
    for (const dim of dims) {
      assert.ok(result.includes(dim), `Expected prompt to contain dimension: ${dim}`);
    }
  });

  it('T7c: instructs LLM to return JSON array', () => {
    const result = buildCompetitorPrompt('X', ['y']);
    assert.ok(result.includes('JSON array'), 'Expected prompt to mention JSON array');
  });
});

// ── T8-T9: buildLeapfrogPlan ──────────────────────────────────────────────────

describe('buildLeapfrogPlan', () => {
  const profile = makeProfile({ estimatedScore: 9, strengths: ['security'] });
  const candidates = [{ patternName: 'zero-trust', unlocksGapClosure: ['security'] }];

  it('T8: with _llmCaller, calls it for topRecommendation', async () => {
    let called = false;
    const llmCaller = async (_prompt: string): Promise<string> => {
      called = true;
      return 'Adopt zero-trust auth immediately to leapfrog RivalCo on security.';
    };
    const plan = await buildLeapfrogPlan({ security: 1 }, [profile], candidates, llmCaller);
    assert.equal(called, true);
    assert.equal(plan.topRecommendation, 'Adopt zero-trust auth immediately to leapfrog RivalCo on security.');
  });

  it('T8b: wraps generatedAt as a valid ISO string', async () => {
    const plan = await buildLeapfrogPlan({ security: 1 }, [profile], candidates);
    const d = new Date(plan.generatedAt);
    assert.ok(!isNaN(d.getTime()), 'generatedAt should be a valid ISO date string');
  });

  it('T9: with no opportunities, uses fallback recommendation message', async () => {
    // No candidates → no opportunities
    const plan = await buildLeapfrogPlan({ security: 1 }, [profile], []);
    assert.ok(
      plan.topRecommendation.includes('No immediate leapfrog'),
      `Expected fallback message, got: ${plan.topRecommendation}`,
    );
    assert.equal(plan.opportunities.length, 0);
  });

  it('T9b: uses fallback recommendation when _llmCaller throws', async () => {
    const throwingCaller = async (_prompt: string): Promise<string> => {
      throw new Error('LLM unavailable');
    };
    const plan = await buildLeapfrogPlan({ security: 1 }, [profile], candidates, throwingCaller);
    // Falls back to buildFallbackRecommendation
    assert.ok(plan.topRecommendation.includes('zero-trust'), `Expected pattern name in fallback: ${plan.topRecommendation}`);
  });

  it('T9c: uses fallback when _llmCaller returns empty string', async () => {
    const emptyCaller = async (_prompt: string): Promise<string> => '  ';
    const plan = await buildLeapfrogPlan({ security: 1 }, [profile], candidates, emptyCaller);
    assert.ok(plan.topRecommendation.length > 0);
  });

  it('T8c: plan includes competitors and opportunities arrays', async () => {
    const plan = await buildLeapfrogPlan({ security: 1 }, [profile], candidates);
    assert.equal(plan.competitors.length, 1);
    assert.equal(plan.competitors[0]!.name, 'RivalCo');
    assert.ok(Array.isArray(plan.opportunities));
  });
});
