// ascend-frontier-engine.ts — the pure decision core of the autonomous frontier orchestrator.
//
// planNextAction looks at every dimension's honest state (effective score, frontier_spec status,
// ceiling receipt, novel attempts spent) and returns the single next action the loop should take.
// It is pure and fully testable; the CLI (ascend-frontier.ts) executes the action by delegating to
// existing commands. STOP is honest: the loop is `done` only when every dim is at the validated
// frontier OR carries an active ceiling — never when scores merely look green.

import type { CeilingReceipt, CeilingCause } from './ceiling-receipt.js';
import { isCeilingActive } from './ceiling-receipt.js';

export type FrontierSpecStatus = 'validated' | 'frozen' | 'draft' | 'stale' | 'none';

export interface DimState {
  id: string;
  /** Honest effective score (min self/derived), already frontier-gated. */
  effectiveScore: number;
  frontierStatus: FrontierSpecStatus;
  /** Active ceiling receipt for this dim, or null. */
  ceiling: CeilingReceipt | null;
  /** Novel push attempts already spent on this dim this campaign. */
  attempts: number;
  /** True when the dim is structurally market-capped (≤5.0, can't reach 9 pre-release). */
  isMarketCapped: boolean;
  /** True when the dim has no capability_test/outcomes yet (setup incomplete). */
  needsSetup?: boolean;
  /** No-progress counters maintained by the loop: setup/build cycles that did NOT advance this dim. */
  setupAttempts?: number;
  buildAttempts?: number;
}

export type AscendAction =
  | { type: 'setup'; dims: string[] }
  | { type: 'build-to-7'; dims: string[] }
  | { type: 'push-to-9'; dimId: string }
  | { type: 'ceiling'; dimId: string; cause: CeilingCause; detail: string }
  | { type: 'done'; summary: string }
  | { type: 'stalled'; reason: string };

export interface PlanOpts {
  /** Max novel push attempts before a dim is ceilinged as a generator-ceiling. */
  maxAttemptsPerDim: number;
  /** Max no-progress setup/build cycles before a stuck dim is ceilinged. Default maxAttemptsPerDim. */
  maxBuildAttempts?: number;
  nowIso: string;
  buildTarget?: number; // default 7.0
}

/** A dim is "complete" for STOP accounting: at the validated frontier OR carrying an active ceiling.
 *
 *  A court-VALIDATED dim is terminal REGARDLESS of its current derived score (rehearsal-mode
 *  finding): the court is the sole authority past 8.0, and a validated dim whose receipts derive
 *  below 9 (decay, T7 consensus pending) is depth/validate work — re-PUSHING it re-convenes
 *  judges on an already-validated spec and, after maxAttempts, ceilinged it with FALSE provenance
 *  ("N novel attempts failed the court" — they were validations). effectiveStatus already demotes
 *  a post-validation EDIT to 'stale', so this never lets a moved-goalpost dim read as done. */
export function isDimDone(d: DimState, nowIso: string): boolean {
  if (d.frontierStatus === 'validated') return true;
  return d.ceiling != null && isCeilingActive(d.ceiling, nowIso);
}

export function planNextAction(dims: DimState[], opts: PlanOpts): AscendAction {
  const target = opts.buildTarget ?? 7.0;
  const maxBuild = opts.maxBuildAttempts ?? opts.maxAttemptsPerDim;
  const active = (d: DimState): boolean => d.ceiling != null && isCeilingActive(d.ceiling, opts.nowIso);

  // 0a. STALLED setup → sign an honest ceiling so one un-scaffoldable dim never blocks the whole loop
  //     forever ("setup(1 dims)" every cycle). Checked FIRST so a stuck setup dim can't wedge the run.
  const setupStuck = dims.find(d => d.needsSetup && !active(d) && (d.setupAttempts ?? 0) >= maxBuild);
  if (setupStuck) {
    return { type: 'ceiling', dimId: setupStuck.id, cause: 'generator-ceiling',
      detail: `Setup could not produce a capability_test/outcome after ${setupStuck.setupAttempts} attempts — held at ${setupStuck.effectiveScore.toFixed(1)} (review: environment limit, market dim, or needs a real frontier_spec).` };
  }
  // 0b. Setup: dims still missing scaffolding, with attempts remaining.
  const needSetup = dims.filter(d => d.needsSetup && !active(d) && (d.setupAttempts ?? 0) < maxBuild).map(d => d.id);
  if (needSetup.length > 0) return { type: 'setup', dims: needSetup };

  // 1. Market-capped dims that aren't ceilinged yet → write a market-cap ceiling (done honestly).
  const market = dims.find(d => d.isMarketCapped && !active(d));
  if (market) {
    return { type: 'ceiling', dimId: market.id, cause: 'market-cap',
      detail: `Market dimension — pre-release cannot reach 9.0; held at ${market.effectiveScore.toFixed(1)}.` };
  }

  // 2a. STALLED build-to-7 → sign a ceiling for a dim that cannot reach the target (the un-buildable
  //     ones: environment-blocked, unimplemented placeholders, or a genuine generator ceiling). This
  //     is what lets the loop ADVANCE to push-to-9 on the buildable dims instead of spinning forever.
  const buildStuck = dims.find(d => d.effectiveScore < target && !active(d) && (d.buildAttempts ?? 0) >= maxBuild);
  if (buildStuck) {
    return { type: 'ceiling', dimId: buildStuck.id, cause: 'generator-ceiling',
      detail: `Could not reach ${target.toFixed(1)} after ${buildStuck.buildAttempts} build attempts — un-buildable here (environment limit, unimplemented, or generator ceiling); held at ${buildStuck.effectiveScore.toFixed(1)}.` };
  }
  // 2b. Build-to-7: non-ceilinged dims still below target, with attempts remaining.
  const belowTarget = dims.filter(d => d.effectiveScore < target && !active(d) && (d.buildAttempts ?? 0) < maxBuild).map(d => d.id);
  if (belowTarget.length > 0) return { type: 'build-to-7', dims: belowTarget };

  // 3. Push-to-9: the weakest dim that is not done and has attempts left. Exhausted → generator ceiling.
  const candidates = dims
    .filter(d => !isDimDone(d, opts.nowIso) && !active(d))
    .sort((a, b) => a.effectiveScore - b.effectiveScore);

  if (candidates.length === 0) {
    const total = dims.length;
    const ceilinged = dims.filter(d => active(d)).length;
    const validated = dims.filter(d => d.frontierStatus === 'validated').length;
    return { type: 'done', summary: `${validated}/${total} at validated frontier, ${ceilinged} at honest ceiling — all dims complete.` };
  }

  const next = candidates[0]!;
  if (next.attempts >= opts.maxAttemptsPerDim) {
    return { type: 'ceiling', dimId: next.id, cause: 'generator-ceiling',
      detail: `${next.attempts} novel attempts failed the frontier-review court — honest generator ceiling at ${next.effectiveScore.toFixed(1)}.` };
  }
  return { type: 'push-to-9', dimId: next.id };
}
