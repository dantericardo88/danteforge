// Phase planning agent — generates task breakdown from requirements
import { callLLM, isLLMAvailable } from '../../../core/llm.js';
import { logger } from '../../../core/logger.js';

/**
 * Generate an ordered list of atomic tasks from high-level requirements.
 * Uses the configured LLM when available; otherwise falls back to a
 * sensible default breakdown derived from the requirements text.
 */
export async function planPhase(
  requirements: string,
  options?: {
    _llmCaller?: (prompt: string) => Promise<string>;
    _isLLMAvailable?: () => Promise<boolean>;
  },
): Promise<string[]> {
  logger.info('Planning phase from requirements...');

  const prompt = [
    'You are a technical project planner. Given the following requirements, ',
    'break them down into an ordered, numbered list of small, atomic tasks ',
    'that a developer can execute one at a time. Each task should be concrete ',
    'and actionable. Return ONLY the numbered list, one task per line, in the ',
    'format "1. <task description>".\n\n',
    'Requirements:\n',
    requirements,
  ].join('');

  const llmAvailable = options?._llmCaller != null
    || await (options?._isLLMAvailable ?? isLLMAvailable)();

  if (llmAvailable) {
    try {
      const response = options?._llmCaller
        ? await options._llmCaller(prompt)
        : await callLLM(prompt, undefined, { enrichContext: true });
      const tasks = parseNumberedList(response);

      if (tasks.length > 0) {
        logger.success(`Planned ${tasks.length} tasks via LLM`);
        return tasks;
      }

      logger.warn('LLM returned no parseable tasks; falling back to local planning');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`LLM planning failed: ${message}. Falling back to local planning.`);
    }
  } else {
    logger.info('No LLM available — using local planning fallback');
  }

  return buildFallbackPlan(requirements);
}

/**
 * Extract numbered items from an LLM response.
 * Matches lines like "1. Do something" or "1) Do something".
 */
function parseNumberedList(text: string): string[] {
  const lines = text.split('\n');
  const tasks: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (match) {
      const task = match[1].trim();
      if (task.length > 0) {
        tasks.push(task);
      }
    }
  }

  return tasks;
}

/**
 * Produce a reasonable default task list when no LLM is available.
 * Splits multi-sentence requirements into individual tasks and wraps
 * them with standard project phases.
 */
function buildFallbackPlan(requirements: string): string[] {
  const tasks: string[] = ['Review and clarify requirements'];

  // Split requirements on sentence boundaries or newlines to find discrete items
  const items = requirements
    .split(/(?:\r?\n)+|(?:\.\s)/)
    .map((s) => s.replace(/\.$/, '').trim())
    .filter((s) => s.length > 0);

  if (items.length > 1) {
    for (const item of items) {
      tasks.push(`Implement: ${item}`);
    }
  } else {
    tasks.push(`Implement: ${requirements.trim()}`);
  }

  tasks.push('Write or update tests for new functionality');
  tasks.push('Verify all acceptance criteria are met');

  return tasks;
}
