// prime — Session primer for AI coding assistants.
// Generates .danteforge/PRIME.md: a ~200-word compressed project brief
// that Claude Code (and other assistants) can load with @.danteforge/PRIME.md.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { loadState } from '../../core/state.js';
import { computeHarshScore } from '../../core/harsh-scorer.js';
import type { HarshScorerOptions, HarshScoreResult, ScoringDimension } from '../../core/harsh-scorer.js';
import { indexLessons } from '../../core/lessons-index.js';
import type { StructuredLesson } from '../../core/lessons-index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrimeOptions {
  cwd?: string;
  copy?: boolean;  // --copy: print load hint to stdout
  // Injection seams
  _harshScore?: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
  _loadState?: typeof loadState;
  _indexLessons?: typeof indexLessons;
  _writeFile?: (filePath: string, content: string) => Promise<void>;
  _stdout?: (line: string) => void;
}

// ── Pure builder ──────────────────────────────────────────────────────────────

export function buildPrimeMarkdown(
  projectName: string,
  score: number,
  verdict: string,
  p0Gaps: string[],
  antiPatterns: string[],
  architectureSummary: string,
  sessionDate: string,
): string {
  const gapLine = p0Gaps.length > 0 ? p0Gaps.join(', ') : 'none — all dimensions healthy';
  const antiPatternLines = antiPatterns.length > 0
    ? antiPatterns.map(p => `- Do NOT: ${p}`).join('\n')
    : '- No corrections recorded yet — run `danteforge teach` to capture AI mistakes.';

  return `# Session Brief — ${sessionDate}

**Project:** ${projectName}
**Score:** ${score.toFixed(1)}/10 (${verdict}) — target: 9.0
**Top gaps:** ${gapLine}

## Architecture
${architectureSummary}

## Anti-Patterns (do not repeat)
${antiPatternLines}

## Load in Claude Code
@.danteforge/PRIME.md
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function prime(options: PrimeOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((line: string) => logger.info(line));
  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const loadStateFn = options._loadState ?? loadState;
  const indexLessonsFn = options._indexLessons ?? indexLessons;
  const writeFileFn = options._writeFile ?? defaultWriteFile;

  // Load project state and score
  const [state, scoreResult, lessons] = await Promise.all([
    loadStateFn({ cwd }),
    harshScoreFn({ cwd }),
    indexLessonsFn(cwd),
  ]);

  const projectName = state.project ?? 'unknown';
  const sessionDate = new Date().toISOString().slice(0, 10);

  // Top 3 gap dimensions
  const dims = Object.entries(scoreResult.displayDimensions) as [ScoringDimension, number][];
  dims.sort((a, b) => a[1] - b[1]);
  const p0Gaps = dims.slice(0, 3).map(([dim, sc]) => `${dim} (${sc.toFixed(1)})`);

  // Anti-patterns from critical lessons (rule field only, max 5)
  const critical = lessons
    .filter(l => l.severity === 'critical')
    .slice(0, 5)
    .map((l: StructuredLesson) => l.rule);

  // Architecture summary derived from state
  const archLines: string[] = [
    'ESM-only TypeScript. Commander.js CLI. tsup → dist/index.js.',
    'Tests: Node built-in runner + tsx. Injection seams throughout.',
    `State: .danteforge/STATE.yaml.  Stage: ${state.workflowStage ?? 'initialized'}.`,
  ];
  if (state.tddEnabled) archLines.push('TDD mode enabled.');
  if (state.lightMode) archLines.push('Light mode — gates bypassed.');
  const architectureSummary = archLines.join('\n');

  const content = buildPrimeMarkdown(
    projectName,
    scoreResult.displayScore,
    scoreResult.verdict,
    p0Gaps,
    critical,
    architectureSummary,
    sessionDate,
  );

  const outPath = path.join(cwd, '.danteforge', 'PRIME.md');
  await writeFileFn(outPath, content);

  emit(`  PRIME.md written — load in Claude Code: @.danteforge/PRIME.md`);

  if (options.copy) {
    emit('');
    emit('  To copy to clipboard (macOS): cat .danteforge/PRIME.md | pbcopy');
    emit('  To copy to clipboard (Windows): type .danteforge\\PRIME.md | clip');
  }
}

async function defaultWriteFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}
