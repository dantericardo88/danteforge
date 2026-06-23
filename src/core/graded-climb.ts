// graded-climb.ts — the AIDE-style CLIMB loop: the build loop that finally drives on the CONTINUOUS evaluator.
//
// This is the piece the keystone (graded-evaluator.ts) existed to feed. Modeled on AIDE's draft->run->report
// metric->select-best->improve and OpenEvolve's keep-if-better: each cycle DISPATCHES a builder toward the
// dim's failing capabilities, RE-EVALUATES the continuous combined_score, and KEEPS the attempt only if it
// improved (isBetter). Unlike the binary capability_test the autonomous loop drove on before — which skipped
// the builder the moment it exited 0 — this keeps climbing while the score is below the real frontier target.
//
// Deliberately SELF-CONTAINED (a new `danteforge climb` command, not an edit to load-bearing harden-crusade):
// it selects on the graded score directly, sidestepping autoresearch's binary --exit-code-metric machinery and
// the lower-is-better landmine the council flagged. Pure: the dispatch + eval are seams, so the climb logic is
// unit-tested without spawning real agents (the live build is the dogfood).
//
// HONEST LIMITS (next increments, CH-063): pure hill-climb with no DGM-style archive (stops at the first local
// max — a future increment keeps a population); the climb's selection is the graded score, NOT yet the court
// (court-as-RULER) and NOT yet mapped to the matrix tier/receipt — so reaching target here is "the builder
// closed the evaluator's gaps", which still feeds the existing session-record -> validate -> court path for a 9.

import { runGradedEvaluator, shouldClimb, isBetter, type EvaluationResult } from './graded-evaluator.js';

export interface GradedClimbStep {
  cycle: number;
  before: number;
  after: number;
  kept: boolean;
  dispatched: boolean;
}

export interface GradedClimbResult {
  dimId: string;
  startScore: number;
  finalScore: number;
  reachedTarget: boolean;
  stoppedReason: 'reached-target' | 'no-gain' | 'max-cycles' | 'dispatch-failed';
  trajectory: GradedClimbStep[];
  final: EvaluationResult;
}

export interface RunGradedClimbOptions {
  dimId: string;
  /** The dim's graded_evaluator command — its final stdout line is the {"combined_score":...} verdict. */
  evaluatorCommand: string;
  cwd: string;
  /** Frontier target in [0,1] — climb until the combined_score meets it (default 0.9). */
  target?: number;
  maxCycles?: number;
  /** REQUIRED: build toward closing the gap (the goal names the current score + the failing capabilities).
   *  Provided by the CLI layer (council-crusade) so this core module never imports the cli layer. */
  _dispatch: (dimId: string, goal: string, cwd: string) => Promise<void>;
  _eval?: (command: string, cwd: string) => Promise<EvaluationResult>;
  _log?: (msg: string) => void;
}

export async function runGradedClimb(opts: RunGradedClimbOptions): Promise<GradedClimbResult> {
  const evalFn = opts._eval ?? ((c, cwd) => runGradedEvaluator(c, cwd));
  const log = opts._log ?? (() => { /* quiet by default */ });
  const target = opts.target ?? 0.9;
  const maxCycles = opts.maxCycles ?? 3;
  const trajectory: GradedClimbStep[] = [];

  let best = await evalFn(opts.evaluatorCommand, opts.cwd);
  const startScore = best.combinedScore;
  log(`[climb] ${opts.dimId}: start combined_score=${best.combinedScore.toFixed(3)} target=${target.toFixed(2)}`);

  let stoppedReason: GradedClimbResult['stoppedReason'] = shouldClimb(best, target) ? 'max-cycles' : 'reached-target';

  for (let cycle = 1; cycle <= maxCycles && shouldClimb(best, target); cycle++) {
    const gap = best.artifacts['detail'] ?? '(evaluator gave no detail)';
    const goal = `Raise the multi-capability score for "${opts.dimId}" from ${best.combinedScore.toFixed(3)} toward ${target.toFixed(2)} by BUILDING the FAILING capabilities (do not fake them). Measure with exactly: ${opts.evaluatorCommand}. Current checks: ${gap}`;
    log(`[climb] ${opts.dimId}: cycle ${cycle} — dispatch builder toward the gap`);

    let dispatched = false;
    try {
      await opts._dispatch(opts.dimId, goal, opts.cwd);
      dispatched = true;
    } catch (e) {
      log(`[climb] ${opts.dimId}: cycle ${cycle} — dispatch FAILED: ${e instanceof Error ? e.message : String(e)}`);
      trajectory.push({ cycle, before: best.combinedScore, after: best.combinedScore, kept: false, dispatched: false });
      stoppedReason = 'dispatch-failed';
      break;
    }

    const after = await evalFn(opts.evaluatorCommand, opts.cwd);
    const kept = isBetter(after, best);
    log(`[climb] ${opts.dimId}: cycle ${cycle} — ${best.combinedScore.toFixed(3)} → ${after.combinedScore.toFixed(3)} ${kept ? '(kept ✓)' : '(no gain — stop)'}`);
    trajectory.push({ cycle, before: best.combinedScore, after: after.combinedScore, kept, dispatched });

    if (kept) {
      best = after;
      stoppedReason = shouldClimb(best, target) ? 'max-cycles' : 'reached-target';
    } else {
      // No gain this cycle. Pure hill-climb stops honestly here rather than burning budget; escaping this
      // local max is the DGM-archive increment (CH-063), not a silent grind.
      stoppedReason = 'no-gain';
      break;
    }
  }

  return {
    dimId: opts.dimId,
    startScore,
    finalScore: best.combinedScore,
    reachedTarget: best.combinedScore >= target,
    stoppedReason,
    trajectory,
    final: best,
  };
}
