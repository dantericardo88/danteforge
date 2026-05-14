// tests/lesson-impact-tracker.test.ts
// Tests for src/core/lesson-impact-tracker.ts

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  recordLessonApplication,
  measureLessonOutcome,
  computeImpactReport,
  formatImpactReport,
  type LessonImpact,
  type ImpactReport,
} from '../src/core/lesson-impact-tracker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'df-impact-test-'));
}

function makeImpact(overrides: Partial<Omit<LessonImpact, 'improvement'>> = {}): Omit<LessonImpact, 'improvement'> {
  return {
    lessonId: 'lesson-abc',
    lessonText: 'Always validate input before processing',
    appliedAt: new Date().toISOString(),
    scoreBeforeApply: 7.0,
    scoreAfterApply: null,
    dimensionId: 'testing',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('recordLessonApplication', () => {
  let tmpDir: string;
  before(async () => { tmpDir = await makeTmpDir(); await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true }); });
  after(async () => { try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ok */ } });

  it('writes a new entry to the JSONL file', async () => {
    const impact = makeImpact({ lessonId: 'lesson-001' });
    await recordLessonApplication(tmpDir, impact);
    const raw = await fs.readFile(path.join(tmpDir, '.danteforge', 'lesson-impacts.jsonl'), 'utf8');
    const parsed = JSON.parse(raw.trim().split('\n')[0]!) as LessonImpact;
    assert.equal(parsed.lessonId, 'lesson-001');
    assert.equal(parsed.scoreAfterApply, null);
    assert.equal(parsed.improvement, null);
  });

  it('appends multiple entries without overwriting', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await recordLessonApplication(dir, makeImpact({ lessonId: 'a' }));
      await recordLessonApplication(dir, makeImpact({ lessonId: 'b' }));
      const raw = await fs.readFile(path.join(dir, '.danteforge', 'lesson-impacts.jsonl'), 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      assert.equal(lines.length, 2);
      const ids = lines.map(l => (JSON.parse(l) as LessonImpact).lessonId);
      assert.deepEqual(ids, ['a', 'b']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('creates the .danteforge directory if it does not exist', async () => {
    const dir = await makeTmpDir();
    try {
      // do NOT pre-create .danteforge
      await recordLessonApplication(dir, makeImpact({ lessonId: 'mkdir-test' }));
      const raw = await fs.readFile(path.join(dir, '.danteforge', 'lesson-impacts.jsonl'), 'utf8');
      assert.ok(raw.includes('mkdir-test'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('stores improvement as null when scoreAfterApply is null', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await recordLessonApplication(dir, makeImpact({ scoreAfterApply: null }));
      const raw = await fs.readFile(path.join(dir, '.danteforge', 'lesson-impacts.jsonl'), 'utf8');
      const parsed = JSON.parse(raw.trim()) as LessonImpact;
      assert.equal(parsed.improvement, null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('measureLessonOutcome', () => {
  it('updates the matching entry with scoreAfterApply and computes improvement', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await recordLessonApplication(dir, makeImpact({ lessonId: 'measure-01', scoreBeforeApply: 7.0 }));
      await measureLessonOutcome(dir, 'measure-01', 8.5);
      const raw = await fs.readFile(path.join(dir, '.danteforge', 'lesson-impacts.jsonl'), 'utf8');
      const parsed = JSON.parse(raw.trim().split('\n')[0]!) as LessonImpact;
      assert.equal(parsed.scoreAfterApply, 8.5);
      assert.equal(parsed.improvement, 1.5);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('updates the MOST RECENT entry when multiple share the same lessonId', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await recordLessonApplication(dir, makeImpact({ lessonId: 'dup', scoreBeforeApply: 5.0 }));
      await recordLessonApplication(dir, makeImpact({ lessonId: 'dup', scoreBeforeApply: 6.0 }));
      await measureLessonOutcome(dir, 'dup', 9.0);
      const raw = await fs.readFile(path.join(dir, '.danteforge', 'lesson-impacts.jsonl'), 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      const first = JSON.parse(lines[0]!) as LessonImpact;
      const second = JSON.parse(lines[1]!) as LessonImpact;
      assert.equal(first.scoreAfterApply, null); // oldest untouched
      assert.equal(second.scoreAfterApply, 9.0); // newest updated
      assert.equal(second.improvement, 3.0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('silently does nothing when lessonId is not found', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await recordLessonApplication(dir, makeImpact({ lessonId: 'known' }));
      // should not throw
      await measureLessonOutcome(dir, 'unknown-id', 9.0);
      const raw = await fs.readFile(path.join(dir, '.danteforge', 'lesson-impacts.jsonl'), 'utf8');
      const parsed = JSON.parse(raw.trim()) as LessonImpact;
      assert.equal(parsed.scoreAfterApply, null); // unchanged
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('computeImpactReport', () => {
  it('returns zero counts for empty file', async () => {
    const dir = await makeTmpDir();
    try {
      const report = await computeImpactReport(dir);
      assert.equal(report.totalLessons, 0);
      assert.equal(report.measuredLessons, 0);
      assert.equal(report.avgImprovement, null);
      assert.deepEqual(report.topLessons, []);
      assert.deepEqual(report.staleLessons, []);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('computes avgImprovement correctly across measured lessons', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await recordLessonApplication(dir, makeImpact({ lessonId: 'x1', scoreBeforeApply: 6.0 }));
      await recordLessonApplication(dir, makeImpact({ lessonId: 'x2', scoreBeforeApply: 7.0 }));
      await measureLessonOutcome(dir, 'x1', 8.0); // improvement 2.0
      await measureLessonOutcome(dir, 'x2', 9.0); // improvement 2.0
      const report = await computeImpactReport(dir);
      assert.equal(report.measuredLessons, 2);
      assert.equal(report.avgImprovement, 2.0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null avgImprovement when no lessons are measured', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await recordLessonApplication(dir, makeImpact({ lessonId: 'unmeasured' }));
      const report = await computeImpactReport(dir);
      assert.equal(report.avgImprovement, null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('limits topLessons to 5 entries, sorted by improvement descending', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      for (let i = 1; i <= 7; i++) {
        await recordLessonApplication(dir, makeImpact({ lessonId: `l${i}`, scoreBeforeApply: 5.0 }));
        await measureLessonOutcome(dir, `l${i}`, 5.0 + i); // improvements: 1..7
      }
      const report = await computeImpactReport(dir);
      assert.equal(report.topLessons.length, 5);
      // should be sorted descending
      assert.equal(report.topLessons[0]!.improvement, 7);
      assert.equal(report.topLessons[4]!.improvement, 3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('identifies stale lessons (applied >7 days ago, not measured)', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      const oldDate = new Date(Date.now() - 9 * 86_400_000).toISOString(); // 9 days ago
      await recordLessonApplication(dir, makeImpact({ lessonId: 'stale', appliedAt: oldDate }));
      const report = await computeImpactReport(dir, { _now: () => Date.now() });
      assert.equal(report.staleLessons.length, 1);
      assert.equal(report.staleLessons[0]!.lessonId, 'stale');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not include recently applied lessons in staleLessons', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      await recordLessonApplication(dir, makeImpact({ lessonId: 'fresh' })); // applied now
      const report = await computeImpactReport(dir, { _now: () => Date.now() });
      assert.equal(report.staleLessons.length, 0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not include measured lessons in staleLessons', async () => {
    const dir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
      const oldDate = new Date(Date.now() - 9 * 86_400_000).toISOString();
      await recordLessonApplication(dir, makeImpact({ lessonId: 'old-measured', appliedAt: oldDate }));
      await measureLessonOutcome(dir, 'old-measured', 9.0);
      const report = await computeImpactReport(dir, { _now: () => Date.now() });
      assert.equal(report.staleLessons.length, 0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('formatImpactReport', () => {
  it('returns markdown with correct headers', () => {
    const report: ImpactReport = {
      totalLessons: 3,
      measuredLessons: 2,
      avgImprovement: 1.5,
      topLessons: [],
      staleLessons: [],
    };
    const md = formatImpactReport(report);
    assert.ok(md.includes('## Lesson Impact Report'));
    assert.ok(md.includes('3'));
    assert.ok(md.includes('1.500'));
  });

  it('shows — for avgImprovement when null', () => {
    const report: ImpactReport = {
      totalLessons: 1,
      measuredLessons: 0,
      avgImprovement: null,
      topLessons: [],
      staleLessons: [],
    };
    const md = formatImpactReport(report);
    assert.ok(md.includes('—'));
  });

  it('includes top lessons table when topLessons is non-empty', () => {
    const lesson: LessonImpact = {
      lessonId: 'l1',
      lessonText: 'Test lesson text',
      appliedAt: '2026-05-01T00:00:00Z',
      scoreBeforeApply: 7.0,
      scoreAfterApply: 9.0,
      dimensionId: 'testing',
      improvement: 2.0,
    };
    const report: ImpactReport = {
      totalLessons: 1,
      measuredLessons: 1,
      avgImprovement: 2.0,
      topLessons: [lesson],
      staleLessons: [],
    };
    const md = formatImpactReport(report);
    assert.ok(md.includes('### Top Lessons by Impact'));
    assert.ok(md.includes('Test lesson text'));
  });

  it('includes stale lessons section when staleLessons is non-empty', () => {
    const stale: LessonImpact = {
      lessonId: 'stale-1',
      lessonText: 'A stale lesson',
      appliedAt: '2026-04-01T00:00:00Z',
      scoreBeforeApply: 6.0,
      scoreAfterApply: null,
      dimensionId: 'workflow',
      improvement: null,
    };
    const report: ImpactReport = {
      totalLessons: 1,
      measuredLessons: 0,
      avgImprovement: null,
      topLessons: [],
      staleLessons: [stale],
    };
    const md = formatImpactReport(report);
    assert.ok(md.includes('### Stale Lessons'));
    assert.ok(md.includes('stale-1'));
  });

  it('includes a no-data message when totalLessons is 0', () => {
    const report: ImpactReport = {
      totalLessons: 0,
      measuredLessons: 0,
      avgImprovement: null,
      topLessons: [],
      staleLessons: [],
    };
    const md = formatImpactReport(report);
    assert.ok(md.includes('_No lesson applications recorded yet._'));
  });
});
