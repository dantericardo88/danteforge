// rubric-ladder.ts — turn the competitor-grounded "## Score Ladder" tables that the
// universe research already produces (.danteforge/compete/universe/<dim>.md) into
// structured, machine-usable rubric levels, and surface the NEXT level's criteria so
// the build loop builds toward "what a 9 actually looks like" instead of a vague
// "improve this dim".
//
// HONESTY: these ladders are RESEARCH OUTPUT grounded in real competitor code paths
// (e.g. security's 9 cites OpenHands' analyzers + OpenSandbox egress rails) — this
// only PARSES that existing evidence; it never invents a level. A dim with no
// universe ladder simply has no rubric (undefined-not-invented).

import fs from 'node:fs/promises';
import path from 'node:path';
import type { DimensionRubricLevel } from '../matrix/types/dimension-graph.js';

/**
 * Parse the `## Score Ladder` markdown table from a universe file into rubric
 * levels. Robust to descriptors that themselves contain `|` (code/JSON) by joining
 * the trailing cells. Returns [] if there is no ladder.
 */
export function parseScoreLadder(md: string): DimensionRubricLevel[] {
  const idx = md.search(/##\s*Score Ladder/i);
  if (idx < 0) return [];
  const levels: DimensionRubricLevel[] = [];
  const lines = md.slice(idx).split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim().startsWith('|')) {
      if (levels.length > 0) break; // table ended
      continue;                     // header lines before the first data row
    }
    const cells = line.split('|').map(c => c.trim());
    // cells: ['', '<score>', '<descriptor...>', ...maybe more, '']
    const score = Number.parseInt(cells[1] ?? '', 10);
    if (!Number.isNaN(score) && score >= 0 && score <= 10 && cells.length >= 3) {
      const descriptor = cells.slice(2).filter(c => c.length > 0).join(' | ').trim();
      if (descriptor) levels.push({ score, descriptor });
    }
  }
  return levels.sort((a, b) => a.score - b.score);
}

function universePath(cwd: string, dimId: string): string {
  return path.join(cwd, '.danteforge', 'compete', 'universe', `${dimId}.md`);
}

/** Load + parse a dim's rubric ladder from its universe file. [] if none. */
export async function loadDimRubric(cwd: string, dimId: string): Promise<DimensionRubricLevel[]> {
  try {
    return parseScoreLadder(await fs.readFile(universePath(cwd, dimId), 'utf8'));
  } catch {
    return [];
  }
}

/** The lowest rubric level strictly above `currentScore` — the concrete target the
 *  build should aim at next. null if the rubric doesn't define one. */
export function nextLevel(rubric: DimensionRubricLevel[], currentScore: number): DimensionRubricLevel | null {
  const above = rubric.filter(l => l.score > currentScore + 1e-9).sort((a, b) => a.score - b.score);
  return above[0] ?? null;
}

/**
 * A goal suffix that tells the builder exactly what the next score level requires
 * for THIS dimension, grounded in the researched ladder. Empty string if there's no
 * ladder (the caller keeps its generic goal — no fabrication).
 */
export async function nextLevelGoalSuffix(cwd: string, dimId: string, currentScore: number): Promise<string> {
  const target = nextLevel(await loadDimRubric(cwd, dimId), currentScore);
  if (!target) return '';
  return `\n\nTo reach a ${target.score}/10 for this dimension (competitor-grounded rubric), the evidence required is:\n${target.descriptor}`;
}
