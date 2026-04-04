// Competitor Scanner — tests for project-aware competitor resolution,
// gap report, leaderboard, OSS discovery parsing, and LLM fallback behavior.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanCompetitors,
  buildGapReport,
  buildLeaderboard,
  formatCompetitorReport,
  parseOssDiscoveries,
  isDevToolProject,
  COMPETITOR_BASELINES,
  type CompetitorScanOptions,
  type DimensionGap,
  type ProjectCompetitorContext,
} from '../src/core/competitor-scanner.js';
import type { ScoringDimension } from '../src/core/harsh-scorer.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const ALL_DIMS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
  'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
];

function makeOurScores(score = 70): Record<ScoringDimension, number> {
  return Object.fromEntries(ALL_DIMS.map((d) => [d, score])) as Record<ScoringDimension, number>;
}

function makeDevToolContext(): ProjectCompetitorContext {
  return {
    projectName: 'DanteForge',
    projectDescription: 'An agentic coding CLI tool for developer workflows',
  };
}

function makeOptions(overrides: Partial<CompetitorScanOptions> = {}): CompetitorScanOptions {
  return {
    ourScores: makeOurScores(72),
    enableWebSearch: false, // disable by default to avoid real LLM calls
    projectContext: makeDevToolContext(), // dev tool → uses baselines
    _now: () => '2026-04-04T00:00:00Z',
    ...overrides,
  };
}

// ── scanCompetitors — core behavior ──────────────────────────────────────────

describe('scanCompetitors', () => {
  it('returns a CompetitorComparison with all required fields', async () => {
    const result = await scanCompetitors(makeOptions());
    assert.ok(Array.isArray(result.competitors), 'competitors is array');
    assert.ok(Array.isArray(result.leaderboard), 'leaderboard is array');
    assert.ok(Array.isArray(result.gapReport), 'gapReport is array');
    assert.ok(typeof result.overallGap === 'number', 'overallGap is number');
    assert.ok(result.analysisTimestamp === '2026-04-04T00:00:00Z');
    assert.ok(typeof result.projectName === 'string', 'projectName is string');
    assert.ok(typeof result.competitorSource === 'string', 'competitorSource is string');
  });

  it('includes all 12 dimensions in gapReport', async () => {
    const result = await scanCompetitors(makeOptions());
    assert.equal(result.gapReport.length, 12);
    const dims = result.gapReport.map((g) => g.dimension).sort();
    assert.deepEqual(dims, [...ALL_DIMS].sort());
  });

  it('leaderboard includes project name as an entry', async () => {
    const result = await scanCompetitors(makeOptions());
    const df = result.leaderboard.find((e) => e.name === 'DanteForge');
    assert.ok(df, 'Project appears in leaderboard');
  });

  it('leaderboard is sorted descending by avgScore', async () => {
    const result = await scanCompetitors(makeOptions());
    for (let i = 0; i < result.leaderboard.length - 1; i++) {
      assert.ok(
        result.leaderboard[i]!.avgScore >= result.leaderboard[i + 1]!.avgScore,
        `rank ${i + 1} should have score >= rank ${i + 2}`,
      );
    }
  });

  it('uses dev-tool baseline when project is a coding tool and no other source', async () => {
    const result = await scanCompetitors(makeOptions());
    assert.equal(result.competitorSource, 'dev-tool-default');
    assert.ok(result.competitors.length >= 8);
  });

  it('uses user-defined competitors when provided (priority 1)', async () => {
    const scored = JSON.stringify([{ name: 'MyComp', url: 'https://mycomp.io', description: 'Test', scores: Object.fromEntries(ALL_DIMS.map((d) => [d, 80])) }]);
    const result = await scanCompetitors(makeOptions({
      projectContext: {
        projectName: 'MyShop',
        userDefinedCompetitors: ['Shopify', 'WooCommerce'],
      },
      enableWebSearch: true,
      _callLLM: async () => `{"Shopify": {"url": "https://shopify.com", "description": "E-commerce", "scores": ${JSON.stringify(Object.fromEntries(ALL_DIMS.map((d) => [d, 85])))}}, "WooCommerce": {"url": "https://woocommerce.com", "description": "WP plugin", "scores": ${JSON.stringify(Object.fromEntries(ALL_DIMS.map((d) => [d, 75])))}}}`,
    }));
    assert.equal(result.competitorSource, 'user-defined');
    assert.equal(result.competitors.length, 2);
    assert.ok(result.competitors.some((c) => c.name === 'Shopify'), 'Shopify present');
  });

  it('uses OSS discoveries when available (priority 2, no user list)', async () => {
    const result = await scanCompetitors(makeOptions({
      projectContext: {
        projectName: 'MyApp',
        ossDiscoveries: ['express', 'fastify'],
      },
      enableWebSearch: true,
      _callLLM: async () => `{"express": {"url": "https://expressjs.com", "description": "Node framework", "scores": ${JSON.stringify(Object.fromEntries(ALL_DIMS.map((d) => [d, 82])))}}, "fastify": {"url": "https://fastify.io", "description": "Fast Node", "scores": ${JSON.stringify(Object.fromEntries(ALL_DIMS.map((d) => [d, 85])))}}}`,
    }));
    assert.equal(result.competitorSource, 'oss-derived');
    assert.ok(result.competitors.some((c) => c.name === 'express'));
  });

  it('discovers competitors via LLM when no user list or OSS data (priority 3)', async () => {
    const discoveredJson = JSON.stringify([
      {
        name: 'Stripe',
        url: 'https://stripe.com',
        description: 'Payment processor',
        scores: Object.fromEntries(ALL_DIMS.map((d) => [d, 90])),
      },
    ]);
    const result = await scanCompetitors(makeOptions({
      projectContext: { projectName: 'PayApp', projectDescription: 'SaaS payment management' },
      enableWebSearch: true,
      _callLLM: async () => discoveredJson,
    }));
    assert.equal(result.competitorSource, 'llm-discovered');
    assert.ok(result.competitors.some((c) => c.name === 'Stripe'), 'LLM-discovered competitor present');
  });

  it('returns empty competitors for unknown non-dev-tool project with no LLM', async () => {
    const result = await scanCompetitors(makeOptions({
      projectContext: { projectName: 'My Restaurant App', projectDescription: 'Online ordering system' },
      enableWebSearch: false,
    }));
    assert.equal(result.competitors.length, 0);
  });

  it('falls back gracefully when LLM throws during discovery', async () => {
    const result = await scanCompetitors(makeOptions({
      projectContext: { projectName: 'SomeApp', projectDescription: 'generic project' },
      enableWebSearch: true,
      _callLLM: async () => { throw new Error('LLM unavailable'); },
    }));
    // Non-dev-tool + LLM failure → no competitors
    assert.equal(result.competitors.length, 0);
  });

  it('falls back to dev-tool baseline when LLM fails for dev tool project', async () => {
    const result = await scanCompetitors(makeOptions({
      projectContext: makeDevToolContext(),
      enableWebSearch: true,
      _callLLM: async () => { throw new Error('LLM unavailable'); },
    }));
    assert.equal(result.competitorSource, 'dev-tool-default');
    assert.ok(result.competitors.length >= 8);
  });

  it('overallGap is 0 when we lead in all dimensions', async () => {
    const perfectScores = makeOurScores(100);
    const result = await scanCompetitors(makeOptions({ ourScores: perfectScores }));
    assert.equal(result.overallGap, 0);
  });

  it('uses enriched dev-tool scores when web search enabled', async () => {
    const enrichedJson = JSON.stringify({ 'Devin (Cognition AI)': { autonomy: 95 } });
    const result = await scanCompetitors(makeOptions({
      enableWebSearch: true,
      _callLLM: async () => enrichedJson,
    }));
    const devin = result.competitors.find((c) => c.name === 'Devin (Cognition AI)');
    assert.ok(devin, 'Devin found');
    assert.equal(devin!.scores.autonomy, 95);
    assert.equal(devin!.source, 'web-enriched');
  });
});

// ── isDevToolProject ──────────────────────────────────────────────────────────

describe('isDevToolProject', () => {
  it('returns true for coding tool projects', () => {
    assert.equal(isDevToolProject({ projectName: 'MyForge CLI', projectDescription: 'An agentic coding workflow CLI' }), true);
    assert.equal(isDevToolProject({ projectName: 'CodeAgent', projectDescription: 'AI agent for developer workflows' }), true);
  });

  it('returns false for non-dev-tool projects', () => {
    assert.equal(isDevToolProject({ projectName: 'MyShop', projectDescription: 'Online e-commerce store' }), false);
    assert.equal(isDevToolProject({ projectName: 'RestaurantApp', projectDescription: 'Food ordering and delivery' }), false);
  });

  it('returns false for undefined context', () => {
    assert.equal(isDevToolProject(undefined), false);
  });

  it('matches on project name even without description', () => {
    assert.equal(isDevToolProject({ projectName: 'MyCLI' }), true);
    assert.equal(isDevToolProject({ projectName: 'danteforge' }), true);
  });
});

// ── parseOssDiscoveries ───────────────────────────────────────────────────────

describe('parseOssDiscoveries', () => {
  it('extracts repo names from Repositories Scanned section', () => {
    const report = `# OSS Report

## Repositories Scanned

- [express](https://github.com/expressjs/express) - Fast Node.js framework
- [fastify](https://github.com/fastify/fastify) - High performance web framework

## Patterns Extracted
`;
    const names = parseOssDiscoveries(report);
    assert.ok(names.includes('express'), 'express extracted');
    assert.ok(names.includes('fastify'), 'fastify extracted');
  });

  it('returns empty array for report with no repositories', () => {
    const report = `# OSS Report

## Repositories Scanned

_No repositories scanned._

## Patterns Extracted
`;
    const names = parseOssDiscoveries(report);
    assert.deepEqual(names, []);
  });

  it('deduplicates names', () => {
    const report = `# OSS Report

## Repositories Scanned

- [express](url)
- [express](url)
- [fastify](url)
`;
    const names = parseOssDiscoveries(report);
    const expressCount = names.filter((n) => n === 'express').length;
    assert.equal(expressCount, 1, 'no duplicates');
  });

  it('caps at 10 results', () => {
    const repos = Array.from({ length: 15 }, (_, i) => `- [repo${i}](url)`).join('\n');
    const report = `## Repositories Scanned\n${repos}\n## End`;
    const names = parseOssDiscoveries(report);
    assert.ok(names.length <= 10);
  });
});

// ── buildGapReport ────────────────────────────────────────────────────────────

describe('buildGapReport', () => {
  it('returns 12 gaps, one per dimension', () => {
    const gaps = buildGapReport(makeOurScores(70), COMPETITOR_BASELINES);
    assert.equal(gaps.length, 12);
  });

  it('sets severity=leading when we score the highest', () => {
    const gaps = buildGapReport(makeOurScores(100), COMPETITOR_BASELINES);
    for (const gap of gaps) {
      assert.equal(gap.severity, 'leading', `Expected leading for ${gap.dimension}`);
    }
  });

  it('sets severity=critical when best competitor leads by >= 20 points', () => {
    const lowScores = makeOurScores(50);
    const gaps = buildGapReport(lowScores, COMPETITOR_BASELINES);
    const criticalGaps = gaps.filter((g) => g.severity === 'critical');
    assert.ok(criticalGaps.length > 0, 'Expected at least one critical gap at 50 score');
  });

  it('delta is negative when we are ahead', () => {
    const perfectScores = makeOurScores(100);
    const gaps = buildGapReport(perfectScores, COMPETITOR_BASELINES);
    for (const gap of gaps) {
      assert.ok(gap.delta <= 0);
    }
  });

  it('returns correct delta calculation', () => {
    const ourScores = { ...makeOurScores(70), autonomy: 80 };
    const gaps = buildGapReport(ourScores, COMPETITOR_BASELINES);
    const autonomyGap = gaps.find((g) => g.dimension === 'autonomy');
    assert.ok(autonomyGap, 'autonomy gap found');
    assert.equal(autonomyGap!.ourScore, 80);
    assert.equal(autonomyGap!.delta, autonomyGap!.bestScore - 80);
  });

  it('returns empty array when no competitors', () => {
    const gaps = buildGapReport(makeOurScores(70), []);
    assert.equal(gaps.length, 12);
    for (const gap of gaps) {
      assert.equal(gap.severity, 'leading'); // leading ourselves
      assert.equal(gap.delta, 0);
    }
  });
});

// ── buildLeaderboard ──────────────────────────────────────────────────────────

describe('buildLeaderboard', () => {
  it('assigns rank 1 to highest avg score', () => {
    const entries = [
      { name: 'A', avgScore: 70 },
      { name: 'B', avgScore: 90 },
      { name: 'C', avgScore: 80 },
    ];
    const board = buildLeaderboard(entries);
    assert.equal(board[0]!.name, 'B');
    assert.equal(board[0]!.rank, 1);
  });

  it('rounds avgScore to 1 decimal', () => {
    const entries = [{ name: 'A', avgScore: 73.333 }];
    const board = buildLeaderboard(entries);
    assert.equal(board[0]!.avgScore, 73.3);
  });
});

// ── formatCompetitorReport ────────────────────────────────────────────────────

describe('formatCompetitorReport', () => {
  it('includes Competitor Benchmarking Report header', async () => {
    const result = await scanCompetitors(makeOptions());
    const report = formatCompetitorReport(result);
    assert.ok(report.includes('Competitor Benchmarking Report'));
  });

  it('includes Source line describing how competitors were found', async () => {
    const result = await scanCompetitors(makeOptions());
    const report = formatCompetitorReport(result);
    assert.ok(report.includes('Source:'), 'Source line present');
  });

  it('includes Leaderboard section', async () => {
    const result = await scanCompetitors(makeOptions());
    const report = formatCompetitorReport(result);
    assert.ok(report.includes('Leaderboard'));
  });

  it('includes Gap Analysis section', async () => {
    const result = await scanCompetitors(makeOptions());
    const report = formatCompetitorReport(result);
    assert.ok(report.includes('Gap Analysis'));
  });

  it('shows project name with (us) marker in leaderboard', async () => {
    const result = await scanCompetitors(makeOptions());
    const report = formatCompetitorReport(result);
    assert.ok(report.includes('(us)'), 'us marker present');
    assert.ok(report.includes('DanteForge'), 'project name present');
  });

  it('shows message when no competitors found', async () => {
    const result = await scanCompetitors(makeOptions({
      projectContext: { projectName: 'TinyApp', projectDescription: 'generic app' },
      enableWebSearch: false,
    }));
    const report = formatCompetitorReport(result);
    assert.ok(report.includes('No competitors found') || report.includes('Gap Analysis'));
  });
});

// ── COMPETITOR_BASELINES integrity ────────────────────────────────────────────

describe('COMPETITOR_BASELINES (dev-tool defaults)', () => {
  it('all competitors have all 12 dimensions', () => {
    for (const comp of COMPETITOR_BASELINES) {
      for (const dim of ALL_DIMS) {
        assert.ok(dim in comp.scores, `${comp.name} missing dimension ${dim}`);
        const score = comp.scores[dim];
        assert.ok(score >= 0 && score <= 100, `${comp.name}.${dim} out of range: ${score}`);
      }
    }
  });

  it('has at least 8 competitors', () => {
    assert.ok(COMPETITOR_BASELINES.length >= 8);
  });
});
