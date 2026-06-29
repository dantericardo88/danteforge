// scaffolder.ts — the inference-time two-stage Ornith loop: (1) SCAFFOLD pass — propose a refined scaffold
// from the task type's prior best; (2) reward feedback — fold the executor's MEASURED Layer-3 delta back into
// the scaffold's stats so the best orchestration wins over time. No gradient RL; the "training signal" is the
// same measured reward best-of-N already produces.
//
// Ornith's three reward-hacking defenses are enforced here, reusing what DanteForge already has:
//   1. Immutable trust boundary — the promoted candidate already passed candidate-prefilter's forbidden-path
//      gate; sanitizeReward re-checks (defense in depth) and ZEROES reward for any score-surface touch.
//   2. Deterministic monitor — sanitizeReward is that monitor: a banned-path diff earns zero, never a win.
//   3. Frozen judge veto — applyReward accepts a `vetoed` flag from the adversarial court; a veto zeroes the
//      reward so a candidate the judge rejects can never improve a scaffold's standing.

import {
  type Scaffold, type ScaffoldStep, newScaffold, recordReward,
} from './scaffold-types.js';
import { bestScaffold, saveScaffold } from './scaffold-library.js';
import { touchesTrustSurface } from './candidate-prefilter.js';

export interface ScaffoldProposal {
  plan: ScaffoldStep[];
  verificationSteps?: string[];
  rolePrompts?: Record<string, string>;
}

/** Injected LLM seam: given the task and the prior best scaffold (or null), propose a refined orchestration. */
export type ProposeFn = (taskType: string, prior: Scaffold | null) => Promise<ScaffoldProposal>;

/**
 * SCAFFOLD pass. Load the task type's current best, ask `propose` for a refinement, and return a new version
 * (parent-linked). Pure given a pure `propose`. Does NOT persist — reward is recorded after the executor runs.
 */
export async function proposeScaffold(
  taskType: string, propose: ProposeFn, cwd: string, nowIso: string,
): Promise<Scaffold> {
  const prior = await bestScaffold(taskType, cwd);
  const proposal = await propose(taskType, prior);
  if (!prior) {
    return newScaffold(taskType, proposal.plan, nowIso, {
      verificationSteps: proposal.verificationSteps, rolePrompts: proposal.rolePrompts,
    });
  }
  const version = prior.version + 1;
  return {
    id: `${taskType}@${version}`,
    taskType,
    version,
    plan: proposal.plan,
    verificationSteps: proposal.verificationSteps ?? prior.verificationSteps,
    rolePrompts: proposal.rolePrompts ?? prior.rolePrompts,
    rewardStats: { runs: 0, totalReward: 0, meanReward: 0, bestReward: 0, lastReward: 0, lastRunAt: null },
    parentVersion: prior.version,
    createdAt: nowIso,
  };
}

/**
 * The deterministic reward monitor (defenses #1 & #2). A reward earned by a diff that touched the score/trust
 * surface, or that a frozen judge vetoed, is ZEROED — it can never improve a scaffold's standing. PURE.
 */
export function sanitizeReward(
  reward: number, candidateFiles: string[], vetoed = false,
): { reward: number; zeroedReason: string | null } {
  const offending = touchesTrustSurface(candidateFiles);
  if (offending.length > 0) return { reward: 0, zeroedReason: `touched trust surface: ${offending.join(', ')}` };
  if (vetoed) return { reward: 0, zeroedReason: 'frozen-judge veto' };
  return { reward, zeroedReason: null };
}

export interface ApplyRewardOptions {
  /** Files the promoted candidate changed — checked by the deterministic monitor. */
  candidateFiles?: string[];
  /** The frozen adversarial judge vetoed this candidate (defense #3). */
  vetoed?: boolean;
}

/**
 * Reward feedback pass. Sanitize the measured reward (defenses #1–#3), fold it into the scaffold's stats, and
 * persist. Returns the updated scaffold and whether the reward was zeroed. The reward MUST be a measured
 * Layer-3 delta — soft scores cannot reach here (best-of-N's reward is measured-only by type).
 */
export async function applyReward(
  scaffold: Scaffold, measuredReward: number, cwd: string, nowIso: string, opts: ApplyRewardOptions = {},
): Promise<{ scaffold: Scaffold; zeroedReason: string | null }> {
  const { reward, zeroedReason } = sanitizeReward(measuredReward, opts.candidateFiles ?? [], opts.vetoed);
  const updated: Scaffold = { ...scaffold, rewardStats: recordReward(scaffold.rewardStats, reward, nowIso) };
  await saveScaffold(updated, cwd);
  return { scaffold: updated, zeroedReason };
}

/** Map a scaffold to best-of-N executor parameters: one candidate per planned adapter step (≥1). */
export function scaffoldToExecutor(scaffold: Scaffold): { n: number; sources: string[] } {
  const sources = scaffold.plan.map((s) => s.adapter);
  return { n: Math.max(1, sources.length), sources };
}
