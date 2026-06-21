// autonomous-loop-decision.ts — the honest decision brain for the operator's autonomous council-loop:
// default-to-best + route-forks-to-council + loop-until-GROUNDED (never loop-until-self-score). Given one
// cycle's outcome it returns continue / pause / stop with a reason.
//
// The non-obvious rule is the CAPABILITY-CEILING STALL: when N consecutive cycles fail to move the
// CONTAMINATION-RESISTANT grounding ratio, the loop STOPS and reports the ceiling honestly — it never loops
// forever, and never claims progress the external receipts don't show. This is the structural answer to "can
// three models push a project to the frontier autonomously?": yes — until capability stalls, which voting,
// looping, and token-spend cannot dissolve (proven this session: the solver re-submitted a byte-identical
// patch even when handed the exact grader regressions). The loop is genuinely autonomous AND honest precisely
// because it gates on an external receipt it cannot author and stops when that receipt stops moving.

export type LoopAction = 'continue' | 'pause' | 'stop';

export interface LoopCycleState {
  /** Did the council panel reach quorum this cycle? false → the panel is degraded (a lone/empty vote cannot
   *  cross-check itself); the loop must PAUSE, not act. Mirrors council-ask's exit-3 quorum guard. */
  quorumMet: boolean;
  /** Contamination-resistant grounding ratio BEFORE and AFTER this cycle (0..1). Real progress = after > before.
   *  This is external-receipt grounding ONLY (a self-score moving is not progress). */
  groundingBefore: number;
  groundingAfter: number;
  /** Consecutive cycles (including this one) in which grounding did NOT move — the capability-ceiling detector. */
  staleCycles: number;
  /** Output tokens spent so far this run; budget is the hard ceiling (null = no budget set). */
  tokensSpent: number;
  tokenBudget: number | null;
  /** This cycle index (1-based) and the safety cap on total cycles. */
  cycle: number;
  maxCycles: number;
}

export interface LoopDecisionConfig {
  /** Stop after this many consecutive non-progress cycles — the honest capability-ceiling stall. Default 3. */
  ceilingPatience: number;
}

export interface LoopDecision {
  action: LoopAction;
  reason: string;
  /** True only when the stop is the honest capability-ceiling (vs budget / cycle-cap) — surfaced so the
   *  operator sees "we hit the model's limit", not "we ran out of cycles". */
  ceilingHit?: boolean;
}

const DEFAULTS: LoopDecisionConfig = { ceilingPatience: 3 };

/**
 * Decide the autonomous loop's next action from one cycle's outcome. Pure + total. Precedence is deliberate:
 *   1. quorum (safety: never act on a degraded panel)  — PAUSE
 *   2. budget exhausted                                 — STOP
 *   3. cycle cap                                        — STOP
 *   4. grounding moved (real external progress)         — CONTINUE
 *   5. capability ceiling (N stale cycles)              — STOP (ceilingHit)
 *   6. no progress yet, within patience                 — CONTINUE
 * PAUSE is recoverable (the loop driver waits + retries when the panel returns); STOP is terminal.
 */
export function decideLoopAction(state: LoopCycleState, config: Partial<LoopDecisionConfig> = {}): LoopDecision {
  const ceilingPatience = Math.max(1, config.ceilingPatience ?? DEFAULTS.ceilingPatience);

  // 1. Degraded panel → PAUSE. Recoverable: the driver waits for the panel to convene, it does not give up.
  if (!state.quorumMet) {
    return {
      action: 'pause',
      reason: 'council quorum not met — the panel cannot cross-check itself; pausing rather than acting on a degraded vote',
    };
  }
  // 2. Budget is a HARD ceiling — stop even mid-progress (the operator caps the spend, not the loop).
  if (state.tokenBudget !== null && state.tokensSpent >= state.tokenBudget) {
    return { action: 'stop', reason: `token budget exhausted (${state.tokensSpent} >= ${state.tokenBudget})` };
  }
  // 3. Safety cap on total cycles.
  if (state.cycle >= state.maxCycles) {
    return { action: 'stop', reason: `max cycles reached (${state.cycle}/${state.maxCycles})` };
  }
  // 4. Real external progress → keep climbing.
  if (state.groundingAfter > state.groundingBefore) {
    return {
      action: 'continue',
      reason: `grounding ratio moved ${state.groundingBefore.toFixed(3)} → ${state.groundingAfter.toFixed(3)} — real external progress, keep climbing`,
    };
  }
  // 5. Capability ceiling — N consecutive cycles with no grounding movement. The honest terminal state.
  if (state.staleCycles >= ceilingPatience) {
    return {
      action: 'stop',
      ceilingHit: true,
      reason: `capability ceiling: ${state.staleCycles} consecutive cycles moved no contamination-resistant grounding — stopping honestly (no orchestration trick manufactures capability the model lacks)`,
    };
  }
  // 6. No movement this cycle, but still within the patience window → retry.
  return {
    action: 'continue',
    reason: `no grounding movement this cycle (${state.staleCycles}/${ceilingPatience} stale) — retry within the ceiling-patience window`,
  };
}
