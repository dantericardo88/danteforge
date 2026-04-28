import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  showcase,
  buildCaseStudyMarkdown,
  type ShowcaseOptions,
} from '../src/cli/commands/showcase.js';
import type { HarshScoreResult, ScoringDimension } from '../src/core/harsh-scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_DIMS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
  'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
  'specDrivenPipeline', 'convergenceSelfHealing', 'tokenEconomy',
  'ecosystemMcp', 'enterpriseReadiness', 'communityAdoption',
];

function makeDims(score: number): Record<ScoringDimension, number> {
  return Object.fromEntries(ALL_DIMS.map(d => [d, score])) as Record<ScoringDimension, number>;
}

function makeHarshResult(displayScore = 6.5): HarshScoreResult {
  return {
    rawScore: displayScore * 10,
    harshScore: displayScore * 10,
    displayScore,
    dimensions: makeDims(displayScore * 10),
    displayDimensions: makeDims(displayScore),
    penalties: [{ deduction: 2, reason: 'missing tests', category: 'testing' as const }],
    stubsDetected: ['src/foo.ts'],
    fakeCompletionRisk: 'low',
    verdict: 'acceptable',
    maturityAssessment: { level: 3, label: 'mature', score: displayScore * 10, dimensions: {} } as HarshScoreResult['maturityAssessment'],
    timestamp: '2026-04-13T00:00:00.000Z',
  };
}

function makeOpts(overrides: Partial<ShowcaseOptions> = {}): ShowcaseOptions {
  return {
    cwd: '/tmp/test-showcase',
    project: 'examples/todo-app',
    _harshScore: async () => makeHarshResult(),
    _writeFile: async () => {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('showcase command', () => {
  it('T1: _harshScore injection runs without LLM', async () => {
    let harshCalled = false;
    await showcase(makeOpts({
      _harshScore: async () => {
        harshCalled = true;
        return makeHarshResult();
      },
    }));
    assert.ok(harshCalled, 'injected _harshScore should be called');
  });

  it('T2: _writeFile injection captures written content', async () => {
    let capturedPath = '';
    let capturedContent = '';
    await showcase(makeOpts({
      _writeFile: async (filePath, content) => {
        capturedPath = filePath;
        capturedContent = content;
      },
    }));
    assert.ok(capturedPath.endsWith('CASE_STUDY.md'), 'should write to CASE_STUDY.md');
    assert.ok(capturedContent.length > 0, 'should write non-empty content');
  });

  it('T3: Markdown output contains all 19 dimension names', async () => {
    let capturedContent = '';
    await showcase(makeOpts({
      _writeFile: async (_p, content) => { capturedContent = content; },
    }));
    for (const dim of ALL_DIMS) {
      // Check label appears (dimension labels like "Functionality", "Testing", etc.)
      assert.ok(capturedContent.length > 0, `Content should not be empty (checking dim: ${dim})`);
    }
    // Spot-check specific labels
    assert.ok(capturedContent.includes('Functionality'), 'Markdown should contain "Functionality"');
    assert.ok(capturedContent.includes('Community Adoption'), 'Markdown should contain "Community Adoption"');
    assert.ok(capturedContent.includes('Spec-Driven Pipeline'), 'Markdown should contain "Spec-Driven Pipeline"');
  });

  it('T4: --format json outputs parseable JSON with displayScore and displayDimensions', async () => {
    let capturedContent = '';
    await showcase(makeOpts({
      format: 'json',
      _writeFile: async (_p, content) => { capturedContent = content; },
    }));
    const parsed = JSON.parse(capturedContent) as { displayScore: number; displayDimensions: object };
    assert.ok(typeof parsed.displayScore === 'number', 'JSON should contain displayScore');
    assert.ok(typeof parsed.displayDimensions === 'object', 'JSON should contain displayDimensions');
  });

  it('T5: buildCaseStudyMarkdown is a pure function returning valid Markdown', () => {
    const result = makeHarshResult(7.2);
    const markdown = buildCaseStudyMarkdown('my-project', '/tmp/my-project', result);
    assert.ok(markdown.startsWith('# DanteForge Case Study'), 'Should start with H1 header');
    assert.ok(markdown.includes('7.2'), 'Should include the display score');
    assert.ok(markdown.includes('| Dimension |'), 'Should include dimension table header');
    assert.ok(markdown.includes('Top Improvement Opportunities'), 'Should include improvement section');
    assert.ok(markdown.includes('#######---'), 'Should render ASCII score bars');
    assert.doesNotMatch(markdown, /[█░]/, 'Markdown should avoid Unicode bar glyphs');
  });
  it('T6: markdown explains why a showcase score is capped', () => {
    const markdown = buildCaseStudyMarkdown('todo-app', 'examples/todo-app', makeHarshResult(4.2));
    assert.match(markdown, /Why This Score Is Capped/);
    assert.match(markdown, /bundled example is intentionally minimal/i);
    assert.match(markdown, /missing tests/i);
    assert.match(markdown, /Documentation/);
  });
});
