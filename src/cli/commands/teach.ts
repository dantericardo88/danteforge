// teach — Capture an AI correction into the lessons corpus and auto-update PRIME.md.
// Usage: danteforge teach "Claude used readline instead of @inquirer/prompts"
// Closes the flywheel: correction → lesson → PRIME.md → next session smarter.

import { logger } from '../../core/logger.js';
import { appendLesson } from './lessons.js';
import type { PrimeOptions } from './prime.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LessonCategory =
  | 'design' | 'code' | 'test' | 'deploy' | 'architecture'
  | 'ux' | 'performance' | 'security' | 'root_cause' | 'plan_critique';

export interface TeachOptions {
  correction: string;   // positional: what the AI got wrong
  cwd?: string;
  // Injection seams
  _appendLesson?: (entry: string, cwd?: string) => Promise<void>;
  _runPrime?: (opts: PrimeOptions) => Promise<void>;
  _categorizeFn?: (text: string) => LessonCategory;
  _stdout?: (line: string) => void;
}

// ── Category classifier (pure, no LLM) ───────────────────────────────────────

const CATEGORY_KEYWORDS: Array<{ keywords: string[]; category: LessonCategory }> = [
  { keywords: ['test', 'spec', 'mock', 'assert', 'jest', 'vitest', 'coverage', 'injection'], category: 'test' },
  { keywords: ['slow', 'perf', 'cache', 'latency', 'memory', 'cpu', 'bundle', 'lazy'], category: 'performance' },
  { keywords: ['security', 'xss', 'sql', 'injection', 'auth', 'csrf', 'sanitize', 'validate'], category: 'security' },
  { keywords: ['design', 'figma', 'layout', 'ui', 'style', 'color', 'spacing', 'icon'], category: 'design' },
  { keywords: ['ux', 'user', 'click', 'interaction', 'accessibility', 'a11y', 'form', 'input'], category: 'ux' },
  { keywords: ['deploy', 'ci', 'cd', 'pipeline', 'docker', 'release', 'publish', 'env'], category: 'deploy' },
  { keywords: ['architect', 'pattern', 'structure', 'module', 'dependency', 'layer', 'boundary'], category: 'architecture' },
];

export function categorizeCorrection(text: string): LessonCategory {
  const lower = text.toLowerCase();
  for (const { keywords, category } of CATEGORY_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  return 'code';
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function teach(options: TeachOptions): Promise<void> {
  const emit = options._stdout ?? ((line: string) => logger.info(line));
  const appendLessonFn = options._appendLesson ?? appendLesson;
  const categorizeFn = options._categorizeFn ?? categorizeCorrection;
  const { correction, cwd } = options;

  const category = categorizeFn(correction);
  const severity = 'important';
  const timestamp = new Date().toISOString().slice(0, 10);

  const entry = [
    `## ${timestamp} | ${category} | ${severity}`,
    `Rule: ${correction}`,
    `Context: Captured via \`danteforge teach\``,
    `Tags: teach, ai-correction, ${category}`,
    '',
  ].join('\n');

  await appendLessonFn(entry, cwd);

  emit('');
  emit(`  Captured: "${correction}"`);
  emit(`  Category: ${category}  |  Severity: ${severity}`);
  emit(`  Lesson added → .danteforge/lessons.md`);

  // Regenerate PRIME.md
  const runPrimeFn = options._runPrime;
  if (runPrimeFn) {
    await runPrimeFn({ cwd }).catch(() => {});
  } else {
    try {
      const { prime } = await import('./prime.js');
      await prime({ cwd });
    } catch {
      // best-effort
    }
  }

  emit(`  PRIME.md updated — Claude Code will see this in your next session.`);
  emit('');
}
