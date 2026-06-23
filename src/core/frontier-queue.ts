// frontier-queue.ts — the "loops vs queues" embodiment (Matt Pocock's agentic-engineering workflow + council
// 2026-06-22). The whole-session finding is that build-to-8.0 is TACTICAL — loopable, AFK, the autonomous
// build loop is the right shape — but the 8→9 external-anchor work is STRATEGIC and was the wrong thing to
// force into an infinite loop. Matt's principle: AFK agents work best as a QUEUE of well-scoped, reviewable,
// human-triaged tasks, not a while-loop. This module splits the fleet into the two lanes so the loop stops
// banging on the build ceiling and frontier work becomes an explicit, reviewable queue.
//
// BUILD lane  (< 8.0): loopable / AFK — feed to autoforge / the climb; the agent can close these alone.
// FRONTIER queue (≥ 8.0, BUILD-COMPLETE): each item is a human-triaged external-anchor task (a dated benchmark
//                run, or a court-validated win) — a build cannot manufacture these, so they are QUEUED, not
//                looped. See [[project_build_ceiling_vs_external_anchor]].

import { scoreBand, BUILD_CEILING } from './score-bands.js';

export interface BuildLaneItem {
  dimId: string;
  score: number;
  /** The next tactical step the build loop can take autonomously. */
  nextStep: string;
}

export interface FrontierQueueItem {
  dimId: string;
  score: number;
  /** The external anchor required to cross into the frontier — a strategic, human-triaged task. */
  anchorTask: string;
  /** What KIND of anchor: a benchmark receipt or a court-validated win. */
  anchorKind: 'benchmark-receipt' | 'court-validation' | 'sustain';
}

export interface LaneSplit {
  buildLane: BuildLaneItem[];        // tactical / loopable
  frontierQueue: FrontierQueueItem[]; // strategic / queued — needs an external anchor
}

function anchorKindFor(score: number): FrontierQueueItem['anchorKind'] {
  if (score >= 9.5) return 'sustain';
  if (score >= 9.0) return 'sustain';          // re-verify the win to stay fresh
  if (score >= 8.5) return 'court-validation'; // anchored → next is a court win
  return 'benchmark-receipt';                  // BUILD-COMPLETE (8.0) → next is a dated benchmark receipt
}

/**
 * Split a scored fleet into the loopable BUILD lane and the human-triaged FRONTIER queue.
 * Pure: deterministic given the inputs, no I/O — the CLI/loop callers supply the scored dims.
 */
export function splitFleetLanes(dims: Array<{ id: string; score: number }>): LaneSplit {
  const buildLane: BuildLaneItem[] = [];
  const frontierQueue: FrontierQueueItem[] = [];
  for (const d of dims) {
    const band = scoreBand(d.score);
    if (d.score >= BUILD_CEILING) {
      frontierQueue.push({
        dimId: d.id,
        score: d.score,
        anchorTask: band.nextAnchor ?? 'obtain an external anchor (benchmark receipt or court-validated win)',
        anchorKind: anchorKindFor(d.score),
      });
    } else {
      buildLane.push({
        dimId: d.id,
        score: d.score,
        nextStep: band.nextAnchor ?? 'advance the build toward BUILD-COMPLETE (8.0)',
      });
    }
  }
  // Build lane: lowest score first (biggest tactical gap to close). Frontier queue: highest first (closest to a win).
  buildLane.sort((a, b) => a.score - b.score);
  frontierQueue.sort((a, b) => b.score - a.score);
  return { buildLane, frontierQueue };
}

/** A compact two-lane summary line for operator surfaces (gap --all, the autopilot report). */
export function laneSummary(split: LaneSplit): string {
  const b = split.buildLane.length;
  const f = split.frontierQueue.length;
  return `BUILD lane (loopable/AFK, <8.0): ${b} dim(s) — autoforge can close these alone.  ` +
    `FRONTIER queue (BUILD-COMPLETE, needs an external anchor — strategic, human-triaged): ${f} dim(s).`;
}
