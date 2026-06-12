// ladder-research.ts — the ONE single-dim competitor Score Ladder researcher.
//
// The 8→9 frontier bar is seeded VERBATIM from a dim's competitor-grounded Score Ladder
// (seedLeaderTargetFromLadder) and the deterministic anti-laundering gate rejects any softened
// bar — so a dim with NO ladder rows simply cannot author its leader_target, and stays honestly
// ceilinged at 8.0 forever ("research the ladder" was permanently human work). This engine makes
// that research a first-class, reusable remediation: it runs the SAME council-universe phase the
// conductor uses for RESEARCH_LADDER yardstick routing, then VERIFIES the written universe file
// actually carries usable "## Score Ladder" rows (research that produced no ladder fails loudly —
// the bar stays missing rather than invented). Consumers:
//   - capability-test-execute.ts (the conductor's RESEARCH_LADDER action)
//   - ascend-frontier-push.ts (spec-incomplete remediation: ladder-blocked specs research, re-seed,
//     re-check inside the same push attempt instead of dead-ending at the ceiling)

import { loadMatrix } from '../../core/compete-matrix.js';
import { effectiveDimScore } from '../../core/compete-matrix-score.js';
import { loadDimRubric } from '../../core/rubric-ladder.js';

export interface LadderResearchResult {
  ok: boolean;
  reason: string;
}

export interface LadderResearchOptions {
  cwd: string;
  dimId: string;
  /** Seam: the council research phase. Default: the real runCouncilUniversePhase. */
  _runPhase?: (opts: {
    projectPath: string;
    targets: Array<{ dimId: string; dimName: string; currentScore: number; targetScore: number; ossLeader?: string }>;
    skipExisting: boolean;
  }) => Promise<{ written: string[] }>;
}

/**
 * Research the competitor Score Ladder for ONE dim via the council-universe phase, and verify the
 * result is genuinely usable (>=1 parsed ladder row). Never invents: a failed/empty research
 * returns ok:false with the precise reason, and the spec-incomplete ceiling stands.
 */
export async function researchDimLadder(options: LadderResearchOptions): Promise<LadderResearchResult> {
  const { cwd, dimId } = options;
  const matrix = await loadMatrix(cwd);
  const dim = matrix?.dimensions.find(d => d.id === dimId);

  const runPhase = options._runPhase ?? (async (o) => {
    const { runCouncilUniversePhase } = await import('./council-universe-runner.js');
    return runCouncilUniversePhase(o);
  });

  const result = await runPhase({
    projectPath: cwd,
    targets: [{
      dimId,
      dimName: dim?.label ?? dimId,
      currentScore: dim ? effectiveDimScore(dim) : 0,
      targetScore: 9,
      ossLeader: (dim as { oss_leader?: string } | undefined)?.oss_leader || undefined,
    }],
    // The dim was routed here precisely BECAUSE it has no Score Ladder — an existing ladder-less
    // universe file must be re-researched, not skipped.
    skipExisting: false,
  });

  if (!result.written.includes(dimId)) {
    return { ok: false, reason: 'council research produced no universe file (no council member available, or its output failed validation) — the ladder stays missing rather than invented.' };
  }
  const rubric = await loadDimRubric(cwd, dimId);
  if (rubric.length === 0) {
    return { ok: false, reason: 'the researched universe file contains no usable "## Score Ladder" rows — the grounded bar is still missing, so the spec stays honestly incomplete.' };
  }
  return { ok: true, reason: `competitor Score Ladder researched + written by the council (${rubric.length} rows).` };
}
