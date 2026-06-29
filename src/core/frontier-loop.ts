// frontier-loop.ts — the court-feedback loop that actually CONVERGES to a 9 (or an honest ceiling).
//
// WHY THIS EXISTS (the diagnosis, 2026-06-23): ascend-frontier-push already wires court-feedback
// (loadCourtFeedback → composeBuildGoal → build → parseCourtFeedback → recordCourtFeedback). But it never
// reached a 9, for two reasons this loop fixes:
//   1. Its evidence-authoring was the frontier-spec auto-prober, which gives up ("no viable exercise") and never
//      produces court-ready T7 evidence — so the court never sees a real demonstration. This loop authors
//      evidence with the WORKING evidence-ladder tool instead.
//   2. On rejection it dispatched a CODE builder, not a re-author of the DEMONSTRATIONS the court judges. This
//      loop composes the re-author goal from the judges' own words and dispatches it to author NEW evidence.
//
// Each iteration: author a clean T7 ladder (evidence-ladder) → run the court → record the verdict. On VALIDATED,
// the 9 is reached. On REJECTED, compose a re-author goal from the dissent and dispatch a builder to author a
// demonstration that exercises the named capability, then loop. Stops honestly on repeatedObjection (the
// capability genuinely isn't superior on this axis — a real ceiling, not a failure) or maxIters.

import {
  composeBuildGoal, loadCourtFeedback, parseCourtFeedback, recordCourtFeedback, repeatedObjection,
} from './court-feedback.js';
import type { FrontierSpec } from './frontier-spec.js';

export type CourtVerdict = 'VALIDATED' | 'REJECTED' | 'INSUFFICIENT' | 'NOT_READY' | 'ERROR';

/**
 * Classify `frontier-review --json` output into a verdict. CRITICAL (council/Codex 2026-06-23): a VALIDATED is a
 * real 9 ONLY when `validatedWritten === true && ceilingWritten === false`. frontier-review can return
 * `result.verdict === 'VALIDATED'` yet write a CEILING (validatedWritten=false, ceilingWritten=true) when CIP
 * blocks it — so trusting raw "VALIDATED" text would let the loop FALSELY stop on a CIP-blocked pass and mint a
 * an unearned 9. A bare "VALIDATED" with no JSON proof is therefore NOT trusted. Pure; exported for the pin.
 */
export function classifyCourtOutput(stdout: string): CourtVerdict {
  let validatedWritten = false; let ceilingWritten = false; let resultVerdict = '';
  try {
    const i = stdout.indexOf('{'); const j = stdout.lastIndexOf('}');
    if (i >= 0 && j > i) {
      const o = JSON.parse(stdout.slice(i, j + 1)) as { validatedWritten?: boolean; ceilingWritten?: boolean; result?: { verdict?: string } };
      validatedWritten = o.validatedWritten === true;
      ceilingWritten = o.ceilingWritten === true;
      resultVerdict = o.result?.verdict ?? '';
    }
  } catch { /* fall through to the conservative text heuristics */ }
  if (validatedWritten && !ceilingWritten) return 'VALIDATED';           // the ONLY real-9 condition
  if (ceilingWritten || resultVerdict === 'REJECTED' || /\bREJECTED\b/.test(stdout)) return 'REJECTED';
  if (/independent judges|insufficient/i.test(stdout)) return 'INSUFFICIENT';
  return 'ERROR'; // includes a bare textual "VALIDATED" with no validatedWritten proof — never trusted
}

export interface FrontierLoopIteration {
  iter: number;
  tier: string;
  courtReady: boolean;
  verdict: CourtVerdict;
  objection?: string;
}

export interface FrontierLoopResult {
  validated: boolean;
  iterations: FrontierLoopIteration[];
  stoppedReason: string;
  /** The re-author goal composed for the NEXT iteration (or the operator), if it stopped before validating. */
  nextGoal?: string;
}

/** Injectable steps (defaults shell to the real CLI commands; tests inject deterministic fakes). */
export interface FrontierLoopSeams {
  /** Author a clean T7 ladder via the evidence-ladder tool. */
  authorLadder: (dimId: string, configPath: string, cwd: string) => Promise<{ courtReady: boolean; tier: string; reason: string }>;
  /** Run the frontier-review court; return the parsed verdict + raw stdout (for parseCourtFeedback). */
  runCourt: (dimId: string, cwd: string) => Promise<{ verdict: CourtVerdict; stdout: string }>;
  /** Dispatch a builder to author NEW evidence that addresses the composed goal (the court's objection). */
  reauthor: (dimId: string, goal: string, cwd: string) => Promise<void>;
}

export interface FrontierLoopOptions {
  dimId: string;
  configPath: string;
  maxIters: number;
  cwd?: string;
  /** The frozen frontier_spec (the BAR the judges judge against). Passed into composeBuildGoal so the re-author
   *  goal cites the competitor bar, not only the dissent (council/Grok 2026-06-23). */
  spec?: FrontierSpec;
}

/**
 * Run the convergent court-feedback loop. Pure orchestration over the injected seams + the existing
 * court-feedback primitives — so the convergence/ceiling logic is unit-testable without spawning agents.
 */
export async function runFrontierLoop(opts: FrontierLoopOptions, seams: FrontierLoopSeams): Promise<FrontierLoopResult> {
  const cwd = opts.cwd ?? process.cwd();
  const iterations: FrontierLoopIteration[] = [];

  for (let iter = 1; iter <= opts.maxIters; iter++) {
    // 1. Author a clean, court-ready T7 evidence ladder (the WORKING authoring — not the auto-prober).
    const ladder = await seams.authorLadder(opts.dimId, opts.configPath, cwd);
    if (!ladder.courtReady) {
      iterations.push({ iter, tier: ladder.tier, courtReady: false, verdict: 'NOT_READY' });
      return { validated: false, iterations, stoppedReason: `evidence did not reach a clean court-ready T7: ${ladder.reason}` };
    }

    // 2. Run the court + persist its verdict so the loop (and future runs) can see repeated objections. The
    //    write is load-bearing for the honest-ceiling tripwire (council/Claude): if it silently fails the loop
    //    can't see prior verdicts and re-rolls to maxIters — so on a write failure we STOP rather than burn budget.
    const court = await seams.runCourt(opts.dimId, cwd);
    const fb = parseCourtFeedback(court.stdout, opts.dimId, court.verdict);
    let feedbackPersisted = true;
    try { await recordCourtFeedback(cwd, fb); } catch { feedbackPersisted = false; }
    const objection = fb.dissent[0] ?? fb.summary;
    iterations.push({ iter, tier: ladder.tier, courtReady: true, verdict: court.verdict, objection });

    // 3. Branch on the verdict.
    if (court.verdict === 'VALIDATED') {
      return { validated: true, iterations, stoppedReason: 'court VALIDATED — the dimension is at the frontier (9.0)' };
    }
    if (court.verdict === 'INSUFFICIENT') {
      return { validated: false, iterations, stoppedReason: 'court could not seat enough independent judges (quorum/environment) — not a capability verdict' };
    }
    if (court.verdict === 'ERROR') {
      return { validated: false, iterations, stoppedReason: 'court errored — see logs' };
    }

    // REJECTED → honest-ceiling tripwire: the SAME objection twice means another re-author is waste.
    const feedback = await loadCourtFeedback(cwd, opts.dimId);
    if (!feedbackPersisted) {
      return {
        validated: false, iterations,
        stoppedReason: `could not persist court feedback — stopping rather than re-rolling blind (the honest-ceiling tripwire needs the verdict history). Court: ${objection}`,
        nextGoal: composeBuildGoal(opts.dimId, opts.spec, feedback),
      };
    }
    if (repeatedObjection(feedback)) {
      return {
        validated: false, iterations,
        stoppedReason: `repeated objection — honest ceiling: the capability is not genuinely superior on this axis. Court: ${objection}`,
        nextGoal: composeBuildGoal(opts.dimId, opts.spec, feedback),
      };
    }

    // 4. Compose the re-author goal from the judges' OWN words (+ the bar from the frozen spec) and dispatch it —
    //    author NEW evidence that exercises the capability the court named. Then loop and re-judge.
    const goal = composeBuildGoal(opts.dimId, opts.spec, feedback);
    if (iter === opts.maxIters) {
      return { validated: false, iterations, stoppedReason: `reached maxIters (${opts.maxIters}) without validation`, nextGoal: goal };
    }
    await seams.reauthor(opts.dimId, goal, cwd);
  }

  return { validated: false, iterations, stoppedReason: `reached maxIters (${opts.maxIters}) without validation` };
}
