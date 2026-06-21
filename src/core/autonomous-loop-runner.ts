// autonomous-loop-runner.ts — the operator's autonomous council-loop, wired. Drives cycles using the honest
// decision brain (decideLoopAction): each cycle checks the panel can convene, runs ONE build step, measures
// the CONTAMINATION-RESISTANT grounding ratio before/after, and decides continue / pause / stop. It loops
// while real external grounding moves, PAUSES on a degraded panel (recoverable), and STOPS honestly at the
// capability ceiling (terminal) — never forever, never on a self-score.
//
// All side-effecting work is injected (measureGrounding / checkQuorum / runCycle / tokensSpent), so the loop
// CONTROL FLOW is fully unit-testable with fakes — no Docker, no council subprocess, no network. The real
// driver supplies: measureGrounding = externalGroundingReport's contamination-resistant ratio; checkQuorum =
// a council-ask whose quorumMet gates the cycle; runCycle = the capability climb (e.g. the CH-047 grade-in-
// loop run); tokensSpent = the budget meter.

import { decideLoopAction, type LoopDecision, type LoopDecisionConfig } from './autonomous-loop-decision.js';

export interface LoopRunnerDeps {
  /** Contamination-resistant grounding ratio (0..1) right now. The ONLY progress signal that counts. */
  measureGrounding: () => Promise<number>;
  /** Does the council panel reach quorum? false → pause (don't spend a cycle on a degraded panel). */
  checkQuorum: () => Promise<boolean>;
  /** Run ONE build step (the capability climb). May no-op in a dry run. */
  runCycle: (cycle: number) => Promise<void>;
  /** Output tokens spent so far this run (the budget meter). */
  tokensSpent: () => number;
  /** Progress log sink (defaults to no-op). */
  log?: (msg: string) => void;
}

export interface LoopRunnerConfig extends LoopDecisionConfig {
  maxCycles: number;
  tokenBudget: number | null;
}

export interface LoopRunSummary {
  status: 'paused' | 'stopped';
  /** True only when the terminal stop was the honest capability ceiling (not budget / cycle-cap). */
  ceilingHit: boolean;
  cyclesRun: number;
  groundingStart: number;
  groundingEnd: number;
  finalReason: string;
  history: Array<{ cycle: number } & LoopDecision>;
}

const DEFAULT_CONFIG: LoopRunnerConfig = { maxCycles: 20, tokenBudget: null, ceilingPatience: 3 };

/**
 * Run the autonomous loop until it pauses (degraded panel) or stops (budget / cycle-cap / capability ceiling).
 * Returns a summary the operator reads to know WHY it ended — the ceiling flag distinguishes "the model hit
 * its limit" from "we ran out of budget/cycles". Deterministic given deterministic deps.
 */
export async function runAutonomousLoop(
  deps: LoopRunnerDeps,
  config: Partial<LoopRunnerConfig> = {},
): Promise<LoopRunSummary> {
  const cfg: LoopRunnerConfig = { ...DEFAULT_CONFIG, ...config };
  const log = deps.log ?? (() => {});
  const history: Array<{ cycle: number } & LoopDecision> = [];

  const groundingStart = await deps.measureGrounding();
  let grounding = groundingStart;
  let stale = 0;

  for (let cycle = 1; cycle <= cfg.maxCycles; cycle++) {
    // PRE-CYCLE: never spend a cycle on a panel that can't cross-check itself. Pause is recoverable — the
    // scheduler resumes when the panel returns (this run ends cleanly with status 'paused').
    const quorumMet = await deps.checkQuorum();
    if (!quorumMet) {
      const decision = decideLoopAction(
        { quorumMet, groundingBefore: grounding, groundingAfter: grounding, staleCycles: stale,
          tokensSpent: deps.tokensSpent(), tokenBudget: cfg.tokenBudget, cycle, maxCycles: cfg.maxCycles }, cfg);
      history.push({ cycle, ...decision });
      log(`[loop] cycle ${cycle}: PAUSE — ${decision.reason}`);
      return summarize('paused', decision, cycle - 1, groundingStart, grounding, history);
    }
    // PRE-CYCLE budget/cap stop (don't start a cycle we can't afford / are past the cap).
    if (cfg.tokenBudget !== null && deps.tokensSpent() >= cfg.tokenBudget) {
      const decision = decideLoopAction(
        { quorumMet, groundingBefore: grounding, groundingAfter: grounding, staleCycles: stale,
          tokensSpent: deps.tokensSpent(), tokenBudget: cfg.tokenBudget, cycle, maxCycles: cfg.maxCycles }, cfg);
      history.push({ cycle, ...decision });
      log(`[loop] cycle ${cycle}: STOP — ${decision.reason}`);
      return summarize('stopped', decision, cycle - 1, groundingStart, grounding, history);
    }

    // RUN one build step, then measure real external progress.
    log(`[loop] cycle ${cycle}: running build step (grounding ${grounding.toFixed(3)}, ${stale} stale)…`);
    await deps.runCycle(cycle);
    const after = await deps.measureGrounding();
    stale = after > grounding ? 0 : stale + 1;

    const decision = decideLoopAction(
      { quorumMet, groundingBefore: grounding, groundingAfter: after, staleCycles: stale,
        tokensSpent: deps.tokensSpent(), tokenBudget: cfg.tokenBudget, cycle, maxCycles: cfg.maxCycles }, cfg);
    history.push({ cycle, ...decision });
    grounding = after;
    log(`[loop] cycle ${cycle}: ${decision.action.toUpperCase()} — ${decision.reason}`);
    if (decision.action !== 'continue') {
      return summarize(decision.action === 'pause' ? 'paused' : 'stopped', decision, cycle, groundingStart, grounding, history);
    }
  }

  // Exhausted the cycle cap while still making/attempting progress.
  const decision: LoopDecision = { action: 'stop', reason: `max cycles reached (${cfg.maxCycles})` };
  history.push({ cycle: cfg.maxCycles, ...decision });
  return summarize('stopped', decision, cfg.maxCycles, groundingStart, grounding, history);
}

function summarize(
  status: 'paused' | 'stopped', decision: LoopDecision, cyclesRun: number,
  groundingStart: number, groundingEnd: number, history: Array<{ cycle: number } & LoopDecision>,
): LoopRunSummary {
  return {
    status, ceilingHit: decision.ceilingHit === true, cyclesRun,
    groundingStart, groundingEnd, finalReason: decision.reason, history,
  };
}
