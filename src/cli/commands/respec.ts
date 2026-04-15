// respec — Re-run specification with lessons learned injected.
// Reads current SPEC.md + lessons.md + refused-patterns and generates
// a revised SPEC.md that avoids proven dead ends and incorporates corrections.

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { callLLM } from '../../core/llm.js';
import { loadRefusedPatterns, buildRefusedPatternsPromptSection, type RefusedPatternsStore } from '../../core/refused-patterns.js';

const STATE_DIR = '.danteforge';

export interface RespecOptions {
  cwd?: string;
  _loadSpec?: () => Promise<string | null>;
  _loadLessons?: () => Promise<string | null>;
  _loadRefused?: () => Promise<RefusedPatternsStore>;
  _callLLM?: (prompt: string) => Promise<string>;
  _writeSpec?: (content: string) => Promise<void>;
}

export interface RespecResult {
  revised: boolean;
  specPath: string;
  lessonsInjected: number;
  refusedPatternsInjected: number;
}

export async function runRespec(options: RespecOptions = {}): Promise<RespecResult> {
  const cwd = options.cwd ?? process.cwd();
  const specPath = path.join(cwd, STATE_DIR, 'SPEC.md');

  const loadSpec = options._loadSpec ?? (async () => {
    try { return await fs.readFile(specPath, 'utf8'); } catch { return null; }
  });

  const loadLessons = options._loadLessons ?? (async () => {
    try { return await fs.readFile(path.join(cwd, STATE_DIR, 'lessons.md'), 'utf8'); } catch { return null; }
  });

  const loadRefused = options._loadRefused ?? (() => loadRefusedPatterns(cwd));

  const callLlm = options._callLLM ?? callLLM;

  const writeSpec = options._writeSpec ?? (async (content: string) => {
    await fs.mkdir(path.join(cwd, STATE_DIR), { recursive: true });
    await fs.writeFile(specPath, content, 'utf8');
  });

  const spec = await loadSpec();
  if (!spec) {
    logger.error('No SPEC.md found. Run `danteforge specify "your idea"` first.');
    return { revised: false, specPath, lessonsInjected: 0, refusedPatternsInjected: 0 };
  }

  const [lessons, refused] = await Promise.all([loadLessons(), loadRefused()]);

  const lessonsSection = lessons
    ? `## LESSONS LEARNED (incorporate these corrections)\n${lessons.trim()}\n`
    : '';

  const refusedSection = buildRefusedPatternsPromptSection(refused);

  const prompt = [
    'You are re-specifying a project that has hit a quality plateau or needs course correction.',
    '',
    'Your goal is to generate a revised SPEC.md that:',
    '1. Preserves the core intent of the original spec',
    '2. Incorporates lessons learned from past failures',
    '3. Avoids patterns proven not to work (refused patterns)',
    '4. Adds more precise acceptance criteria based on what went wrong',
    '',
    '## CURRENT SPEC',
    spec.trim(),
    '',
    lessonsSection,
    refusedSection,
    '',
    'Generate a complete revised SPEC.md. Output ONLY the markdown — no preamble or explanation.',
  ].filter(Boolean).join('\n');

  logger.info('Re-specifying with lessons learned...');

  try {
    const revised = await callLlm(prompt);
    await writeSpec(revised);

    const lessonsInjected = lessons ? lessons.split('\n').filter(l => l.trim().startsWith('-')).length : 0;
    const refusedPatternsInjected = refused.patterns.length;

    logger.success('SPEC.md revised with lessons learned.');
    if (lessonsInjected > 0) logger.info(`  Lessons injected: ${lessonsInjected}`);
    if (refusedPatternsInjected > 0) logger.info(`  Refused patterns blocked: ${refusedPatternsInjected}`);
    logger.info('Next: run `danteforge clarify` then `danteforge plan` to continue.');

    return { revised: true, specPath, lessonsInjected, refusedPatternsInjected };
  } catch (err) {
    logger.error(`respec failed: ${err instanceof Error ? err.message : String(err)}`);
    return { revised: false, specPath, lessonsInjected: 0, refusedPatternsInjected: 0 };
  }
}
