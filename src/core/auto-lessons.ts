// Auto-Lessons Capture — detects metric regressions and automatically records lessons
// Zero LLM calls. Pure event detection + deterministic lesson templates.
import type { ToolchainMetrics } from './pdse-toolchain.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AutoLessonsEvent =
  | 'tsc_errors_increased'
  | 'tests_regressed'
  | 'score_dropped'
  | 'convergence_stalled';

export type RecordLessonFn = (
  category: string,
  mistake: string,
  rule: string,
  source: 'forge failure' | 'verify failure' | 'party failure' | 'manual',
) => Promise<void>;

export interface AutoLessonContext {
  artifact?: string;
  prevValue?: number;
  currValue?: number;
  cycleCount?: number;
  cwd: string;
}

export interface CaptureAutoLessonOptions {
  _recordLesson?: RecordLessonFn;
}

// ── Event detection (pure function — zero I/O) ────────────────────────────────

/**
 * Compare previous and current metrics/scores to detect regression events.
 * Pure function — safe to call in any context.
 */
export function detectLessonEvents(
  prevMetrics: ToolchainMetrics | null,
  currMetrics: ToolchainMetrics | null,
  prevScore: number | null,
  currScore: number | null,
): AutoLessonsEvent[] {
  const events: AutoLessonsEvent[] = [];

  if (currMetrics && prevMetrics) {
    if (currMetrics.tscErrors > prevMetrics.tscErrors) {
      events.push('tsc_errors_increased');
    }
    if (currMetrics.testsFailing > prevMetrics.testsFailing) {
      events.push('tests_regressed');
    }
  }

  if (currScore !== null && prevScore !== null && currScore < prevScore - 5) {
    events.push('score_dropped');
  }

  return events;
}

// ── Lesson templates ──────────────────────────────────────────────────────────

function buildLessonContent(event: AutoLessonsEvent, ctx: AutoLessonContext): {
  category: string;
  mistake: string;
  rule: string;
} {
  const prev = ctx.prevValue ?? 0;
  const curr = ctx.currValue ?? 0;
  const delta = Math.abs(curr - prev);
  const cycle = ctx.cycleCount ?? 0;
  const artifact = ctx.artifact ?? 'artifact';

  switch (event) {
    case 'tsc_errors_increased':
      return {
        category: 'TypeScript',
        mistake: `TypeScript errors increased from ${prev} to ${curr} during autoforge cycle ${cycle}`,
        rule: `tsc errors increased from ${prev} to ${curr} — investigate type errors before next forge wave`,
      };
    case 'tests_regressed':
      return {
        category: 'Testing',
        mistake: `Test failures increased from ${prev} to ${curr} during autoforge cycle ${cycle}`,
        rule: `test failures increased from ${prev} to ${curr} — do not advance until all tests are green`,
      };
    case 'score_dropped':
      return {
        category: 'Quality',
        mistake: `PDSE score for ${artifact} dropped ${delta.toFixed(0)} points (${prev.toFixed(0)} → ${curr.toFixed(0)}) at cycle ${cycle}`,
        rule: `PDSE score dropped ${delta.toFixed(0)} pts — review last forge changes and check for regressions`,
      };
    case 'convergence_stalled':
      return {
        category: 'Workflow',
        mistake: `Autoforge convergence stalled after ${cycle} cycles without reaching target score`,
        rule: `autoforge stalled at cycle ${cycle} — manual review required; consider adjusting target or breaking into smaller waves`,
      };
  }
}

// ── Auto-capture ──────────────────────────────────────────────────────────────

/**
 * Record a structured auto-lesson based on a detected event.
 * Best-effort — never throws. Uses deterministic templates, zero LLM.
 */
export async function captureAutoLesson(
  event: AutoLessonsEvent,
  context: AutoLessonContext,
  opts?: CaptureAutoLessonOptions,
): Promise<void> {
  try {
    const recordLesson = opts?._recordLesson ?? (await importRecordLesson());
    const { category, mistake, rule } = buildLessonContent(event, context);
    await recordLesson(category, mistake, rule, 'forge failure');
  } catch {
    // Non-fatal — auto-lesson capture should never block main path
  }
}

/** Lazy import of recordLesson to avoid circular deps and keep module testable without FS. */
async function importRecordLesson(): Promise<RecordLessonFn> {
  const { recordLesson } = await import('../cli/commands/lessons.js');
  return recordLesson as RecordLessonFn;
}
