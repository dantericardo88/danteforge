/**
 * Magic-level skill orchestration mapping per PRD-MASTER §8.1.
 *
 * Each magic level declares which Dante-native skills it invokes, in what order,
 * and with what gating behavior. Existing magic-preset commands (spark/ember/...)
 * read this map at runtime when they decide whether to chain skill workflows.
 */

export type MagicLevel =
  | 'spark'
  | 'ember'
  | 'canvas'
  | 'magic'
  | 'blaze'
  | 'nova'
  | 'inferno'
  | 'ascend';

export type DanteSkill =
  | 'dante-to-prd'
  | 'dante-grill-me'
  | 'dante-tdd'
  | 'dante-triage-issue'
  | 'dante-design-an-interface';

export type GateBehavior =
  | 'skip'                  // skill can fire without three-way gate (spark/ember only)
  | 'human_checkpoint'      // skill emits, user reviews, then next skill fires
  | 'autopause_on_fail'     // autonomous, but pause for human review on gate fail
  | 'autopause_on_disagree' // autonomous, pause on irreducible debate disagreement
  | 'fail_closed'           // any gate failure halts the run
  | 'budget_envelope';      // gate behavior reduces to budget enforcement

export interface SkillStep {
  skill: DanteSkill;
  gate: GateBehavior;
  /** When true, the step runs in parallel with the next step rather than sequentially. */
  parallel?: boolean;
  /** Convergence loop: if dimension < threshold, re-run with dim-as-prompt. */
  convergeOnDimension?: { dimension: string; threshold: number };
}

export interface MagicLevelConfig {
  level: MagicLevel;
  /** Whether this level orchestrates skills at all. */
  orchestrates: boolean;
  /** Default workflow this level runs when orchestrating. */
  defaultWorkflow: SkillStep[];
  /** Maximum concurrent sub-agents during this level. PRD-MASTER §3 hardware ceiling. */
  maxParallelism: number;
  /** Whether this level requires a budget envelope before running. */
  budgetEnvelopeRequired: boolean;
  /** Whether this level performs OSS pattern mining on top of skill orchestration. */
  ossMiningEnabled: boolean;
  /** Description for the dashboard / dotrunner UI. */
  description: string;
}

export const MAGIC_LEVEL_MAP: Record<MagicLevel, MagicLevelConfig> = {
  spark: {
    level: 'spark',
    orchestrates: false,
    defaultWorkflow: [],
    maxParallelism: 1,
    budgetEnvelopeRequired: false,
    ossMiningEnabled: false,
    description: 'Single user-invoked actions. No skill orchestration.'
  },

  ember: {
    level: 'ember',
    orchestrates: false,
    defaultWorkflow: [
      { skill: 'dante-grill-me', gate: 'skip' }
    ],
    maxParallelism: 1,
    budgetEnvelopeRequired: false,
    ossMiningEnabled: false,
    description: 'Optional grill-me when spec is vague. No autonomous chaining.'
  },

  canvas: {
    level: 'canvas',
    orchestrates: true,
    defaultWorkflow: [
      { skill: 'dante-to-prd', gate: 'human_checkpoint' },
      { skill: 'dante-grill-me', gate: 'human_checkpoint' },
      { skill: 'dante-design-an-interface', gate: 'human_checkpoint' },
      { skill: 'dante-tdd', gate: 'human_checkpoint' }
    ],
    maxParallelism: 1,
    budgetEnvelopeRequired: false,
    ossMiningEnabled: false,
    description: 'Structured skill chain with a human checkpoint between every skill.'
  },

  magic: {
    level: 'magic',
    orchestrates: true,
    defaultWorkflow: [
      { skill: 'dante-to-prd', gate: 'autopause_on_fail' },
      { skill: 'dante-grill-me', gate: 'autopause_on_disagree' },
      { skill: 'dante-design-an-interface', gate: 'autopause_on_fail' },
      { skill: 'dante-tdd', gate: 'autopause_on_fail' }
    ],
    maxParallelism: 2,
    budgetEnvelopeRequired: false,
    ossMiningEnabled: false,
    description: 'Autonomous chaining. Pauses for human review on three-way-gate failure or unresolved debate disagreement.'
  },

  blaze: {
    level: 'blaze',
    orchestrates: true,
    defaultWorkflow: [
      { skill: 'dante-to-prd', gate: 'autopause_on_fail' },
      { skill: 'dante-design-an-interface', gate: 'autopause_on_fail', parallel: true },
      { skill: 'dante-tdd', gate: 'autopause_on_fail' }
    ],
    maxParallelism: 3,
    budgetEnvelopeRequired: true,
    ossMiningEnabled: false,
    description: 'Autonomous + parallel design exploration. design-an-interface spawns 3 sub-agents; synthesis chooses; tdd implements. Hardware ceiling 3.'
  },

  nova: {
    level: 'nova',
    orchestrates: true,
    defaultWorkflow: [
      { skill: 'dante-to-prd', gate: 'autopause_on_fail', convergeOnDimension: { dimension: 'specDrivenPipeline', threshold: 9.0 } },
      { skill: 'dante-grill-me', gate: 'autopause_on_disagree', convergeOnDimension: { dimension: 'planningQuality', threshold: 9.0 } },
      { skill: 'dante-design-an-interface', gate: 'autopause_on_fail', parallel: true, convergeOnDimension: { dimension: 'maintainability', threshold: 9.0 } },
      { skill: 'dante-tdd', gate: 'autopause_on_fail', convergeOnDimension: { dimension: 'testing', threshold: 9.0 } }
    ],
    maxParallelism: 3,
    budgetEnvelopeRequired: true,
    ossMiningEnabled: false,
    description: 'Autonomous + convergence loops. After each skill, harsh-scorer runs; under-threshold dimensions become re-run prompts.'
  },

  inferno: {
    level: 'inferno',
    orchestrates: true,
    defaultWorkflow: [
      { skill: 'dante-to-prd', gate: 'fail_closed', convergeOnDimension: { dimension: 'specDrivenPipeline', threshold: 9.0 } },
      { skill: 'dante-grill-me', gate: 'fail_closed', convergeOnDimension: { dimension: 'planningQuality', threshold: 9.0 } },
      { skill: 'dante-design-an-interface', gate: 'fail_closed', parallel: true, convergeOnDimension: { dimension: 'maintainability', threshold: 9.0 } },
      { skill: 'dante-tdd', gate: 'fail_closed', convergeOnDimension: { dimension: 'testing', threshold: 9.0 } },
      { skill: 'dante-triage-issue', gate: 'fail_closed' }
    ],
    maxParallelism: 3,
    budgetEnvelopeRequired: true,
    ossMiningEnabled: true,
    description: 'Maximum-power autonomous orchestration. Parallel exploration + convergence loops + OSS pattern mining. Budget envelope MANDATORY. Hardware ceiling 3.'
  },

  ascend: {
    level: 'ascend',
    orchestrates: true,
    defaultWorkflow: [],
    maxParallelism: 3,
    budgetEnvelopeRequired: true,
    ossMiningEnabled: false,
    description: 'Meta-level — picks the right magic level per task using truth-loop verdict logic. The default workflow is empty because it dispatches to other levels.'
  }
};

export function getLevelConfig(level: MagicLevel): MagicLevelConfig {
  return MAGIC_LEVEL_MAP[level];
}

export class HardwareCeilingError extends Error {
  constructor(level: MagicLevel, requested: number, ceiling: number) {
    super(`Magic level ${level} refused: requested parallelism ${requested} exceeds hardware ceiling ${ceiling}`);
    this.name = 'HardwareCeilingError';
  }
}

export function assertHardwareCeiling(level: MagicLevel, requestedParallelism: number): void {
  const config = MAGIC_LEVEL_MAP[level];
  if (requestedParallelism > config.maxParallelism) {
    throw new HardwareCeilingError(level, requestedParallelism, config.maxParallelism);
  }
}

export interface AscendDecision {
  recommendedLevel: MagicLevel;
  rationale: string;
}

/**
 * Ascend's level-selection logic. Given a task complexity proxy and the
 * available budget/hardware, pick the cheapest level that can plausibly succeed.
 */
export function ascendSelectLevel(input: {
  complexity: 'trivial' | 'small' | 'medium' | 'large' | 'huge';
  hasBudget: boolean;
  ossMiningWanted: boolean;
  parallelExplorationWanted: boolean;
}): AscendDecision {
  if (input.complexity === 'trivial') return { recommendedLevel: 'spark', rationale: 'trivial task — no orchestration needed' };
  if (input.complexity === 'small') return { recommendedLevel: 'ember', rationale: 'small task — optional grill-me only' };
  if (input.complexity === 'medium' && !input.parallelExplorationWanted) {
    return { recommendedLevel: input.hasBudget ? 'magic' : 'canvas', rationale: 'medium task — autonomous if budget, human-gated otherwise' };
  }
  if (input.parallelExplorationWanted && input.hasBudget && !input.ossMiningWanted) {
    return { recommendedLevel: 'blaze', rationale: 'parallel design exploration desired' };
  }
  if (input.complexity === 'large' && input.hasBudget) {
    return { recommendedLevel: 'nova', rationale: 'large task — convergence loops needed' };
  }
  if (input.complexity === 'huge' && input.hasBudget && input.ossMiningWanted) {
    return { recommendedLevel: 'inferno', rationale: 'huge task with OSS mining — maximum-power orchestration' };
  }
  if (!input.hasBudget) {
    return { recommendedLevel: 'canvas', rationale: 'no budget envelope — fall back to human-gated structured chain' };
  }
  return { recommendedLevel: 'magic', rationale: 'default — autonomous chain with autopause' };
}
