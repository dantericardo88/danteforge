import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSION_HUMAN_TEXT, BUILDER_DIMENSIONS } from '../src/cli/commands/score.js';
import { score } from '../src/cli/commands/score.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';

function makeScoreResult(dims: Partial<Record<string, number>> = {}): HarshScoreResult {
  const displayDimensions: Record<string, number> = {
    functionality: 8.0,
    testing: 5.5,
    errorHandling: 4.0,
    security: 7.0,
    developerExperience: 7.0,
    autonomy: 8.0,
    maintainability: 8.0,
    performance: 7.0,
    documentation: 7.0,
    uxPolish: 7.0,
    planningQuality: 8.0,
    selfImprovement: 8.0,
    specDrivenPipeline: 8.0,
    convergenceSelfHealing: 8.0,
    tokenEconomy: 8.0,
    enterpriseReadiness: 6.0,
    mcpIntegration: 8.0,
    communityAdoption: 2.0,
    ...dims,
  };
  return {
    displayScore: 7.0,
    displayDimensions: displayDimensions as never,
    rawScores: {},
    summary: '',
    verdict: 'needs-work',
    recommendations: [],
  };
}

const noopState = {
  _loadState: async () => ({
    project: 'test',
    lastHandoff: '',
    workflowStage: 'initialized' as const,
    currentPhase: 1,
    tasks: {},
    auditLog: [],
    profile: 'budget' as const,
  }),
  _saveState: async () => {},
};

describe('DIMENSION_HUMAN_TEXT', () => {
  it('is exported and non-empty', () => {
    assert.ok(typeof DIMENSION_HUMAN_TEXT === 'object');
    assert.ok(Object.keys(DIMENSION_HUMAN_TEXT).length > 5);
  });

  it('has human text for errorHandling', () => {
    assert.match(DIMENSION_HUMAN_TEXT['errorHandling'] ?? '', /crash|error/i);
  });

  it('has human text for testing', () => {
    assert.match(DIMENSION_HUMAN_TEXT['testing'] ?? '', /test|bug/i);
  });

  it('has human text for security', () => {
    assert.match(DIMENSION_HUMAN_TEXT['security'] ?? '', /security|data|attack/i);
  });

  it('has human text for performance', () => {
    assert.match(DIMENSION_HUMAN_TEXT['performance'] ?? '', /slow|fast|response/i);
  });

  it('has human text for documentation', () => {
    assert.match(DIMENSION_HUMAN_TEXT['documentation'] ?? '', /onboard|understand|contributor/i);
  });
});

describe('score P0 output — human text', () => {
  it('shows human-readable label instead of camelCase for errorHandling', async () => {
    const lines: string[] = [];
    await score({
      ...noopState,
      _harshScore: async () => makeScoreResult({ errorHandling: 3.0, testing: 3.5, uxPolish: 4.0 }),
      _readHistory: async () => [],
      _writeHistory: async () => {},
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    // Should show human label (capitalized, space-separated) not camelCase
    assert.match(text, /Error [Hh]andling/);
  });

  it('shows human text explanation for P0 gaps that have it', async () => {
    const lines: string[] = [];
    await score({
      ...noopState,
      _harshScore: async () => makeScoreResult({ errorHandling: 3.0, testing: 3.5, uxPolish: 4.0 }),
      _readHistory: async () => [],
      _writeHistory: async () => {},
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    // Human text for errorHandling should appear
    assert.match(text, /crash|confusing error/i);
  });

  it('shows explain footer after P0 items', async () => {
    const lines: string[] = [];
    await score({
      ...noopState,
      _harshScore: async () => makeScoreResult({ errorHandling: 3.0, testing: 3.5, uxPolish: 4.0 }),
      _readHistory: async () => [],
      _writeHistory: async () => {},
      _stdout: (l) => lines.push(l),
    });
    assert.match(lines.join('\n'), /danteforge explain/i);
  });

  it('still shows action command for each P0 item', async () => {
    const lines: string[] = [];
    await score({
      ...noopState,
      _harshScore: async () => makeScoreResult({ errorHandling: 3.0, testing: 3.5, uxPolish: 4.0 }),
      _readHistory: async () => [],
      _writeHistory: async () => {},
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.match(text, /danteforge improve/i);
    assert.doesNotMatch(text, /danteforge forge/i);
  });

  it('communityAdoption action uses danteforge improve not npm publish', async () => {
    const lines: string[] = [];
    await score({
      ...noopState,
      _harshScore: async () => makeScoreResult({ communityAdoption: 1.0, testing: 1.5, errorHandling: 2.0 }),
      _readHistory: async () => [],
      _writeHistory: async () => {},
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.doesNotMatch(text, /npm publish/i);
    assert.match(text, /danteforge improve/i);
  });

  it('BUILDER_DIMENSIONS contains exactly the 8 core project quality dims', () => {
    const expected = ['functionality', 'testing', 'errorHandling', 'security',
      'uxPolish', 'documentation', 'performance', 'maintainability'];
    for (const d of expected) {
      assert.ok(BUILDER_DIMENSIONS.has(d as never), `Expected BUILDER_DIMENSIONS to contain ${d}`);
    }
    assert.equal(BUILDER_DIMENSIONS.size, 8);
  });

  it('default P0 output prefers builder dims over meta dims', async () => {
    const lines: string[] = [];
    await score({
      ...noopState,
      _harshScore: async () => makeScoreResult({
        communityAdoption: 1.0, selfImprovement: 1.5, autonomy: 2.0,
        errorHandling: 5.0, testing: 5.5, uxPolish: 6.0,
      }),
      _readHistory: async () => [],
      _writeHistory: async () => {},
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    // Builder dims should appear before meta dims in P0
    assert.match(text, /Error [Hh]andling|Testing|Ux Polish/i);
  });
});
