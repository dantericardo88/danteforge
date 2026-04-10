import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLessonEvents,
  captureAutoLesson,
  type AutoLessonsEvent,
  type AutoLessonContext,
} from '../src/core/auto-lessons.js';
import type { ToolchainMetrics } from '../src/core/pdse-toolchain.js';

function makeMetrics(overrides: Partial<ToolchainMetrics> = {}): ToolchainMetrics {
  return {
    tscErrors: 0, testsPassing: 10, testsFailing: 0,
    lintErrors: 0, coveragePct: null, gatherDurationMs: 0,
    ...overrides,
  };
}

// ── detectLessonEvents ────────────────────────────────────────────────────────

describe('detectLessonEvents', () => {
  it('returns empty array when no changes', () => {
    const prev = makeMetrics();
    const curr = makeMetrics();
    const events = detectLessonEvents(prev, curr, 75, 75);
    assert.deepEqual(events, []);
  });

  it('detects tsc_errors_increased', () => {
    const prev = makeMetrics({ tscErrors: 0 });
    const curr = makeMetrics({ tscErrors: 3 });
    const events = detectLessonEvents(prev, curr, null, null);
    assert.ok(events.includes('tsc_errors_increased'));
  });

  it('does NOT flag tsc_errors_increased when errors stayed same', () => {
    const prev = makeMetrics({ tscErrors: 2 });
    const curr = makeMetrics({ tscErrors: 2 });
    const events = detectLessonEvents(prev, curr, null, null);
    assert.ok(!events.includes('tsc_errors_increased'));
  });

  it('detects tests_regressed when failures increase', () => {
    const prev = makeMetrics({ testsFailing: 0 });
    const curr = makeMetrics({ testsFailing: 2 });
    const events = detectLessonEvents(prev, curr, null, null);
    assert.ok(events.includes('tests_regressed'));
  });

  it('does NOT flag tests_regressed when failures decreased', () => {
    const prev = makeMetrics({ testsFailing: 3 });
    const curr = makeMetrics({ testsFailing: 1 });
    const events = detectLessonEvents(prev, curr, null, null);
    assert.ok(!events.includes('tests_regressed'));
  });

  it('detects score_dropped when drop > 5', () => {
    const events = detectLessonEvents(null, null, 80, 74);
    assert.ok(events.includes('score_dropped'));
  });

  it('does NOT flag score_dropped when drop is exactly 5', () => {
    const events = detectLessonEvents(null, null, 80, 75);
    assert.ok(!events.includes('score_dropped'));
  });

  it('does NOT flag score_dropped when score increased', () => {
    const events = detectLessonEvents(null, null, 75, 80);
    assert.ok(!events.includes('score_dropped'));
  });

  it('returns multiple events at once', () => {
    const prev = makeMetrics({ tscErrors: 0, testsFailing: 0 });
    const curr = makeMetrics({ tscErrors: 2, testsFailing: 3 });
    const events = detectLessonEvents(prev, curr, 80, 70);
    assert.ok(events.includes('tsc_errors_increased'));
    assert.ok(events.includes('tests_regressed'));
    assert.ok(events.includes('score_dropped'));
  });

  it('handles null prevMetrics gracefully', () => {
    const curr = makeMetrics({ tscErrors: 5 });
    const events = detectLessonEvents(null, curr, null, null);
    assert.ok(!events.includes('tsc_errors_increased'));
  });

  it('handles null currMetrics gracefully', () => {
    const prev = makeMetrics();
    const events = detectLessonEvents(prev, null, null, null);
    assert.ok(!events.includes('tsc_errors_increased'));
  });
});

// ── captureAutoLesson ─────────────────────────────────────────────────────────

const ctx: AutoLessonContext = { cwd: '/fake', artifact: 'forge', prevValue: 5, currValue: 8, cycleCount: 3 };

describe('captureAutoLesson', () => {
  it('calls recordLesson for tsc_errors_increased', async () => {
    const calls: Array<[string, string, string, string]> = [];
    const recorder = async (cat: string, mistake: string, rule: string, src: string) => {
      calls.push([cat, mistake, rule, src]);
    };
    await captureAutoLesson('tsc_errors_increased', ctx, { _recordLesson: recorder });
    assert.equal(calls.length, 1);
    const [cat, , , src] = calls[0]!;
    assert.equal(cat, 'TypeScript');
    assert.equal(src, 'forge failure');
  });

  it('calls recordLesson for tests_regressed', async () => {
    const calls: string[] = [];
    await captureAutoLesson('tests_regressed', ctx, {
      _recordLesson: async (cat) => { calls.push(cat); },
    });
    assert.equal(calls[0], 'Testing');
  });

  it('calls recordLesson for score_dropped', async () => {
    const calls: string[] = [];
    await captureAutoLesson('score_dropped', { ...ctx, artifact: 'verify' }, {
      _recordLesson: async (cat) => { calls.push(cat); },
    });
    assert.equal(calls[0], 'Quality');
  });

  it('calls recordLesson for convergence_stalled', async () => {
    const calls: string[] = [];
    await captureAutoLesson('convergence_stalled', ctx, {
      _recordLesson: async (cat) => { calls.push(cat); },
    });
    assert.equal(calls[0], 'Workflow');
  });

  it('never throws even if recordLesson throws', async () => {
    await assert.doesNotReject(
      captureAutoLesson('score_dropped', ctx, {
        _recordLesson: async () => { throw new Error('disk full'); },
      }),
    );
  });

  it('includes artifact name in mistake for score_dropped', async () => {
    const calls: string[] = [];
    await captureAutoLesson('score_dropped', { ...ctx, artifact: 'SPEC' }, {
      _recordLesson: async (_, mistake) => { calls.push(mistake); },
    });
    assert.ok(calls[0]!.includes('SPEC'));
  });

  it('includes cycle count in mistake for convergence_stalled', async () => {
    const calls: string[] = [];
    await captureAutoLesson('convergence_stalled', { ...ctx, cycleCount: 7 }, {
      _recordLesson: async (_, mistake) => { calls.push(mistake); },
    });
    assert.ok(calls[0]!.includes('7'));
  });
});
