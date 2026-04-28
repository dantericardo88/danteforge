// Gap Masterplan — tests for priority assignment, item generation, markdown output,
// JSON persistence, and cycle estimation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import {
  generateMasterplan,
  formatMasterplanMarkdown,
  loadMasterplan,
  type GenerateMasterplanOptions,
  type Masterplan,
} from '../src/core/gap-masterplan.js';
import type { HarshScoreResult, ScoringDimension, AssessmentHistoryEntry } from '../src/core/harsh-scorer.js';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';
import type { CompetitorComparison } from '../src/core/competitor-scanner.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const ALL_DIMS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
  'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
  'specDrivenPipeline', 'convergenceSelfHealing', 'tokenEconomy',
  'contextEconomy', 'ecosystemMcp', 'enterpriseReadiness', 'communityAdoption',
];

function makeDims(score: number): Record<ScoringDimension, number> {
  return Object.fromEntries(ALL_DIMS.map((d) => [d, score])) as Record<ScoringDimension, number>;
}

function makeMaturityAssessment(): MaturityAssessment {
  return {
    currentLevel: 4, targetLevel: 5, overallScore: 72,
    dimensions: {
      functionality: 72, testing: 72, errorHandling: 72, security: 72,
      uxPolish: 72, documentation: 72, performance: 72, maintainability: 72,
    },
    gaps: [], founderExplanation: 'Beta.', recommendation: 'refine',
    timestamp: new Date().toISOString(),
  };
}

function makeAssessment(overrides: Partial<HarshScoreResult> = {}): HarshScoreResult {
  const dims = makeDims(65);
  return {
    rawScore: 65,
    harshScore: 65,
    displayScore: 6.5,
    dimensions: dims,
    displayDimensions: Object.fromEntries(
      Object.entries(dims).map(([k, v]) => [k, v / 10]),
    ) as Record<ScoringDimension, number>,
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: 'needs-work',
    maturityAssessment: makeMaturityAssessment(),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeComparison(ourScore = 65): CompetitorComparison {
  return {
    ourDimensions: makeDims(ourScore),
    competitors: [],
    leaderboard: [],
    gapReport: ALL_DIMS.map((dim) => ({
      dimension: dim,
      ourScore,
      bestScore: 85,
      bestCompetitor: 'Devin',
      delta: 85 - ourScore,
      severity: 'major' as const,
    })),
    overallGap: 20,
    analysisTimestamp: new Date().toISOString(),
  };
}

function makeOptions(overrides: Partial<GenerateMasterplanOptions> = {}): GenerateMasterplanOptions {
  return {
    assessment: makeAssessment(),
    cycleNumber: 1,
    targetScore: 9.0,
    cwd: '/fake/cwd',
    _writeFile: async () => {},
    _mkdir: async () => {},
    _now: () => '2026-04-04T00:00:00Z',
    ...overrides,
  };
}

// ── generateMasterplan ────────────────────────────────────────────────────────

describe('generateMasterplan', () => {
  it('returns a Masterplan with all required fields', async () => {
    const plan = await generateMasterplan(makeOptions());
    assert.ok(typeof plan.generatedAt === 'string');
    assert.ok(typeof plan.cycleNumber === 'number');
    assert.ok(typeof plan.overallScore === 'number');
    assert.ok(typeof plan.targetScore === 'number');
    assert.ok(typeof plan.gapToTarget === 'number');
    assert.ok(Array.isArray(plan.items));
    assert.ok(typeof plan.criticalCount === 'number');
    assert.ok(typeof plan.projectedCycles === 'number');
  });

  it('generates items for all dimensions below target', async () => {
    const plan = await generateMasterplan(makeOptions());
    // All dims at 65 (6.5/10) are below target 9.0, so all 19 should have items
    assert.equal(plan.items.length, 19);
  });

  it('generates no items when all dimensions meet target', async () => {
    const dims = makeDims(95);
    const plan = await generateMasterplan(makeOptions({
      assessment: makeAssessment({
        dimensions: dims,
        harshScore: 95,
        displayScore: 9.5,
        displayDimensions: Object.fromEntries(
          Object.entries(dims).map(([k, v]) => [k, v / 10]),
        ) as Record<ScoringDimension, number>,
      }),
    }));
    assert.equal(plan.items.length, 0);
  });

  it('assigns P0 to dimensions <= 5.0/10', async () => {
    const dims = makeDims(65);
    dims.errorHandling = 40; // 4.0/10 → P0
    const plan = await generateMasterplan(makeOptions({
      assessment: makeAssessment({ dimensions: dims, displayScore: 6.5 }),
    }));
    const p0 = plan.items.filter((i) => i.priority === 'P0');
    assert.ok(p0.length >= 1, `Expected P0 items, got ${p0.length}`);
    const errorHandlingP0 = p0.find((i) => i.dimension === 'errorHandling');
    assert.ok(errorHandlingP0, 'errorHandling should be P0');
  });

  it('assigns P0 when competitor leads by >= 30 points (3.0 display)', async () => {
    const comparison = makeComparison(60); // competitor leads by 25, not 30
    comparison.gapReport = comparison.gapReport.map((g) =>
      g.dimension === 'autonomy' ? { ...g, delta: 35 } : g, // autonomy: competitor leads by 35
    );
    const plan = await generateMasterplan(makeOptions({ comparison }));
    const autonomyItem = plan.items.find((i) => i.dimension === 'autonomy');
    assert.ok(autonomyItem, 'autonomy item found');
    assert.equal(autonomyItem!.priority, 'P0');
  });

  it('assigns P2 to dimensions 7.5-9.0', async () => {
    const dims = makeDims(80); // 8.0/10 → P2
    const plan = await generateMasterplan(makeOptions({
      assessment: makeAssessment({
        dimensions: dims,
        harshScore: 80,
        displayScore: 8.0,
      }),
    }));
    const p2 = plan.items.filter((i) => i.priority === 'P2');
    assert.ok(p2.length > 0, 'Expected P2 items at 8.0/10');
  });

  it('items are sorted P0 before P1 before P2', async () => {
    const dims = { ...makeDims(75), errorHandling: 40, testing: 55 };
    const plan = await generateMasterplan(makeOptions({
      assessment: makeAssessment({ dimensions: dims }),
    }));
    const priorities = plan.items.map((i) => i.priority);
    let lastPriority = 'P0';
    for (const p of priorities) {
      if (lastPriority === 'P0' && p === 'P1') { lastPriority = 'P1'; continue; }
      if (lastPriority === 'P1' && p === 'P2') { lastPriority = 'P2'; continue; }
      if (p === lastPriority) continue;
      assert.fail(`Priority order violated: got ${p} after ${lastPriority}`);
    }
  });

  it('all items have non-empty IDs after generation', async () => {
    const plan = await generateMasterplan(makeOptions());
    for (const item of plan.items) {
      assert.ok(item.id.length > 0, `Item ${item.dimension} has empty id`);
      assert.match(item.id, /^P[012]-\d{2}$/, `ID format invalid: ${item.id}`);
    }
  });

  it('criticalCount matches P0 items', async () => {
    const plan = await generateMasterplan(makeOptions());
    const actual = plan.items.filter((i) => i.priority === 'P0').length;
    assert.equal(plan.criticalCount, actual);
  });

  it('gapToTarget is clamped >= 0', async () => {
    const plan = await generateMasterplan(makeOptions({
      assessment: makeAssessment({ displayScore: 9.5 }),
    }));
    assert.ok(plan.gapToTarget >= 0);
  });

  it('includes competitor context when comparison provided', async () => {
    const plan = await generateMasterplan(makeOptions({ comparison: makeComparison() }));
    const withContext = plan.items.filter((i) => i.competitorContext !== undefined);
    assert.ok(withContext.length > 0, 'Expected some items with competitor context');
  });

  it('no competitor context when comparison not provided', async () => {
    const plan = await generateMasterplan(makeOptions({ comparison: undefined }));
    const withContext = plan.items.filter((i) => i.competitorContext !== undefined);
    assert.equal(withContext.length, 0);
  });

  it('calls _writeFile with MASTERPLAN.md and masterplan.json', async () => {
    const writtenFiles: string[] = [];
    await generateMasterplan(makeOptions({
      _writeFile: async (filePath) => { writtenFiles.push(filePath); },
    }));
    assert.ok(writtenFiles.some((f) => f.endsWith('MASTERPLAN.md')), 'MASTERPLAN.md written');
    assert.ok(writtenFiles.some((f) => f.endsWith('masterplan.json')), 'masterplan.json written');
  });

  it('uses custom timestamp from _now', async () => {
    const plan = await generateMasterplan(makeOptions({
      _now: () => '2099-01-01T00:00:00Z',
    }));
    assert.equal(plan.generatedAt, '2099-01-01T00:00:00Z');
  });
});

// ── formatMasterplanMarkdown ──────────────────────────────────────────────────

describe('formatMasterplanMarkdown', () => {
  function makePlan(overrides: Partial<Masterplan> = {}): Masterplan {
    return {
      generatedAt: '2026-04-04T00:00:00Z',
      cycleNumber: 1,
      overallScore: 6.5,
      targetScore: 9.0,
      gapToTarget: 2.5,
      criticalCount: 2,
      majorCount: 3,
      projectedCycles: 5,
      items: [
        {
          id: 'P0-01',
          priority: 'P0',
          dimension: 'errorHandling',
          currentScore: 4.0,
          targetScore: 9.0,
          title: 'Error Handling & Resilience',
          description: 'Current score: 4.0/10 → target: 9.0/10',
          forgeCommand: 'danteforge forge "Add error handling"',
          verifyCondition: 'All async functions have error handling',
          estimatedDelta: 5.0,
          competitorContext: 'Claude Code scores 7.8/10',
        },
      ],
      ...overrides,
    };
  }

  it('includes DanteForge Gap-Closing Masterplan header', () => {
    const md = formatMasterplanMarkdown(makePlan());
    assert.ok(md.includes('DanteForge Gap-Closing Masterplan'), 'Header present');
  });

  it('includes overall score and target', () => {
    const md = formatMasterplanMarkdown(makePlan());
    assert.ok(md.includes('6.5/10'), 'Current score present');
    assert.ok(md.includes('9.0/10'), 'Target score present');
  });

  it('includes item ID and title', () => {
    const md = formatMasterplanMarkdown(makePlan());
    assert.ok(md.includes('P0-01'), 'Item ID present');
    assert.ok(md.includes('Error Handling & Resilience'), 'Item title present');
  });

  it('includes forge command', () => {
    const md = formatMasterplanMarkdown(makePlan());
    assert.ok(md.includes('danteforge forge'), 'Forge command present');
  });

  it('includes competitor context when present', () => {
    const md = formatMasterplanMarkdown(makePlan());
    assert.ok(md.includes('Claude Code scores 7.8/10'), 'Competitor context present');
  });

  it('includes Action Items section', () => {
    const md = formatMasterplanMarkdown(makePlan());
    assert.ok(md.includes('Action Items'), 'Action Items section present');
  });
});

// ── loadMasterplan ────────────────────────────────────────────────────────────

describe('loadMasterplan', () => {
  it('returns null when file does not exist', async () => {
    const result = await loadMasterplan('/nonexistent/path/xyz');
    assert.equal(result, null);
  });

  it('round-trips masterplan through disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'masterplan-test-'));
    try {
      const written: string[] = [];
      const plan = await generateMasterplan(makeOptions({
        cwd: tmpDir,
        _writeFile: async (filePath, content) => {
          written.push(filePath);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, 'utf-8');
        },
        _mkdir: async (dir) => fs.mkdir(dir, { recursive: true }),
      }));

      const loaded = await loadMasterplan(tmpDir);
      assert.ok(loaded !== null, 'Plan loaded from disk');
      assert.equal(loaded!.overallScore, plan.overallScore);
      assert.equal(loaded!.items.length, plan.items.length);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});
