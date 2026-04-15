// Lessons Index — Structured lesson storage and keyword-based retrieval
// Enhances the existing lessons.ts with categorization and prompt injection.

import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import type { SevenLevelsResult } from './seven-levels.js';

const LESSONS_FILE = path.join('.danteforge', 'lessons.md');

export interface StructuredLesson {
  id: string;
  timestamp: string;
  category: 'design' | 'code' | 'test' | 'deploy' | 'architecture' | 'ux' | 'performance' | 'root_cause' | 'plan_critique';
  severity: 'critical' | 'important' | 'nice-to-know';
  rule: string;
  context: string;
  tags: string[];
}

/**
 * Parse the lessons.md file into structured lessons.
 * @param cwd - Optional project root; defaults to process.cwd().
 */
export async function indexLessons(cwd?: string): Promise<StructuredLesson[]> {
  const file = cwd ? path.join(cwd, '.danteforge', 'lessons.md') : LESSONS_FILE;
  try {
    const content = await fs.readFile(file, 'utf8');
    return parseLessons(content);
  } catch {
    return [];
  }
}

/**
 * Query lessons by keywords. Returns lessons matching any keyword.
 * @param cwd - Optional project root; defaults to process.cwd().
 */
export async function queryLessons(keywords: string[], cwd?: string): Promise<StructuredLesson[]> {
  const lessons = await indexLessons(cwd);
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
 * @param cwd - Optional project root; defaults to process.cwd().
 */
export async function injectRelevantLessons(prompt: string, maxLessons = 5, cwd?: string): Promise<string> {
  // Extract keywords from the prompt
  const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const uniqueWords = [...new Set(words)].slice(0, 10);

  const relevant = await queryLessons(uniqueWords, cwd);
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
      // Also handle bold markdown format written by extractDeterministicLessons/parseSuccessLessons
      else if (line.startsWith('**Rule:**')) rule = line.replace('**Rule:**', '').trim();
      else if (line.startsWith('Context:')) context = line.replace('Context:', '').trim();
      else if (line.startsWith('_Context:')) context = line.replace(/_Context:\s*/, '').replace(/_$/, '').trim();
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

const validCategories: StructuredLesson['category'][] = ['design', 'code', 'test', 'deploy', 'architecture', 'ux', 'performance', 'root_cause', 'plan_critique'];
const validSeverities: StructuredLesson['severity'][] = ['critical', 'important', 'nice-to-know'];

/**
 * Record a plan critique gap as a structured lesson so future critiques learn from it.
 * Category 'plan_critique' tracks systematic plan failure patterns.
 */
export async function recordCritiqueLesson(
  gap: { category: string; severity: string; description: string; specificFix: string },
  planFile: string,
  cwd?: string,
): Promise<void> {
  try {
    const { appendLesson } = await import('../cli/commands/lessons.js');
    const timestamp = new Date().toISOString().slice(0, 10);
    const entry = [
      `## ${timestamp} | plan_critique | ${gap.severity === 'blocking' ? 'critical' : gap.severity === 'high' ? 'important' : 'nice-to-know'}`,
      `Rule: [PLAN-CRITIQUE:${gap.category.toUpperCase()}] ${gap.specificFix}`,
      `Context: Gap found in ${planFile}: ${gap.description}`,
      `Tags: plan_critique, ${gap.category}`,
    ].join('\n');

    await appendLesson(entry + '\n', cwd);
  } catch (err) {
    logger.warn(`[plan-critic] Failed to record critique lesson: ${err instanceof Error ? err.message : String(err)}`);
  }
}

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

    await appendLesson(entry + '\n', cwd);

    logger.info(`[7LD] Root cause lesson recorded (domain: ${result.rootCauseDomain})`);
  } catch (err) {
    logger.warn(`[7LD] Failed to record root cause lesson: ${err instanceof Error ? err.message : String(err)}`);
  }
}
