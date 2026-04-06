// Lessons — self-improving knowledge base that captures corrections and mistakes
// "After every fix, add a rule so it never happens again."
// Inspired by Boris Cherny's self-improving workflow pattern.

import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { recordMemory } from '../../core/memory-engine.js';
import { savePrompt, displayPrompt } from '../../core/prompt-builder.js';
import { resolveSkill } from '../../core/skills.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const LESSONS_FILE = path.join('.danteforge', 'lessons.md');
const MAX_LESSONS_LINES = 2000;

/**
 * Read existing lessons file content (empty string if not found).
 */
export async function readLessons(): Promise<string> {
  try {
    return await fs.readFile(LESSONS_FILE, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Append a new lesson entry to lessons.md.
 */
export async function appendLesson(entry: string): Promise<void> {
  await fs.mkdir('.danteforge', { recursive: true });
  const existing = await readLessons();
  const header = existing ? '' : '# Lessons Learned\n\n_Auto-maintained by DanteForge — rules captured from corrections, failures, and refinements._\n\n---\n\n';
  await fs.writeFile(LESSONS_FILE, header + existing + entry + '\n\n', 'utf8');
}

/**
 * Count lines in lessons file.
 */
async function countLessonsLines(): Promise<number> {
  const content = await readLessons();
  return content.split('\n').length;
}

/**
 * Auto-compact lessons.md if it exceeds the line threshold.
 * Groups by category, merges duplicates, removes outdated entries.
 */
async function autoCompact(): Promise<boolean> {
  const lineCount = await countLessonsLines();
  if (lineCount <= MAX_LESSONS_LINES) return false;

  logger.info(`Lessons file has ${lineCount} lines (>${MAX_LESSONS_LINES}) — compacting...`);

  const content = await readLessons();
  const llmAvailable = await isLLMAvailable();

  if (llmAvailable) {
    const compactPrompt = `You are a technical editor compacting a lessons-learned file. The file has grown too large.

## Current Lessons File
${content}

## Instructions
1. Group lessons by category (Naming, Testing, Workflow, Architecture, Style, etc.)
2. Merge duplicate or overlapping rules into single entries
3. Remove any lessons that are superseded by newer, more specific rules
4. Keep every unique, actionable rule — do NOT discard valid lessons
5. Maintain the markdown format with ## headers, timestamps, and Rule/Mistake fields
6. Target: reduce to under ${MAX_LESSONS_LINES} lines while preserving all unique knowledge

Output the compacted lessons file in full.`;

    try {
      const compacted = await callLLM(compactPrompt, undefined, {
        enrichContext: false,
        recordMemory: false,
      });
      await fs.writeFile(LESSONS_FILE, compacted, 'utf8');
      logger.success(`Lessons compacted: ${lineCount} -> ${compacted.split('\n').length} lines`);
      return true;
    } catch (err) {
      logger.warn(`LLM compaction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fallback: simple truncation — keep last 1500 lines with a header note
  const lines = content.split('\n');
  const truncated = [
    '# Lessons Learned',
    '',
    `_Compacted on ${new Date().toISOString()} — older entries removed to stay under ${MAX_LESSONS_LINES} lines._`,
    '',
    '---',
    '',
    ...lines.slice(lines.length - 1500),
  ].join('\n');

  await fs.writeFile(LESSONS_FILE, truncated, 'utf8');
  logger.success(`Lessons compacted (fallback): ${lineCount} -> ${truncated.split('\n').length} lines`);
  return true;
}

/**
 * Record a lesson from a specific source (forge failure, verify failure, user correction).
 * Called automatically by forge/verify/party or manually via CLI.
 */
export async function recordLesson(
  category: string,
  mistake: string,
  rule: string,
  source: 'user correction' | 'verify failure' | 'forge failure' | 'party failure' | 'manual',
): Promise<void> {
  const timestamp = new Date().toISOString();
  const title = rule.length > 80 ? rule.slice(0, 77) + '...' : rule;

  const entry = `## [${category}] ${title}
_Added: ${timestamp}_
_Source: ${source}_

**Mistake:** ${mistake}
**Rule:** ${rule}`;

  await appendLesson(entry);
  await autoCompact();

  // Audit log
  const state = await loadState();
  state.auditLog.push(`${timestamp} | lessons: added [${category}] rule from ${source}`);
  await saveState(state);
  await recordMemory({
    category: 'correction',
    summary: `Lesson recorded: [${category}] ${title}`,
    detail: `Source: ${source}. Mistake: ${mistake}. Rule: ${rule}`,
    tags: ['lesson', category, source],
    relatedCommands: ['lessons'],
  });

  logger.success(`Lesson recorded: [${category}] ${title}`);
}

/**
 * Auto-capture lessons from forge/party failures.
 * Called by the executor when tasks fail.
 */
export async function captureFailureLessons(
  failures: { task: string; error?: string }[],
  source: 'forge failure' | 'party failure',
): Promise<void> {
  if (failures.length === 0) return;

  const llmAvailable = await isLLMAvailable();

  for (const failure of failures) {
    if (llmAvailable) {
      // Use LLM to extract a meaningful lesson from the failure
      const extractPrompt = `A development task failed. Extract a concise lesson from it.

Task: ${failure.task}
Error: ${failure.error ?? 'Verification failed'}

Respond with EXACTLY this format (no other text):
CATEGORY: <one word: Naming|Testing|Workflow|Architecture|Style|Config|Dependencies>
MISTAKE: <one sentence describing what went wrong>
RULE: <one sentence rule to prevent this in future>`;

      try {
        const result = await callLLM(extractPrompt, undefined, { enrichContext: true });
        const categoryMatch = result.match(/CATEGORY:\s*(.+)/i);
        const mistakeMatch = result.match(/MISTAKE:\s*(.+)/i);
        const ruleMatch = result.match(/RULE:\s*(.+)/i);

        if (categoryMatch && mistakeMatch && ruleMatch) {
          await recordLesson(
            categoryMatch[1]!.trim(),
            mistakeMatch[1]!.trim(),
            ruleMatch[1]!.trim(),
            source,
          );
          continue;
        }
      } catch {
        // Fall through to basic recording
      }
    }

    // Fallback: record with basic info
    await recordLesson(
      'Workflow',
      `Task "${failure.task}" failed${failure.error ? `: ${failure.error}` : ''}`,
      `Investigate and fix: ${failure.task}`,
      source,
    );
  }
}

/**
 * Auto-capture lessons from verify failures/warnings.
 */
export async function captureVerifyLessons(
  failures: string[],
  warnings: string[],
): Promise<void> {
  const issues = [
    ...failures.map(f => ({ msg: f, severity: 'failure' as const })),
    ...warnings.map(w => ({ msg: w, severity: 'warning' as const })),
  ];

  if (issues.length === 0) return;

  // Only record lessons for actual failures (not warnings — those are informational)
  for (const issue of issues.filter(i => i.severity === 'failure')) {
    await recordLesson(
      'Workflow',
      issue.msg,
      `Ensure: ${issue.msg.replace(/— .+$/, '').trim()}`,
      'verify failure',
    );
  }
}

/**
 * Main CLI command handler for `danteforge lessons`.
 */
export async function lessons(correction?: string, options: {
  prompt?: boolean;
  compact?: boolean;
} = {}) {
  return withErrorBoundary('lessons', async () => {
  logger.success('DanteForge Lessons — Self-Improving Knowledge Base');
  logger.info('');

  const state = await loadState();

  // --compact: force compaction
  if (options.compact) {
    const content = await readLessons();
    if (!content) {
      logger.info('No lessons file found — nothing to compact.');
      return;
    }
    const linesBefore = content.split('\n').length;
    const compacted = await autoCompact();
    if (!compacted) {
      logger.info(`Lessons file has ${linesBefore} lines — under threshold (${MAX_LESSONS_LINES}), no compaction needed.`);
    }
    state.auditLog.push(`${new Date().toISOString()} | lessons: compaction ${compacted ? 'performed' : 'skipped'}`);
    await saveState(state);
    return;
  }

  // If correction text provided, record it as a user lesson
  if (correction) {
    // --prompt: generate extraction prompt
    if (options.prompt) {
      const prompt = `A user provided this correction/feedback:

"${correction}"

Extract a structured lesson from it.

Respond with EXACTLY this format:
CATEGORY: <one word: Naming|Testing|Workflow|Architecture|Style|Config|Dependencies>
MISTAKE: <one sentence describing the original mistake>
RULE: <one sentence rule to prevent this in future>`;

      const savedPath = await savePrompt('lessons-extract', prompt);
      displayPrompt(prompt, [
        'Paste into your LLM to extract a structured lesson.',
        'Then run: danteforge lessons "CATEGORY: ... MISTAKE: ... RULE: ..."',
        `Prompt saved to: ${savedPath}`,
      ].join('\n'));

      state.auditLog.push(`${new Date().toISOString()} | lessons: extraction prompt generated`);
      await saveState(state);
      return;
    }

    // Try to parse structured input (CATEGORY/MISTAKE/RULE format)
    const categoryMatch = correction.match(/CATEGORY:\s*(.+)/i);
    const mistakeMatch = correction.match(/MISTAKE:\s*(.+)/i);
    const ruleMatch = correction.match(/RULE:\s*(.+)/i);

    if (categoryMatch && mistakeMatch && ruleMatch) {
      await recordLesson(
        categoryMatch[1]!.trim(),
        mistakeMatch[1]!.trim(),
        ruleMatch[1]!.trim(),
        'user correction',
      );
      return;
    }

    // Use LLM to extract lesson from free-text correction
    const llmAvailable = await isLLMAvailable();
    if (llmAvailable) {
      const extractPrompt = `A user provided this correction/feedback:

"${correction}"

Extract a structured lesson from it.

Respond with EXACTLY this format (no other text):
CATEGORY: <one word: Naming|Testing|Workflow|Architecture|Style|Config|Dependencies>
MISTAKE: <one sentence describing the original mistake>
RULE: <one sentence rule to prevent this in future>`;

      try {
        const result = await callLLM(extractPrompt, undefined, { enrichContext: true });
        const catMatch = result.match(/CATEGORY:\s*(.+)/i);
        const misMatch = result.match(/MISTAKE:\s*(.+)/i);
        const rulMatch = result.match(/RULE:\s*(.+)/i);

        if (catMatch && misMatch && rulMatch) {
          await recordLesson(
            catMatch[1]!.trim(),
            misMatch[1]!.trim(),
            rulMatch[1]!.trim(),
            'user correction',
          );
          return;
        }
      } catch (err) {
        logger.warn(`LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Fallback: record as-is
    await recordLesson('General', correction, correction, 'user correction');
    return;
  }

  // No correction — display current lessons
  const content = await readLessons();
  if (!content) {
    logger.info('No lessons recorded yet.');
    logger.info('');
    logger.info('Lessons are captured automatically when:');
    logger.info('  - forge/party tasks fail');
    logger.info('  - verify detects failures');
    logger.info('  - You provide a correction');
    logger.info('');
    logger.info('Add a lesson manually:');
    logger.info('  danteforge lessons "Always use snake_case for Python variables"');
    logger.info('');

    // Show skill content as guidance
    const skill = await resolveSkill('lessons');
    if (skill) {
      process.stdout.write(skill.content + '\n');
    }
  } else {
    const lineCount = content.split('\n').length;
    const lessonCount = (content.match(/^## \[/gm) || []).length;
    logger.info(`${lessonCount} lesson(s) recorded (${lineCount} lines)`);
    logger.info('');
    process.stdout.write(content + '\n');

    if (lineCount > MAX_LESSONS_LINES * 0.8) {
      logger.warn(`Lessons file is ${lineCount} lines — approaching compaction threshold (${MAX_LESSONS_LINES})`);
      logger.info('Run: danteforge lessons --compact');
    }
  }

  state.auditLog.push(`${new Date().toISOString()} | lessons: viewed (${(content.match(/^## \[/gm) || []).length} lessons)`);
  await saveState(state);
  });
}
