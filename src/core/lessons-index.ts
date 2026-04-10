// Lessons Index — Structured lesson storage and keyword-based retrieval
// Enhances the existing lessons.ts with categorization and prompt injection.

import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import type { SevenLevelsResult } from './seven-levels.js';

const LESSONS_FILE_RELATIVE = path.join('.danteforge', 'lessons.md');
const MAX_LESSONS_FILE_SIZE_BYTES = 524_288; // 512 KB

/**
 * Strip prompt injection markers from lesson content before injecting into LLM prompts.
 * Replaces patterns that could redirect the LLM's attention or override instructions.
 */
export function stripPromptInjectionMarkers(content: string): string {
  return content.replace(
    /\n(?:\[SYSTEM\]|Ignore previous|You are now|You are |===+|###\s*SYSTEM|SYSTEM:)/gi,
    '\n[FILTERED]',
  );
}

export interface LessonsIndexOptions {
  cwd?: string;
  _stat?: (p: string) => Promise<{ size: number }>;
  _readFile?: (p: string) => Promise<string>;
}

export interface StructuredLesson {
  id: string;
  timestamp: string;
  category: 'design' | 'code' | 'test' | 'deploy' | 'architecture' | 'ux' | 'performance' | 'root_cause';
  severity: 'critical' | 'important' | 'nice-to-know';
  rule: string;
  context: string;
  tags: string[];
}

/**
 * Parse the lessons.md file into structured lessons.
 * Applies file size limit (512KB) and strips prompt injection markers before parsing.
 */
export async function indexLessons(opts?: LessonsIndexOptions): Promise<StructuredLesson[]> {
  try {
    const cwd = opts?.cwd ?? process.cwd();
    const filePath = path.isAbsolute(LESSONS_FILE_RELATIVE)
      ? LESSONS_FILE_RELATIVE
      : path.join(cwd, LESSONS_FILE_RELATIVE);
    const statFn = opts?._stat ?? fs.stat;
    const readFn = opts?._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    try {
      const { size } = await statFn(filePath);
      if (size > MAX_LESSONS_FILE_SIZE_BYTES) {
        logger.warn(`[lessons-index] lessons.md is too large (${size} bytes, limit ${MAX_LESSONS_FILE_SIZE_BYTES}) — skipping injection`);
        return [];
      }
    } catch {
      // ENOENT — file doesn't exist yet
    }
    const raw = await readFn(filePath);
    const safe = stripPromptInjectionMarkers(raw);
    return parseLessons(safe);
  } catch {
    return [];
  }
}

/**
 * Query lessons by keywords. Returns lessons matching any keyword.
 */
export async function queryLessons(keywords: string[], opts?: LessonsIndexOptions): Promise<StructuredLesson[]> {
  const lessons = await indexLessons(opts);
  if (keywords.length === 0) return lessons;

  const lowerKeywords = keywords.map(k => k.toLowerCase());
  return lessons.filter(lesson => {
    const searchText = `${lesson.rule} ${lesson.context} ${lesson.tags.join(' ')}`.toLowerCase();
    return lowerKeywords.some(kw => searchText.includes(kw));
  });
}

/**
 * Inject relevant lessons into an LLM prompt as context.
 * Appends a "## Lessons Learned" section with matching rules.
 */
export async function injectRelevantLessons(prompt: string, maxLessons = 5, opts?: LessonsIndexOptions): Promise<string> {
  // Extract keywords from the prompt
  const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const uniqueWords = [...new Set(words)].slice(0, 10);

  const relevant = await queryLessons(uniqueWords, opts);
  if (relevant.length === 0) return prompt;

  const topLessons = relevant
    .sort((a, b) => {
      const severityOrder = { critical: 0, important: 1, 'nice-to-know': 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })
    .slice(0, maxLessons);

  const lessonsSection = topLessons
    .map(l => {
      if (l.category === 'root_cause') {
        const domain = l.tags.find(t => t !== 'root_cause' && t !== 'seven-levels-deep') ?? 'unknown';
        return `- [ROOT_CAUSE:${domain.toUpperCase()}] ${l.rule}`;
      }
      return `- [${l.severity.toUpperCase()}] ${l.rule}`;
    })
    .join('\n');

  return `${prompt}\n\n## Lessons Learned (auto-injected)\n${lessonsSection}`;
}

/**
 * Parse lessons.md content into structured lessons.
 * Expected format:
 * ```
 * ## YYYY-MM-DD | category | severity
 * Rule: <rule text>
 * Context: <context>
 * Tags: tag1, tag2
 * ```
 */
function parseLessons(content: string): StructuredLesson[] {
  const lessons: StructuredLesson[] = [];
  const blocks = content.split(/^## /m).filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const headerLine = lines[0] ?? '';

    // Parse header: "YYYY-MM-DD | category | severity" or just treat as lesson text
    const headerParts = headerLine.split('|').map(p => p.trim());
    const timestamp = headerParts[0] ?? new Date().toISOString();
    const category = (headerParts[1] ?? 'code') as StructuredLesson['category'];
    const severity = (headerParts[2] ?? 'important') as StructuredLesson['severity'];

    let rule = '';
    let context = '';
    let tags: string[] = [];

    for (const line of lines.slice(1)) {
      if (line.startsWith('Rule:')) rule = line.replace('Rule:', '').trim();
      else if (line.startsWith('Context:')) context = line.replace('Context:', '').trim();
      else if (line.startsWith('Tags:')) tags = line.replace('Tags:', '').trim().split(',').map(t => t.trim());
      else if (line.startsWith('- ')) {
        // Bullet-style rules
        if (!rule) rule = line.replace('- ', '').trim();
        else context += ' ' + line.replace('- ', '').trim();
      }
    }

    if (rule || context) {
      lessons.push({
        id: `lesson-${lessons.length}`,
        timestamp,
        category: validCategories.includes(category) ? category : 'code',
        severity: validSeverities.includes(severity) ? severity : 'important',
        rule: rule || headerLine,
        context,
        tags,
      });
    }
  }

  return lessons;
}

/**
 * Compute Jaccard similarity between two strings at the word level.
 * Returns a value between 0 (no overlap) and 1 (identical word sets).
 */
export function computeJaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

const severityRank: Record<StructuredLesson['severity'], number> = {
  'critical': 2,
  'important': 1,
  'nice-to-know': 0,
};

/**
 * Deduplicate lessons by merging entries with the same category and
 * Jaccard word-similarity > 0.6 on their rules.
 *
 * When merging duplicates:
 * - Keep the one with higher severity (critical > important > nice-to-know)
 * - Merge tags (union)
 * - Keep the more recent timestamp
 */
export function deduplicateLessons(lessons: StructuredLesson[]): StructuredLesson[] {
  const result: StructuredLesson[] = [];

  for (const lesson of lessons) {
    let merged = false;
    for (let i = 0; i < result.length; i++) {
      const existing = result[i]!;
      if (existing.category !== lesson.category) continue;
      if (computeJaccardSimilarity(existing.rule, lesson.rule) > 0.6) {
        // Merge: pick higher severity, more recent timestamp, union tags
        const keepLesson = severityRank[lesson.severity] > severityRank[existing.severity]
          ? lesson : existing;
        const otherLesson = keepLesson === lesson ? existing : lesson;
        const mergedTags = [...new Set([...existing.tags, ...lesson.tags])];
        const newerTimestamp = existing.timestamp >= lesson.timestamp
          ? existing.timestamp : lesson.timestamp;
        result[i] = {
          ...keepLesson,
          id: existing.id,
          timestamp: newerTimestamp,
          tags: mergedTags,
          context: keepLesson.context || otherLesson.context,
        };
        merged = true;
        break;
      }
    }
    if (!merged) {
      result.push({ ...lesson });
    }
  }

  return result;
}

export interface CompactLessonsOptions extends LessonsIndexOptions {
  _writeFile?: (path: string, content: string) => Promise<void>;
}

/**
 * Read lessons.md, deduplicate, and write back.
 * Returns the count of lessons before and after deduplication.
 */
export async function compactLessons(opts?: CompactLessonsOptions): Promise<{ before: number; after: number }> {
  const cwd = opts?.cwd ?? process.cwd();
  const filePath = path.isAbsolute(LESSONS_FILE_RELATIVE)
    ? LESSONS_FILE_RELATIVE
    : path.join(cwd, LESSONS_FILE_RELATIVE);

  const lessons = await indexLessons(opts);
  const before = lessons.length;
  const deduplicated = deduplicateLessons(lessons);
  const after = deduplicated.length;

  // Serialize back to lessons.md format
  const lines: string[] = ['# Lessons Learned\n'];
  for (const l of deduplicated) {
    lines.push(`## ${l.timestamp} | ${l.category} | ${l.severity}`);
    lines.push(`Rule: ${l.rule}`);
    if (l.context) lines.push(`Context: ${l.context}`);
    if (l.tags.length > 0) lines.push(`Tags: ${l.tags.join(', ')}`);
    lines.push('');
  }

  const content = lines.join('\n');
  const writeFn = opts?._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  await writeFn(filePath, content);

  return { before, after };
}

const validCategories: StructuredLesson['category'][] = ['design', 'code', 'test', 'deploy', 'architecture', 'ux', 'performance', 'root_cause'];
const validSeverities: StructuredLesson['severity'][] = ['critical', 'important', 'nice-to-know'];

/**
 * Record a 7 Levels Deep root cause finding as a structured lesson.
 * The lesson is appended to .danteforge/lessons.md for future task recall.
 */
export async function recordRootCauseLesson(result: SevenLevelsResult, cwd?: string): Promise<void> {
  try {
    const { appendLesson } = await import('../cli/commands/lessons.js');
    const timestamp = new Date().toISOString().slice(0, 10);
    const entry = [
      `## ${timestamp} | root_cause | critical`,
      `Rule: [${result.rootCauseDomain.replace('_', ' ').toUpperCase()}] ${result.lessonForFuture}`,
      `Context: Failure type: ${result.failureType}. Root cause domain: ${result.rootCauseDomain}. Depth reached: ${result.depthReached}. Model: ${result.modelAttribution ?? 'unknown'}.`,
      `Tags: root_cause, ${result.rootCauseDomain}, seven-levels-deep`,
    ].join('\n');

    // appendLesson uses process.cwd() — temporarily change if cwd is specified
    if (cwd && cwd !== process.cwd()) {
      const originalCwd = process.cwd();
      try {
        process.chdir(cwd);
        await appendLesson(entry + '\n');
      } finally {
        process.chdir(originalCwd);
      }
    } else {
      await appendLesson(entry + '\n');
    }

    logger.info(`[7LD] Root cause lesson recorded (domain: ${result.rootCauseDomain})`);
  } catch (err) {
    logger.warn(`[7LD] Failed to record root cause lesson: ${err instanceof Error ? err.message : String(err)}`);
  }
}
