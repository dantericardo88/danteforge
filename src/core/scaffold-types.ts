// scaffold-types.ts — the inference-time analog of Ornith-1.0's learned scaffolds. Ornith trains a model to
// author its own per-task ORCHESTRATION (memory, tools, error-handling, verification) and refines it by reward.
// We can't retrain, so a "scaffold" here is a versioned, reusable orchestration object for a TASK TYPE: which
// adapters run in what order, what gets verified, what role prompts steer each step — plus the running REWARD
// stats that say how well past versions actually did (measured, never self-reported).
//
// The two-stage Ornith loop becomes: (1) a scaffolder pass proposes a refined scaffold from the prior best;
// (2) the executor (best-of-N) runs parameterized by it; the Layer-3 MEASURED delta becomes the scaffold's
// reward. Reward flows to the scaffold — made concrete, with no gradient RL.

export interface ScaffoldStep {
  /** Which adapter/council member runs this step (codex/claude/grok/…). */
  adapter: string;
  /** What the step does, in one line (the orchestration instruction). */
  action: string;
  /** Optional verification command/check run after the step. */
  verify?: string;
}

export interface ScaffoldRewardStats {
  runs: number;
  totalReward: number;
  meanReward: number;
  bestReward: number;
  lastReward: number;
  lastRunAt: string | null;
}

export interface Scaffold {
  id: string;
  /** The class of task this scaffold orchestrates (e.g. "wire-callsite", "author-capability-test"). */
  taskType: string;
  version: number;
  /** The adapter/tool sequence — the heart of the orchestration. */
  plan: ScaffoldStep[];
  /** Verification steps the executor must pass (Layer-2 legality inputs). */
  verificationSteps: string[];
  /** Per-step or per-role steering prompts. */
  rolePrompts: Record<string, string>;
  rewardStats: ScaffoldRewardStats;
  /** The version this was refined FROM (provenance of the improvement chain). */
  parentVersion?: number;
  createdAt: string;
}

export function emptyRewardStats(): ScaffoldRewardStats {
  return { runs: 0, totalReward: 0, meanReward: 0, bestReward: 0, lastReward: 0, lastRunAt: null };
}

/** PURE: fold one measured reward into the running stats. The mean is the signal the library ranks by. */
export function recordReward(stats: ScaffoldRewardStats, reward: number, nowIso: string): ScaffoldRewardStats {
  const runs = stats.runs + 1;
  const totalReward = stats.totalReward + reward;
  return {
    runs,
    totalReward,
    meanReward: totalReward / runs,
    bestReward: Math.max(stats.bestReward, reward),
    lastReward: reward,
    lastRunAt: nowIso,
  };
}

/** A fresh v1 scaffold for a task type. */
export function newScaffold(
  taskType: string,
  plan: ScaffoldStep[],
  nowIso: string,
  extras: Partial<Pick<Scaffold, 'verificationSteps' | 'rolePrompts'>> = {},
): Scaffold {
  return {
    id: `${taskType}@1`,
    taskType,
    version: 1,
    plan,
    verificationSteps: extras.verificationSteps ?? [],
    rolePrompts: extras.rolePrompts ?? {},
    rewardStats: emptyRewardStats(),
    createdAt: nowIso,
  };
}
