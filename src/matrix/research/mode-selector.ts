// Matrix Research — mode selector. Pure function that evaluates the 7
// activation criteria from PRD section 5 and returns whether research mode
// should run for a given dim.
//
// Phase N of docs/PRDs/autonomous-frontier-reaching.md.
//
// Stop conditions: refuses to run when ANY criterion fails. The criteria are:
//   1. Project composite derived score >= composite_threshold (default 7.5)
//   2. Dim's derived score in [per_dim_score_range] (default [6.5, 8.5])
//   3. Dim plateaued for >= stuck_waves_before_research (default 3)
//   4. Dim's declared_ceiling at least one tier above achieved tier
//   5. Dim not currently in dispensation
//   6. Dim not marked human_review_pending
//   7. Dim not architecturally capped (structural_cap_reason set)

import {
  CANONICAL_RESEARCH_ROLES,
  DEFAULT_RESEARCH_MODE_CONFIG,
  type ActivationResult,
  type ResearchAgentRole,
  type ResearchModeConfig,
  type ResearchStatus,
} from './types.js';
import type { CapabilityTier } from '../types/capability-test.js';

const TIER_ORDER: CapabilityTier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

function tierIndex(t: CapabilityTier | null | undefined): number {
  if (!t) return -1;
  return TIER_ORDER.indexOf(t);
}

export interface ActivationInput {
  /** The dim's id (for error messages). */
  dimensionId: string;
  /** Project's composite derived score. */
  projectComposite: number;
  /** Dim's derived score. */
  dimDerivedScore: number;
  /** Highest tier the dim has passed evidence at. null when no evidence. */
  achievedTier: CapabilityTier | null;
  /** Dim's declared ceiling (T0..T6). */
  declaredCeiling: CapabilityTier;
  /** Whether any active dispensation targets this dim. */
  hasActiveDispensation: boolean;
  /** Per-dim research metadata. */
  researchStatus?: ResearchStatus;
  /** Config (optional; defaults to DEFAULT_RESEARCH_MODE_CONFIG). */
  config?: ResearchModeConfig;
  /** Operator override: force activation even when criteria fail (audit-logged). */
  force?: boolean;
}

/**
 * Pure function: returns whether research mode should run.
 *
 * Side effects: NONE. This is intentional — the selector is called from
 * multiple contexts (crusade --research, research status, MCP queries) and
 * mutating state from here would be a bug.
 */
export function isResearchActivated(input: ActivationInput): ActivationResult {
  const config = input.config ?? DEFAULT_RESEARCH_MODE_CONFIG;
  const status = input.researchStatus;

  // Force override skips all criteria but still records the reason.
  if (input.force) {
    return {
      shouldActivate: true,
      council: selectCouncil(input, config),
      achievedTier: input.achievedTier,
      declaredCeiling: input.declaredCeiling,
    };
  }

  // Criterion 7: architecturally capped.
  if (status?.structural_cap_reason) {
    return { shouldActivate: false, blockingReason: `dim is architecturally capped: ${status.structural_cap_reason}` };
  }

  // Criterion 6: human review pending (from a prior conflict).
  if (status?.human_review_pending) {
    return { shouldActivate: false, blockingReason: 'dim has unresolved conflict from prior wave; operator must resolve' };
  }

  // Criterion 5: active dispensation.
  if (input.hasActiveDispensation) {
    return { shouldActivate: false, blockingReason: 'active dispensation on this dim pauses autonomy' };
  }

  // Criterion 1: project composite high enough.
  if (input.projectComposite < config.composite_threshold) {
    return {
      shouldActivate: false,
      blockingReason: `project composite ${input.projectComposite.toFixed(2)} < threshold ${config.composite_threshold}`,
    };
  }

  // Criterion 2: dim derived score in sweet-spot range.
  const [lo, hi] = config.per_dim_score_range;
  if (input.dimDerivedScore < lo || input.dimDerivedScore > hi) {
    return {
      shouldActivate: false,
      blockingReason: `dim score ${input.dimDerivedScore.toFixed(2)} outside research range [${lo}, ${hi}]`,
    };
  }

  // Criterion 3: stuck for enough waves.
  const stuck = status?.consecutive_stuck_waves ?? 0;
  if (stuck < config.stuck_waves_before_research) {
    return {
      shouldActivate: false,
      blockingReason: `dim stuck for only ${stuck} waves; need ${config.stuck_waves_before_research}`,
    };
  }

  // Criterion 4: room to grow within declared_ceiling.
  const ceilIdx = tierIndex(input.declaredCeiling);
  const achievedIdx = tierIndex(input.achievedTier);
  if (achievedIdx >= ceilIdx) {
    return {
      shouldActivate: false,
      blockingReason: `dim has reached declared_ceiling (${input.declaredCeiling}); no room to grow`,
    };
  }

  return {
    shouldActivate: true,
    council: selectCouncil(input, config),
    achievedTier: input.achievedTier,
    declaredCeiling: input.declaredCeiling,
  };
}

/**
 * Compose the agent council for a wave. Default behavior: spawn the canonical
 * roles up to `default_agent_count`. The benchmark-designer always runs first
 * and alone (PRD section 5); the hybrid-synthesizer always runs last.
 *
 * Future: per-dim council composition based on dim characteristics. For now,
 * uses the canonical set.
 */
export function selectCouncil(
  input: ActivationInput,
  config: ResearchModeConfig,
): ResearchAgentRole[] {
  void input; // future per-dim selection
  // Sort by spawn_priority and take the first N.
  const sorted = [...CANONICAL_RESEARCH_ROLES].sort((a, b) => a.spawn_priority - b.spawn_priority);
  const benchmarkDesigner = sorted.find(r => r.id === 'benchmark-designer');
  const synthesizer = sorted.find(r => r.id === 'hybrid-synthesizer');
  const middle = sorted.filter(r => r.id !== 'benchmark-designer' && r.id !== 'hybrid-synthesizer');

  // Take config.default_agent_count - 2 from the middle (benchmark + synthesizer always run).
  const middleSize = Math.max(0, Math.min(config.default_agent_count, config.max_agent_count) - 2);
  const middleSlice = middle.slice(0, middleSize);

  const result: ResearchAgentRole[] = [];
  if (benchmarkDesigner) result.push(benchmarkDesigner);
  result.push(...middleSlice);
  if (synthesizer) result.push(synthesizer);
  return result;
}
