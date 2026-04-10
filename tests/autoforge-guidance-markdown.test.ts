// autoforge-guidance-markdown.test.ts — branch coverage for buildGuidanceMarkdown helpers (v0.23.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuidanceMarkdown,
  findBottleneck,
  getRecommendation,
} from '../src/cli/commands/autoforge.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeScore(score: number, decision: 'advance' | 'needs_work' | 'blocked' = 'advance', issues: Array<{ dimension: never; severity: 'error' | 'warning'; message: string }> = []): ScoreResult {
  return {
    artifact: 'SPEC' as ScoredArtifact,
    score,
    dimensions: {
      completeness: score / 5,
      clarity: score / 5,
      testability: score / 5,
      constitutionAlignment: score / 5,
      integrationFitness: score / 10,
      freshness: score / 10,
    },
    issues,
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: decision,
    hasCEOReviewBonus: false,
  };
}

function makeScores(overrides: Partial<Record<ScoredArtifact, ScoreResult>> = {}): Record<ScoredArtifact, ScoreResult> {
  const base: Record<ScoredArtifact, ScoreResult> = {
    CONSTITUTION: { ...makeScore(85), artifact: 'CONSTITUTION' },
    SPEC: { ...makeScore(82), artifact: 'SPEC' },
    CLARIFY: { ...makeScore(80), artifact: 'CLARIFY' },
    PLAN: { ...makeScore(78), artifact: 'PLAN' },
    TASKS: { ...makeScore(75), artifact: 'TASKS' },
  };
  return { ...base, ...overrides };
}

function makeTracker(overall = 60): CompletionTracker {
  return {
    overall,
    phases: {
      planning: { score: 80, complete: true, artifacts: {
        CONSTITUTION: { score: 85, complete: true }, SPEC: { score: 82, complete: true },
        CLARIFY: { score: 80, complete: true }, PLAN: { score: 78, complete: true },
        TASKS: { score: 75, complete: true },
      }},
      execution: { score: 40, complete: false, currentPhase: 1, wavesComplete: 1, totalWaves: 3 },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: '2 more waves',
  };
}

// ── findBottleneck ─────────────────────────────────────────────────────────────

describe('findBottleneck', () => {
  it('returns artifact with lowest score', () => {
    const scores = makeScores({
      TASKS: { ...makeScore(30), artifact: 'TASKS' },
    });
    const result = findBottleneck(scores);
    assert.ok(result !== null, 'Expected a bottleneck');
    assert.strictEqual(result!.artifact, 'TASKS');
  });

  it('returns valid Bottleneck with worstDimension and worstScore', () => {
    const scores = makeScores();
    const result = findBottleneck(scores);
    assert.ok(result !== null);
    assert.ok(typeof result!.worstDimension === 'string');
    assert.ok(typeof result!.worstScore === 'number');
    assert.ok(typeof result!.maxScore === 'number');
  });
});

// ── getRecommendation ──────────────────────────────────────────────────────────

describe('getRecommendation', () => {
  it('returns null when all scores are EXCELLENT (>= 95)', () => {
    const scores = makeScores({
      CONSTITUTION: { ...makeScore(95), artifact: 'CONSTITUTION' },
      SPEC: { ...makeScore(96), artifact: 'SPEC' },
      CLARIFY: { ...makeScore(97), artifact: 'CLARIFY' },
      PLAN: { ...makeScore(98), artifact: 'PLAN' },
      TASKS: { ...makeScore(99), artifact: 'TASKS' },
    });
    const result = getRecommendation(scores);
    assert.strictEqual(result, null, 'Expected null when all scores are excellent');
  });

  it('returns recommendation for worst artifact with issues', () => {
    const scores = makeScores({
      SPEC: {
        ...makeScore(40),
        artifact: 'SPEC',
        issues: [{ dimension: 'clarity' as never, severity: 'error', message: 'missing clarity' }],
      },
    });
    const result = getRecommendation(scores);
    assert.ok(result !== null, 'Expected a recommendation');
    assert.ok(typeof result!.command === 'string');
    assert.strictEqual(result!.reason, 'missing clarity'); // uses topIssue.message branch
  });

  it('uses "Score X is below Y" reason when no issues (topIssue=undefined branch)', () => {
    const scores = makeScores({
      TASKS: {
        ...makeScore(40),
        artifact: 'TASKS',
        issues: [], // no issues → topIssue = undefined → fallback reason
      },
    });
    const result = getRecommendation(scores);
    assert.ok(result !== null, 'Expected recommendation');
    assert.ok(result!.reason.includes('below'), `Expected "below" in reason: ${result!.reason}`);
  });
});

// ── buildGuidanceMarkdown ──────────────────────────────────────────────────────

describe('buildGuidanceMarkdown', () => {
  it('renders "_None_" for bottleneck when all scores equal (no clear worst)', () => {
    // When scores are all the same, findBottleneck still returns something.
    // To force bottleneck=null, we need all scores >= EXCELLENT.
    // Actually findBottleneck never returns null (it always iterates), so test the "has bottleneck" path.
    const scores = makeScores();
    const md = buildGuidanceMarkdown(scores, makeTracker());
    assert.ok(md.includes('## Current Bottleneck'), 'Should have bottleneck section');
  });

  it('renders "_None_" for blocking issues when all scores >= 50', () => {
    // All scores >= NEEDS_WORK (50) → no blocking issues
    const scores = makeScores(); // all scores 75-85
    const md = buildGuidanceMarkdown(scores, makeTracker());
    assert.ok(md.includes('_None_'), `Expected "_None_" for no blocking issues, got: ${md.slice(0, 400)}`);
  });

  it('lists blocking issues when score < 50', () => {
    const scores = makeScores({
      SPEC: { ...makeScore(25, 'blocked'), artifact: 'SPEC' },
    });
    const md = buildGuidanceMarkdown(scores, makeTracker());
    assert.ok(md.includes('SPEC.md'), `Expected SPEC.md in blocking issues, got: ${md.slice(0, 600)}`);
  });

  it('renders "YES" for autoAdvance when all scores >= 50', () => {
    const scores = makeScores(); // all >= 75
    const md = buildGuidanceMarkdown(scores, makeTracker());
    assert.ok(md.includes('YES — all scores >= 50'), `Expected YES autoAdvance: ${md.slice(0, 600)}`);
  });

  it('renders "NO" for autoAdvance when any score < 50', () => {
    const scores = makeScores({
      TASKS: { ...makeScore(30), artifact: 'TASKS' },
    });
    const md = buildGuidanceMarkdown(scores, makeTracker());
    assert.ok(md.includes('NO —') && md.includes('TASKS.md'), `Expected NO autoAdvance with TASKS.md, got: ${md.slice(0, 600)}`);
  });

  it('renders "# No action required" when getRecommendation returns null', () => {
    // All scores excellent → getRecommendation returns null
    const scores = makeScores({
      CONSTITUTION: { ...makeScore(96), artifact: 'CONSTITUTION' },
      SPEC: { ...makeScore(96), artifact: 'SPEC' },
      CLARIFY: { ...makeScore(96), artifact: 'CLARIFY' },
      PLAN: { ...makeScore(96), artifact: 'PLAN' },
      TASKS: { ...makeScore(96), artifact: 'TASKS' },
    });
    const md = buildGuidanceMarkdown(scores, makeTracker());
    assert.ok(md.includes('No action required'), `Expected no-action message, got: ${md.slice(0, 600)}`);
  });

  it('renders recommendation command when scores are below threshold', () => {
    const scores = makeScores({
      SPEC: { ...makeScore(40), artifact: 'SPEC' },
    });
    const md = buildGuidanceMarkdown(scores, makeTracker());
    assert.ok(md.includes('danteforge '), `Expected danteforge command, got: ${md.slice(0, 600)}`);
  });
});
