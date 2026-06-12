// self-healing-advisor.ts — Recommends recovery actions when a convergence loop plateaus.
// Pure functions only — no I/O, fully testable.

import {
  type ConvergenceState,
  computeConvergenceVelocity,
} from './convergence-tracker.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HealingAction =
  | 'expand-search'      // try different OSS patterns
  | 'harvest-more'       // harvest from additional OSS sources
  | 'adversarial-rebase' // run adversarial scorer before continuing
  | 'restart-dimension'  // reset dimension and start fresh
  | 'accept-ceiling'     // accept that the dimension has a real ceiling
  | 'split-dimension';   // break dimension into sub-dimensions

export interface HealingRecommendation {
  /** Concrete action to take. */
  action: HealingAction;
  /** Human-readable explanation for the choice. */
  rationale: string;
  /** How urgently the action is needed. */
  urgency: 'low' | 'medium' | 'high';
}

export interface HealingAdvisorOptions {
  /** Maximum score any competitor achieves on this dimension (0–10). */
  competitorMax?: number;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

const HIGH_SCORE_CEILING = 8.5;
const LOW_SCORE_CEILING = 7.0;
const HIGH_PLATEAU_COUNT = 5;
const MED_PLATEAU_COUNT = 3;
const LOW_PLATEAU_COUNT = 2;
const LOW_VELOCITY_THRESHOLD = 0.05;
const FRONTIER_GAP_THRESHOLD = 0.5;

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Recommend a single healing action given the current convergence state.
 *
 * Decision tree (evaluated top-to-bottom, first match wins):
 *  1. high plateau with competitor frontier gap -> split-dimension
 *  2. plateauCount >= 5 AND score >= 8.5  → accept-ceiling
 *  3. plateauCount >= 3 AND score < 7.0   → restart-dimension
 *  4. plateauCount >= 2 AND score < 8.5   → harvest-more
 *  5. velocity < 0.05 per cycle           → adversarial-rebase
 *  6. else                                → expand-search
 */
export function recommendHealingAction(
  state: ConvergenceState,
  options: HealingAdvisorOptions = {},
): HealingRecommendation {
  const { plateauCount, currentScore } = state;
  const velocity = computeConvergenceVelocity(state);
  const { competitorMax } = options;
  const frontierGap = competitorMax === undefined ? 0 : competitorMax - currentScore;

  if (
    plateauCount >= HIGH_PLATEAU_COUNT &&
    currentScore >= HIGH_SCORE_CEILING &&
    frontierGap >= FRONTIER_GAP_THRESHOLD
  ) {
    return {
      action: 'split-dimension',
      rationale:
        `Score ${currentScore.toFixed(2)} has plateaued for ${plateauCount} consecutive cycles, ` +
        `but the competitor frontier is ${competitorMax!.toFixed(1)} ` +
        `(${frontierGap.toFixed(1)} points ahead). The dimension is likely bundling multiple ` +
        `capabilities, so split it into narrower sub-dimensions before accepting any ceiling.`,
      urgency: 'high',
    };
  }

  // Rule 1 — accept-ceiling
  if (plateauCount >= HIGH_PLATEAU_COUNT && currentScore >= HIGH_SCORE_CEILING) {
    const competitorNote =
      competitorMax !== undefined && currentScore >= competitorMax
        ? ` No competitor exceeds ${competitorMax.toFixed(1)} on this dimension.`
        : '';
    return {
      action: 'accept-ceiling',
      rationale:
        `Score ${currentScore.toFixed(2)} has plateaued for ${plateauCount} consecutive cycles ` +
        `at or above the ${HIGH_SCORE_CEILING} ceiling threshold.${competitorNote} ` +
        `This dimension has likely reached its practical ceiling.`,
      urgency: 'low',
    };
  }

  // Rule 2 — restart-dimension
  if (plateauCount >= MED_PLATEAU_COUNT && currentScore < LOW_SCORE_CEILING) {
    return {
      action: 'restart-dimension',
      rationale:
        `Score ${currentScore.toFixed(2)} is stuck below ${LOW_SCORE_CEILING} after ` +
        `${plateauCount} consecutive non-improving cycles. The current approach is not ` +
        `working — a full reset is needed.`,
      urgency: 'high',
    };
  }

  // Rule 3 — harvest-more
  if (plateauCount >= LOW_PLATEAU_COUNT && currentScore < HIGH_SCORE_CEILING) {
    return {
      action: 'harvest-more',
      rationale:
        `Score ${currentScore.toFixed(2)} has stalled for ${plateauCount} cycles below ` +
        `the ${HIGH_SCORE_CEILING} ceiling. Harvesting additional OSS patterns should ` +
        `provide new signals to break the plateau.`,
      urgency: 'medium',
    };
  }

  // Rule 4 — adversarial-rebase
  if (velocity < LOW_VELOCITY_THRESHOLD) {
    return {
      action: 'adversarial-rebase',
      rationale:
        `Convergence velocity is ${velocity.toFixed(3)} pts/cycle — below the ` +
        `${LOW_VELOCITY_THRESHOLD} threshold. Running the adversarial scorer will ` +
        `surface hidden weaknesses before the next improvement cycle.`,
      urgency: 'medium',
    };
  }

  // Default — expand-search
  return {
    action: 'expand-search',
    rationale:
      `No critical plateau detected (plateauCount=${plateauCount}, ` +
      `score=${currentScore.toFixed(2)}, velocity=${velocity.toFixed(3)}). ` +
      `Broadening the pattern search space is the safest next step.`,
    urgency: 'low',
  };
}
