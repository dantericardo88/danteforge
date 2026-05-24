// lesson-classifier.test.ts — Tests for src/core/lesson-classifier.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLesson,
  deduplicateLessons,
  getLessonsByCategory,
  computeLessonStats,
  type ClassifiedLesson,
  type LessonCategory,
} from '../src/core/lesson-classifier.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLesson(content: string, overrides: Partial<ClassifiedLesson> = {}): ClassifiedLesson {
  return {
    id: 'deadbeef',
    category: 'tooling',
    content,
    confidence: 0.75,
    tags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── classifyLesson ─────────────────────────────────────────────────────────────

describe('classifyLesson', () => {
  it('detects root-cause from "root cause" keyword', () => {
    const result = classifyLesson(
      'The root cause of the failure was missing null checks in the parser.',
    );
    assert.strictEqual(result.category, 'root-cause');
  });

  it('detects root-cause from "five whys" keyword', () => {
    const result = classifyLesson(
      'Ran five whys analysis: missing test coverage led to the regression.',
    );
    assert.strictEqual(result.category, 'root-cause');
  });

  it('detects root-cause from "7 levels" keyword', () => {
    const result = classifyLesson('Used 7 levels deep to trace the issue back to state.ts.');
    assert.strictEqual(result.category, 'root-cause');
  });

  it('detects pattern from "pattern" keyword', () => {
    const result = classifyLesson(
      'Harvested this pattern from an open-source repository for resilient retry logic.',
    );
    assert.strictEqual(result.category, 'pattern');
  });

  it('detects pattern from "adopted from" phrase', () => {
    const result = classifyLesson('This approach was adopted from the GSD wave executor design.');
    assert.strictEqual(result.category, 'pattern');
  });

  it('detects anti-pattern from "avoid" keyword', () => {
    const result = classifyLesson(
      'Avoid using synchronous file I/O in hot paths — it blocks the event loop.',
    );
    assert.strictEqual(result.category, 'anti-pattern');
  });

  it('detects anti-pattern from "broken" keyword', () => {
    const result = classifyLesson('The old approach is broken — regex cannot distinguish declarations from calls.');
    assert.strictEqual(result.category, 'anti-pattern');
  });

  it('detects calibration from "score" and "dimension" keywords', () => {
    const result = classifyLesson(
      'Calibrate the score for the autonomy dimension using the adversarial scorer.',
    );
    assert.strictEqual(result.category, 'calibration');
  });

  it('detects workflow from "pipeline" keyword', () => {
    const result = classifyLesson(
      'The pipeline should run constitution → spec → clarify → plan → tasks → forge.',
    );
    assert.strictEqual(result.category, 'workflow');
  });

  it('defaults to tooling when no keywords match', () => {
    const result = classifyLesson('Updated the tsup configuration to use object-form entry.');
    assert.strictEqual(result.category, 'tooling');
  });

  it('returns an id of exactly 8 hex characters', () => {
    const result = classifyLesson('Some content here.');
    assert.match(result.id, /^[0-9a-f]{8}$/);
  });

  it('returns the same id for the same content (deterministic)', () => {
    const content = 'Deterministic hashing test.';
    assert.strictEqual(classifyLesson(content).id, classifyLesson(content).id);
  });

  it('returns different ids for different content', () => {
    assert.notStrictEqual(
      classifyLesson('Content A').id,
      classifyLesson('Content B').id,
    );
  });

  it('confidence is between 0 and 1 inclusive', () => {
    const samples = [
      'root cause analysis with five whys',
      'avoid this pattern',
      'Some tooling note',
      'score calibration adversarial dimension metric',
    ];
    for (const s of samples) {
      const { confidence } = classifyLesson(s);
      assert.ok(confidence >= 0, `confidence ${confidence} < 0 for: "${s}"`);
      assert.ok(confidence <= 1, `confidence ${confidence} > 1 for: "${s}"`);
    }
  });
});

// ── deduplicateLessons ─────────────────────────────────────────────────────────

describe('deduplicateLessons', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(deduplicateLessons([]), []);
  });

  it('returns single lesson unchanged', () => {
    const lesson = makeLesson('Only one lesson here.');
    const result = deduplicateLessons([lesson]);
    assert.strictEqual(result.length, 1);
  });

  it('removes near-duplicate lessons (>70% word overlap)', () => {
    const base = 'Avoid synchronous file reading in hot paths because it blocks the event loop entirely';
    const dup =  'Avoid synchronous file reading in hot paths because it blocks the event loop totally';
    const lessons = [
      makeLesson(base, { confidence: 0.90, id: 'aaa' }),
      makeLesson(dup, { confidence: 0.70, id: 'bbb' }),
    ];
    const result = deduplicateLessons(lessons);
    assert.strictEqual(result.length, 1);
    // Should keep higher-confidence one
    assert.strictEqual(result[0]!.id, 'aaa');
  });

  it('keeps distinct lessons that share few words', () => {
    const lessons = [
      makeLesson('Use the root cause analysis framework.', { id: 'a1' }),
      makeLesson('Configure tsup with object-form entry points.', { id: 'b2' }),
    ];
    const result = deduplicateLessons(lessons);
    assert.strictEqual(result.length, 2);
  });

  it('keeps the higher-confidence lesson when removing a duplicate', () => {
    const base = 'The pipeline workflow sequence should run forge after plan and tasks steps completed';
    const dup  = 'The pipeline workflow sequence should run forge after plan and tasks steps done';
    const lessons = [
      makeLesson(base, { confidence: 0.60, id: 'low' }),
      makeLesson(dup,  { confidence: 0.95, id: 'high' }),
    ];
    const result = deduplicateLessons(lessons);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.id, 'high');
  });
});

// ── getLessonsByCategory ───────────────────────────────────────────────────────

describe('getLessonsByCategory', () => {
  const lessons: ClassifiedLesson[] = [
    makeLesson('root cause lesson', { category: 'root-cause', id: 'r1' }),
    makeLesson('pattern lesson',    { category: 'pattern',    id: 'p1' }),
    makeLesson('tooling lesson',    { category: 'tooling',    id: 't1' }),
    makeLesson('another pattern',   { category: 'pattern',    id: 'p2' }),
  ];

  it('filters by root-cause', () => {
    const result = getLessonsByCategory(lessons, 'root-cause');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.id, 'r1');
  });

  it('filters by pattern and returns all matching', () => {
    const result = getLessonsByCategory(lessons, 'pattern');
    assert.strictEqual(result.length, 2);
  });

  it('returns empty array when category has no lessons', () => {
    const result = getLessonsByCategory(lessons, 'workflow');
    assert.strictEqual(result.length, 0);
  });
});

// ── computeLessonStats ─────────────────────────────────────────────────────────

describe('computeLessonStats', () => {
  it('returns zeros for empty array', () => {
    const stats = computeLessonStats([]);
    assert.strictEqual(stats.total, 0);
    assert.strictEqual(stats.avgConfidence, 0);
  });

  it('counts total correctly', () => {
    const lessons = [
      makeLesson('a', { category: 'tooling', confidence: 0.8 }),
      makeLesson('b', { category: 'pattern', confidence: 0.6 }),
    ];
    const stats = computeLessonStats(lessons);
    assert.strictEqual(stats.total, 2);
  });

  it('counts byCategory correctly', () => {
    const lessons: ClassifiedLesson[] = [
      makeLesson('a', { category: 'tooling',      confidence: 0.7 }),
      makeLesson('b', { category: 'tooling',      confidence: 0.8 }),
      makeLesson('c', { category: 'root-cause',   confidence: 0.9 }),
      makeLesson('d', { category: 'anti-pattern', confidence: 0.85 }),
    ];
    const stats = computeLessonStats(lessons);
    assert.strictEqual(stats.byCategory['tooling'], 2);
    assert.strictEqual(stats.byCategory['root-cause'], 1);
    assert.strictEqual(stats.byCategory['anti-pattern'], 1);
    assert.strictEqual(stats.byCategory['pattern'], 0);
  });

  it('computes avgConfidence correctly', () => {
    const lessons: ClassifiedLesson[] = [
      makeLesson('a', { confidence: 0.80 }),
      makeLesson('b', { confidence: 0.60 }),
    ];
    const stats = computeLessonStats(lessons);
    // (0.80 + 0.60) / 2 = 0.70
    assert.strictEqual(stats.avgConfidence, 0.70);
  });

  it('avgConfidence is between 0 and 1', () => {
    const lessons: ClassifiedLesson[] = [
      makeLesson('x', { confidence: 0.55 }),
      makeLesson('y', { confidence: 0.99 }),
    ];
    const { avgConfidence } = computeLessonStats(lessons);
    assert.ok(avgConfidence >= 0 && avgConfidence <= 1);
  });
});
