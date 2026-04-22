import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLessonEvents,
  extractDeterministicLessons,
  captureAutoLesson,
} from '../src/core/auto-lessons.js';
import type { AutoLessonContext } from '../src/core/auto-lessons.js';

function makeCtx(overrides: Partial<AutoLessonContext> = {}): AutoLessonContext {
  return {
    cycleCount: 1,
    prevValue: 0,
    currValue: 0,
    artifact: 'test.ts',
    ...overrides,
  };
}

describe('detectLessonEvents', () => {
  it('returns empty array when no changes', () => {
    const events = detectLessonEvents(null, null, null, null);
    assert.deepEqual(events, []);
  });

  it('detects tsc_errors_increased', () => {
    const prev = { tscErrors: 0, testsFailing: 0, testsPassing: 10 };
    const curr = { tscErrors: 3, testsFailing: 0, testsPassing: 10 };
    const events = detectLessonEvents(prev, curr, null, null);
    assert.ok(events.includes('tsc_errors_increased'));
  });

  it('detects tests_regressed', () => {
    const prev = { tscErrors: 0, testsFailing: 0, testsPassing: 10 };
    const curr = { tscErrors: 0, testsFailing: 2, testsPassing: 8 };
    const events = detectLessonEvents(prev, curr, null, null);
    assert.ok(events.includes('tests_regressed'));
  });

  it('detects score_dropped (more than 5 points)', () => {
    const events = detectLessonEvents(null, null, 80, 70);
    assert.ok(events.includes('score_dropped'));
  });

  it('does not detect score_dropped for small drop (5 or fewer points)', () => {
    const events = detectLessonEvents(null, null, 80, 75);
    assert.ok(!events.includes('score_dropped'));
  });

  it('returns multiple events when multiple conditions met', () => {
    const prev = { tscErrors: 0, testsFailing: 0, testsPassing: 10 };
    const curr = { tscErrors: 2, testsFailing: 1, testsPassing: 9 };
    const events = detectLessonEvents(prev, curr, 80, 70);
    assert.ok(events.length >= 2);
  });
});

describe('extractDeterministicLessons', () => {
  it('returns empty array for empty diff', () => {
    assert.deepEqual(extractDeterministicLessons(''), []);
    assert.deepEqual(extractDeterministicLessons('   '), []);
  });

  it('detects new exported symbols', () => {
    const diff = '+export function myNewFunction() {}\n+export const myConst = 42;';
    const lessons = extractDeterministicLessons(diff);
    assert.ok(lessons.length > 0);
    const combined = lessons.join('\n');
    assert.ok(combined.includes('Export'));
  });

  it('detects new test files', () => {
    const diff = '+++ b/tests/my-module.test.ts\n@@ -0,0 +1 @@\n+it("passes", () => {});';
    const lessons = extractDeterministicLessons(diff);
    assert.ok(lessons.length > 0);
    const combined = lessons.join('\n');
    assert.ok(combined.includes('test'));
  });

  it('detects injection seams', () => {
    const diff = '+  _readFile?: (p: string) => Promise<string>;';
    const lessons = extractDeterministicLessons(diff);
    assert.ok(lessons.length > 0);
    const combined = lessons.join('\n');
    assert.ok(combined.includes('injection'));
  });

  it('returns at most 2 lessons', () => {
    const diff = [
      '+export function foo() {}',
      '+export const bar = 1;',
      '+++ b/tests/a.test.ts',
      '+  _readFile?: () => void;',
    ].join('\n');
    const lessons = extractDeterministicLessons(diff);
    assert.ok(lessons.length <= 2);
  });

  it('returns empty for unrelated diff', () => {
    const diff = ' no changes here\n context line only';
    const lessons = extractDeterministicLessons(diff);
    assert.deepEqual(lessons, []);
  });
});

describe('captureAutoLesson', () => {
  it('does not throw when lesson is captured', async () => {
    let recorded = '';
    await assert.doesNotReject(() =>
      captureAutoLesson('tsc_errors_increased', makeCtx({ prevValue: 0, currValue: 3 }), {
        _recordLesson: async (entry) => { recorded = entry; },
      })
    );
    assert.ok(recorded.length > 0);
  });

  it('does not throw when _recordLesson fails', async () => {
    await assert.doesNotReject(() =>
      captureAutoLesson('score_dropped', makeCtx({ prevValue: 80, currValue: 65 }), {
        _recordLesson: async () => { throw new Error('write failed'); },
      })
    );
  });
});
