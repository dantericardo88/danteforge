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
  nowIso: string;
  buildTarget?: number; // default 7.0
}

/** A dim is "complete" for STOP accounting: at the validated frontier OR carrying an active ceiling. */
export function isDimDone(d: DimState, nowIso: string): boolean {
  if (d.frontierStatus === 'validated' && d.effectiveScore >= 9.0) return true;
  return d.ceiling != null && isCeilingActive(d.ceiling, nowIso);
}

export function planNextAction(dims: DimState[], opts: PlanOpts): AscendAction {
  const target = opts.buildTarget ?? 7.0;
  const active = (d: DimState): boolean => d.ceiling != null && isCeilingActive(d.ceiling, opts.nowIso);

  // 0. Setup: dims with no capability_test/outcome scaffolding yet.
  const needSetup = dims.filter(d => d.needsSetup && !active(d)).map(d => d.id);
  if (needSetup.length > 0) return { type: 'setup', dims: needSetup };

  // 1. Market-capped dims that aren't ceilinged yet → write a market-cap ceiling (done honestly).
  const market = dims.find(d => d.isMarketCapped && !active(d));
  if (market) {
    return { type: 'ceiling', dimId: market.id, cause: 'market-cap',
      detail: `Market dimension — pre-release cannot reach 9.0; held at ${market.effectiveScore.toFixed(1)}.` };
  }

  // 2. Build-to-7: any non-ceilinged dim still below the breadth target.
  const belowTarget = dims.filter(d => d.effectiveScore < target && !active(d)).map(d => d.id);
  if (belowTarget.length > 0) return { type: 'build-to-7', dims: belowTarget };

  // 3. Push-to-9: the weakest dim that is not done and has attempts left. Exhausted → generator ceiling.
  const candidates = dims
    .filter(d => !isDimDone(d, opts.nowIso) && !active(d))
    .sort((a, b) => a.effectiveScore - b.effectiveScore);

  if (candidates.length === 0) {
    const total = dims.length;
    const ceilinged = dims.filter(d => active(d)).length;
    const validated = dims.filter(d => d.frontierStatus === 'validated' && d.effectiveScore >= 9).length;
    return { type: 'done', summary: `${validated}/${total} at validated frontier, ${ceilinged} at honest ceiling — all dims complete.` };
  }

  const next = candidates[0]!;
  if (next.attempts >= opts.maxAttemptsPerDim) {
    return { type: 'ceiling', dimId: next.id, cause: 'generator-ceiling',
      detail: `${next.attempts} novel attempts failed the frontier-review court — honest generator ceiling at ${next.effectiveScore.toFixed(1)}.` };
  }
  return { type: 'push-to-9', dimId: next.id };
}
