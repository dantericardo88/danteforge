// Matrix Orchestration — Inter-phase retrospective + Phase B planner (PRD §6.3)
//
// Between Phase A and Phase B (when target === 'closed_source_frontier'), the
// orchestrator computes provider performance, identifies recurring conflict
// patterns, and decides whether to proceed, pause, or stop.

import { saveOrch } from '../state-io.js';
import type {
  CapacityReport,
  InterPhaseRetrospective,
  OrchestrationDimensionMatrix,
  PhaseAttempt,
  PhaseExecutionConfig,
  PhaseExecutionResult,
  ProviderId,
  ProviderPerformanceNote,
} from '../types.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface InterPhaseOptions {
  cwd: string;
  _now?: () => string;
  /** Threshold for "remaining gap warrants Phase B"; default 0.5. */
  remainingGapThreshold?: number;
}

export async function generateInterPhaseRetrospective(
  phaseAResult: PhaseExecutionResult,
  matrix: OrchestrationDimensionMatrix,
  options: InterPhaseOptions,
): Promise<InterPhaseRetrospective> {
  const now = options._now ?? (() => new Date().toISOString());
  const threshold = options.remainingGapThreshold ?? 0.5;

  const providerPerformance = computeProviderPerformance(phaseAResult.attempts);
  const recurringConflictPatterns = computeRecurringConflicts(phaseAResult.attempts);
  const remainingGap = computeRemainingClosedGap(matrix, phaseAResult);

  const recommendation = decideRecommendation(phaseAResult, remainingGap, threshold);

  const retro: InterPhaseRetrospective = {
    generatedAt: now(),
    phaseAResult,
    providerPerformance,
    recurringConflictPatterns,
    remainingGapToClosedSourceFrontier: remainingGap,
    recommendation: recommendation.choice,
    recommendationReason: recommendation.reason,
  };

  await saveOrch(options.cwd, 'phaseARetrospective', retro);
  return retro;
}

export interface PlanPhaseBArgs {
  retrospective: InterPhaseRetrospective;
  matrix: OrchestrationDimensionMatrix;
  capacity: CapacityReport;
}

export interface PlanPhaseBOptions {
  cwd: string;
  _now?: () => string;
  maxCostUsd?: number;
  maxWallClockMinutes?: number;
}

/**
 * Build a PhaseExecutionConfig for Phase B. Phase B forces redTeamEveryMerge
 * and a stricter taste-gate threshold (>=8) per PRD §6.2. Provider mix favors
 * providers that performed well in Phase A.
 */
export async function planPhaseB(
  args: PlanPhaseBArgs,
  options: PlanPhaseBOptions,
): Promise<PhaseExecutionConfig> {
  const ranked = [...args.retrospective.providerPerformance]
    .sort((a, b) => b.successRate - a.successRate);

  // Prefer high success rate AND providers that excel at inferential work.
  // Heuristic: Codex + Claude > DanteCode for closed-source inference.
  const preferred: ProviderId[] = [];
  for (const note of ranked) {
    if (preferred.includes(note.providerId)) continue;
    preferred.push(note.providerId);
  }
  const claudePos = preferred.indexOf('claude');
  const codexPos = preferred.indexOf('codex');
  if (claudePos === -1) preferred.unshift('claude');
  if (codexPos === -1) preferred.splice(1, 0, 'codex');

  const closedGapPackets = args.matrix.dimensions
    .filter(d => d.gapToClosedFrontier > 0)
    .map(d => `work.${d.dimensionId}.phase-b`);

  const cap = args.capacity.totalPracticalConcurrency || 1;

  const config: PhaseExecutionConfig = {
    phase: 'phase_b_closed_source_frontier',
    workPacketIds: closedGapPackets,
    maxCostUsd: options.maxCostUsd ?? 100,
    maxWallClockMinutes: options.maxWallClockMinutes ?? 240,
    maxConcurrentAgents: cap,
    allowedProviders: preferred.filter(p => args.capacity.providers.some(c => c.providerId === p)),
    redTeamEveryMerge: true,
    tasteGateMinScore: 8,
  };

  await saveOrch(options.cwd, 'phaseBPlan', config);
  return config;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeProviderPerformance(attempts: PhaseAttempt[]): ProviderPerformanceNote[] {
  const groups = new Map<ProviderId, PhaseAttempt[]>();
  for (const a of attempts) {
    const arr = groups.get(a.providerId) ?? [];
    arr.push(a);
    groups.set(a.providerId, arr);
  }

  const result: ProviderPerformanceNote[] = [];
  for (const [providerId, group] of groups) {
    const successes = group.filter(g => g.outcome === 'merged').length;
    const successRate = group.length > 0 ? successes / group.length : 0;
    const avgCostUsd = group.reduce((s, g) => s + g.costUsd, 0) / Math.max(1, group.length);
    const avgWallClockMs = group.reduce((s, g) => s + g.wallClockMs, 0) / Math.max(1, group.length);

    const dimScores = aggregateDimensionScores(group);
    const sorted = [...dimScores.entries()].sort((a, b) => b[1] - a[1]);
    const bestAtDimensions = sorted.slice(0, 3).filter(([, v]) => v > 0).map(([k]) => k);
    const worstAtDimensions = sorted
      .slice()
      .reverse()
      .slice(0, 3)
      .filter(([, v]) => v < 0)
      .map(([k]) => k);

    result.push({
      providerId,
      attempts: group.length,
      successRate,
      avgCostUsd,
      avgWallClockMs,
      bestAtDimensions,
      worstAtDimensions,
    });
  }
  return result;
}

function aggregateDimensionScores(group: PhaseAttempt[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of group) {
    if (!a.scoreDeltaByDimension) continue;
    for (const [dim, delta] of Object.entries(a.scoreDeltaByDimension)) {
      out.set(dim, (out.get(dim) ?? 0) + delta);
    }
  }
  return out;
}

function computeRecurringConflicts(attempts: PhaseAttempt[]): string[] {
  // Paths that show up in rejectionReason multiple times are flagged as
  // recurring conflict patterns.
  const counts = new Map<string, number>();
  for (const a of attempts) {
    if (!a.rejectionReason) continue;
    // Extract path-like tokens (anything with a slash or .ts/.md/.json).
    const matches = a.rejectionReason.match(/[\w/.-]+\.(ts|md|json|tsx|js)/g) ?? [];
    for (const m of matches) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([path, count]) => `${path} (${count} rejections)`);
}

function computeRemainingClosedGap(
  matrix: OrchestrationDimensionMatrix,
  phaseAResult: PhaseExecutionResult,
): number {
  // Sum the closed-frontier gaps for dimensions Phase A did NOT close.
  const closedSet = new Set(phaseAResult.dimensionsClosed);
  let gap = 0;
  for (const dim of matrix.dimensions) {
    if (closedSet.has(dim.dimensionId)) continue;
    gap += Math.max(0, dim.gapToClosedFrontier);
  }
  return gap;
}

function decideRecommendation(
  phaseAResult: PhaseExecutionResult,
  remainingGap: number,
  threshold: number,
): { choice: InterPhaseRetrospective['recommendation']; reason: string } {
  if (phaseAResult.terminationReason === 'budget_exhausted') {
    return {
      choice: 'pause_for_user_input',
      reason: 'Phase A exhausted cost budget — confirm before spending more on Phase B',
    };
  }
  if (phaseAResult.terminationReason === 'time_exhausted') {
    return {
      choice: 'pause_for_user_input',
      reason: 'Phase A exhausted wall-clock budget — review Phase A output before continuing',
    };
  }
  if (phaseAResult.terminationReason === 'red_team_meltdown') {
    return {
      choice: 'stop',
      reason: 'Phase A hit a red-team meltdown — halt and review',
    };
  }
  if (phaseAResult.terminationReason === 'user_cancelled') {
    return { choice: 'stop', reason: 'User cancelled Phase A' };
  }
  if (remainingGap <= threshold) {
    return {
      choice: 'stop',
      reason: `Remaining closed-source frontier gap (${remainingGap.toFixed(2)}) below threshold (${threshold})`,
    };
  }
  return {
    choice: 'proceed_to_phase_b',
    reason: `Remaining gap ${remainingGap.toFixed(2)} > ${threshold}; Phase A completed cleanly`,
  };
}
