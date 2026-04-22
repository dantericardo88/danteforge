// Auto-Lessons Capture — detects metric regressions and automatically records lessons,
// and captures success patterns after passing verify cycles (OpenSpace CAPTURED mode).
import type { ToolchainMetrics } from './pdse-toolchain.js';
import type { VerifyReceipt } from './verify-receipts.js';

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

// ── Success Lesson Capture (OpenSpace CAPTURED mode) ──────────────────────────

export interface CaptureSuccessLessonsOpts {
  /** Injected LLM caller — defaults to callLLM from llm.ts */
  _llmCaller?: (prompt: string) => Promise<string>;
  /** Injected git diff runner — defaults to 3-strategy cascade starting with `git diff HEAD` */
  _gitDiff?: (cwd: string) => Promise<string>;
  /** Injected lesson appender — defaults to appendLesson from lessons.ts */
  _appendLesson?: (entry: string) => Promise<void>;
  /** Injected LLM availability check — defaults to isLLMAvailable() from llm.ts */
  _isLLMAvailable?: () => Promise<boolean>;
}

/**
 * After a verify cycle passes, extract 2-3 reusable patterns from the git diff
 * and append them to lessons.md. Best-effort — never throws, never blocks verify.
 *
 * Inspired by OpenSpace's CAPTURED mode: successful executions are as valuable
 * as failures for learning. Each forge→verify→pass cycle improves the next run.
 */
export async function captureSuccessLessons(
  receipt: VerifyReceipt,
  cwd: string,
  opts: CaptureSuccessLessonsOpts = {},
): Promise<{ captured: number }> {
  // Only capture on pass or warn — not on fail
  if (receipt.status === 'fail') return { captured: 0 };

  const diffFn = opts._gitDiff ?? defaultGitDiff;
  // Close over cwd so the default appender writes to the right project directory.
  // The _appendLesson injection type stays as (entry: string) => Promise<void> for
  // backward compat — existing tests that pass plain lambdas are unaffected.
  const appendFn = opts._appendLesson ?? ((entry: string) => defaultAppendLesson(entry, cwd));
  const isAvailable = opts._isLLMAvailable ?? defaultIsLLMAvailable;

  // Get what changed during this forge phase (working tree, staged, or last commit)
  let diff = '';
  try { diff = await diffFn(cwd); } catch { return { captured: 0 }; }
  if (!diff.trim()) return { captured: 0 };

  let lessons: string[] = [];

  // Try LLM extraction first — richer, context-aware patterns
  const llmAvailable = await isAvailable().catch(() => false);
  if (llmAvailable) {
    const llmFn = opts._llmCaller ?? defaultSuccessLLMCaller;
    try {
      const raw = await llmFn(buildSuccessExtractionPrompt(receipt, diff));
      lessons = parseSuccessLessons(raw);
    } catch { /* fall through to deterministic */ }
  }

  // Deterministic fallback — zero LLM, works for every user including zero-API-key
  if (lessons.length === 0) {
    lessons = extractDeterministicLessons(diff);
  }

  if (lessons.length === 0) return { captured: 0 };

  // Append up to 3 lessons (cap to avoid noise)
  let captured = 0;
  for (const entry of lessons.slice(0, 3)) {
    try { await appendFn(entry); captured++; } catch { /* best-effort — never block */ }
  }
  return { captured };
}

/**
 * Deterministic (zero-LLM) pattern extraction from a git diff.
 * Detects three high-signal patterns: new exports, new test files, injection seams.
 * Works for all users regardless of LLM configuration.
 */
export function extractDeterministicLessons(diff: string): string[] {
  if (!diff.trim()) return [];
  const timestamp = new Date().toISOString();
  const lessons: string[] = [];

  // Pattern 1: new exported symbols — export function/const/class/interface/type
  const newExports = [...diff.matchAll(/^\+export (?:function|const|class|interface|type) (\w+)/gm)]
    .map(m => m[1]).filter(Boolean);
  if (newExports.length > 0) {
    const names = [...new Set(newExports)].slice(0, 3).join(', ');
    lessons.push(
      `## [code] Export new symbols explicitly at the module boundary\n` +
      `_Added: ${timestamp}_\n_Source: verify success (CAPTURED — deterministic)_\n\n` +
      `**Rule:** Export new functions, types, and interfaces explicitly — found: ${names}`,
    );
  }

  // Pattern 2: new test files added (*.test.ts/js/tsx/jsx)
  const newTestFiles = [...diff.matchAll(/^\+\+\+ b\/(.*\.test\.[tj]sx?)/gm)]
    .map(m => m[1]).filter(Boolean);
  if (newTestFiles.length > 0) {
    lessons.push(
      `## [test] Co-locate tests with new implementations\n` +
      `_Added: ${timestamp}_\n_Source: verify success (CAPTURED — deterministic)_\n\n` +
      `**Rule:** Add test files alongside new features — found: ${newTestFiles.slice(0, 2).join(', ')}`,
    );
  }

  // Pattern 3: injection seams added (_camelCase?: type pattern)
  if (/^\+.*_[a-z][a-zA-Z]+\?:/m.test(diff)) {
    lessons.push(
      `## [architecture] Use optional injection parameters for testability\n` +
      `_Added: ${timestamp}_\n_Source: verify success (CAPTURED — deterministic)_\n\n` +
      `**Rule:** Add optional underscore-prefixed parameters to functions that call external dependencies`,
    );
  }

  return lessons.slice(0, 2); // max 2 deterministic lessons to avoid noise
}

export function buildSuccessExtractionPrompt(receipt: VerifyReceipt, diff: string): string {
  const passedList = receipt.passed.join(', ') || 'none';
  const warnList = receipt.warnings.join(', ') || 'none';
  const truncatedDiff = diff.length > 4000 ? diff.slice(0, 4000) + '\n[truncated]' : diff;

  return `You are a code quality analyst. A DanteForge verify cycle just passed.

Verify result:
- Status: ${receipt.status}
- Checks passed: ${passedList}
- Warnings: ${warnList}

Git diff of changes made during this forge phase:
${truncatedDiff}

Extract 2-3 specific, reusable patterns from the SUCCESSFUL changes above.
For each pattern, output exactly this format (no deviations):

CATEGORY: <code|architecture|test|ux|performance>
RULE: <one concrete rule an AI should follow — start with a verb>
CONTEXT: <when this rule applies — one sentence>
SEVERITY: <critical|important|nice-to-know>

Only include patterns genuinely useful across different projects.
Do NOT include this project's specific business logic or names.
Do NOT invent patterns not visible in the diff.
If no generalizable patterns exist, output exactly: NO_PATTERNS`;
}

export function parseSuccessLessons(raw: string): string[] {
  if (!raw || raw.trim().startsWith('NO_PATTERNS')) return [];

  const timestamp = new Date().toISOString();
  const blocks = raw.split(/\n(?=CATEGORY:)/);
  const entries: string[] = [];

  for (const block of blocks) {
    const category = (block.match(/^CATEGORY:\s*(.+)$/m) ?? [])[1]?.trim();
    const rule = (block.match(/^RULE:\s*(.+)$/m) ?? [])[1]?.trim();
    const context = (block.match(/^CONTEXT:\s*(.+)$/m) ?? [])[1]?.trim();
    const severity = (block.match(/^SEVERITY:\s*(.+)$/m) ?? [])[1]?.trim();

    if (!category || !rule) continue;

    const title = rule.length > 80 ? rule.slice(0, 77) + '...' : rule;
    entries.push(
      `## [${category}] ${title}\n` +
      `_Added: ${timestamp}_\n` +
      `_Source: verify success (CAPTURED)_\n` +
      (context ? `_Context: ${context}_\n` : '') +
      (severity ? `_Severity: ${severity}_\n` : '') +
      `\n**Rule:** ${rule}`,
    );
  }

  return entries;
}

async function defaultGitDiff(cwd: string): Promise<string> {
  const { execFileSync } = await import('node:child_process');
  const base = { cwd, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'], timeout: 10_000 };
  const flags = ['--unified=3', '--no-color'];

  // Strategy 1: working tree vs HEAD — captures Edit/Write/Bash disk changes without any commit
  try {
    const diff = execFileSync('git', ['diff', 'HEAD', ...flags], base);
    if (diff.trim()) return diff;
  } catch { /* try next */ }

  // Strategy 2: staged changes — captures `git add`'d files
  try {
    const diff = execFileSync('git', ['diff', '--cached', ...flags], base);
    if (diff.trim()) return diff;
  } catch { /* try next */ }

  // Strategy 3: last commit vs previous — captures committed work
  try {
    return execFileSync('git', ['diff', 'HEAD~1', 'HEAD', ...flags], base);
  } catch {
    return '';
  }
}

async function defaultIsLLMAvailable(): Promise<boolean> {
  try {
    const { isLLMAvailable } = await import('./llm.js');
    return isLLMAvailable();
  } catch {
    return false;
  }
}

async function defaultSuccessLLMCaller(prompt: string): Promise<string> {
  const { callLLM } = await import('./llm.js');
  return callLLM(prompt, undefined, { enrichContext: false, recordMemory: false });
}

async function defaultAppendLesson(entry: string, cwd?: string): Promise<void> {
  const { appendLesson } = await import('../cli/commands/lessons.js');
  await appendLesson(entry, cwd);
}
