// ladder-synthesis.ts — Phase 2.3 (part 2): generate the yardstick FROM harvested research.
//
// This is the heart of the auto-solve: turn HarvestedSignals (benchmark leaderboard numbers, competitor
// capabilities, unmet user demand) into the competitive Score Ladder rungs — auto-cited, so each rung
// traces to a real external source and PASSES checkLadderGroundedness by construction (no LLM prose).
//
// The competitive rungs (the ones the grounding gate guards, >7):
//   8 — DIFFERENTIATORS: what the leaders demonstrably do (capability signals → "great").
//   9 — FRONTIER: match/beat the top published benchmark + close the top unmet demand (benchmark +
//        demand signals → "beyond parity").
// The 5–7 floors are the depth-doctrine standard (code exists, wired, tested) — not competitive research,
// so they are NOT synthesized here. A rung is emitted only when a backing signal exists (no fabrication).

import type { HarvestedSignal } from './harvested-bar.js';
import { normalizeBenchmarkScore } from './harvested-bar.js';

export interface SynthesizedRung {
  score: number;
  /** EXTRACTED + a source URL, so it clears checkLadderGroundedness. */
  descriptor: string;
  /** The signal this rung was synthesized from (provenance). */
  source: string;
}

/** One ladder row as the universe `## Score Ladder` markdown table renders it. */
export function rungToMarkdownRow(r: SynthesizedRung): string {
  return `| ${r.score} | ${r.descriptor} |`;
}

/** Render synthesized rungs as a `## Score Ladder` markdown section (what the universe file/prompt uses).
 *  Empty string when there are no grounded rungs (so callers fall back to the existing LLM ladder). */
export function renderGroundedLadderSection(rungs: SynthesizedRung[]): string {
  if (rungs.length === 0) return '';
  const rows = rungs.map(rungToMarkdownRow).join('\n');
  return [
    '## Score Ladder',
    '| Score | Requirement (grounded in a harvested external signal — EXTRACTED + cited) |',
    '|-------|---------------------------------------------------------------------------|',
    rows,
  ].join('\n') + '\n';
}

/**
 * Synthesize the competitive ladder rungs (8 = differentiators, 9 = frontier) from harvested signals.
 * Each rung is tagged EXTRACTED and cites its signal's source URL. Returns [] when there are no signals
 * (the dimension then has no grounded competitive bar — honest, not invented).
 */
export function synthesizeLadderFromSignals(signals: HarvestedSignal[]): SynthesizedRung[] {
  const rungs: SynthesizedRung[] = [];

  // 8 — differentiators: what the leaders demonstrably do (capability signals).
  for (const s of signals.filter(s => s.kind === 'capability')) {
    rungs.push({ score: 8, descriptor: `Leader-parity capability: ${s.claim} [EXTRACTED: ${s.source}]`, source: s.source });
  }

  // 9 — frontier: match/beat the top published benchmark number (objective).
  const bench = signals
    .filter(s => s.kind === 'benchmark' && s.numeric !== undefined)
    .sort((a, b) => (b.numeric ?? 0) - (a.numeric ?? 0))[0];
  if (bench) {
    const n = normalizeBenchmarkScore(bench.numeric!);
    rungs.push({ score: 9, descriptor: `Match or beat the published frontier on ${bench.suite ?? 'the suite'} (${n}/10) [EXTRACTED: ${bench.source}]`, source: bench.source });
  }

  // 9 — frontier: close the top unmet user demand (beyond parity).
  const demand = signals
    .filter(s => s.kind === 'demand')
    .sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))[0];
  if (demand) {
    rungs.push({ score: 9, descriptor: `Close the top unmet demand: ${demand.claim} [EXTRACTED: ${demand.source}]`, source: demand.source });
  }

  return rungs.sort((a, b) => a.score - b.score);
}
