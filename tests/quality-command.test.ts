// Tests for the danteforge quality scorecard command (Sprint 50)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { quality } from '../src/cli/commands/quality.js';
import type { QualityOptions } from '../src/cli/commands/quality.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

// ── Stub ──────────────────────────────────────────────────────────────────────

const makeScore = (overrides: Partial<Record<string, number>> = {}): HarshScoreResult => ({
  displayScore: 7.9,
  displayDimensions: {
    functionality: 8.5,
    testing: 9.0,
    errorHandling: 8.5,
    security: 8.5,
    developerExperience: 5.5,
    autonomy: 9.0,
    maintainability: 8.0,
    performance: 7.5,
    documentation: 7.0,
    uxPolish: 6.0,
    planningQuality: 9.5,
    selfImprovement: 9.0,
    specDrivenPipeline: 9.5,
    convergenceSelfHealing: 9.0,
    tokenEconomy: 8.5,
    enterpriseReadiness: 6.0,
    mcpIntegration: 9.0,
    communityAdoption: 2.0,
    ...overrides,
  } as never,
  rawScores: {},
  summary: '',
  recommendations: [],
});

const baseOpts = (lines: string[]): QualityOptions => ({
  _isTTY: false,  // non-TTY: plain text, no chalk color codes
  _computeScore: async () => makeScore(),
  _stdout: (l) => lines.push(l),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('quality command', () => {
  it('renders overall score', async () => {
    const lines: string[] = [];
    await quality(baseOpts(lines));
    const text = lines.join('\n');
    assert.ok(text.includes('7.9'), 'should render overall score');
  });

  it('marks P0 gaps (dimensions below 7.0)', async () => {
    const lines: string[] = [];
    await quality(baseOpts(lines));
    const text = lines.join('\n');
    assert.ok(text.includes('<- P0') || text.includes('P0'), 'should mark P0 gaps');
  });

  it('excludes communityAdoption from dimension bars', async () => {
    const lines: string[] = [];
    await quality(baseOpts(lines));
    const text = lines.join('\n');
    assert.ok(!text.includes('Community Adoption'), 'communityAdoption should be excluded from bar display');
  });

  it('shows automation ceiling warning for enterpriseReadiness', async () => {
    const lines: string[] = [];
    await quality(baseOpts(lines));
    const text = lines.join('\n');
    assert.ok(text.includes('ceiling') || text.includes('Ceiling'), 'should show ceiling warning');
  });

  it('shows "all dims at 7.0+" message when no P0 gaps', async () => {
    const lines: string[] = [];
    await quality({
      ...baseOpts(lines),
      _computeScore: async () => makeScore({
        developerExperience: 7.5,
        uxPolish: 7.5,
        enterpriseReadiness: 6.0,  // ceiling, excluded from P0
      }),
    });
    const text = lines.join('\n');
    assert.ok(text.includes('7.0+') || text.includes('ascend'), 'should recommend ascend when no P0 gaps');
  });
});
