// Matrix Orchestration — Learning Loop (PRD §7 + §4.2)
//
// After every run, capture provider performance, recurring conflicts, and
// harvest source quality into a persistent LearningState. v1 ships the WRITE
// side fully; the READ-back is stubbed — the orchestrator can call
// `loadLearningState` but does not yet feed it into allocation. v1.1 will
// plug `loadLearningState` into the allocator in phase-a-runner.ts.

import { saveOrch, loadOrch } from '../state-io.js';
import type {
  FinalReportSummary,
  LearningState,
  PhaseExecutionResult,
  ProviderId,
  InterPhaseRetrospective,
} from '../types.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface CapturePostRunArgs {
  finalReport: FinalReportSummary;
  phaseResults: PhaseExecutionResult[];
  retrospective?: InterPhaseRetrospective | null;
  /** Harvest sources collected from third-party-notices. */
  harvestedSources?: { repoUrl: string; patternsExtracted: number; scoreLift?: number }[];
  /** Harvest sources that produced low-value patterns. */
  failedHarvestSources?: { repoUrl: string; reason: string }[];
}

export interface CapturePostRunOptions {
  cwd: string;
  _now?: () => string;
  /** Reset cumulative state instead of merging. */
  reset?: boolean;
}

/**
 * Merge this run's results into the cumulative LearningState and persist.
 * Returns the resulting state.
 */
export async function capturePostRunLearning(
  args: CapturePostRunArgs,
  options: CapturePostRunOptions,
): Promise<LearningState> {
  const now = options._now ?? (() => new Date().toISOString());

  const previous = options.reset
    ? null
    : await loadOrch<LearningState>(options.cwd, 'learningState');
  const base = previous ?? emptyLearningState(now());

  const next: LearningState = {
    version: 1,
    updatedAt: now(),
    providerPerformance: mergeProviderPerformance(base.providerPerformance, args),
    recurringConflicts: mergeRecurringConflicts(base.recurringConflicts, args.retrospective ?? null),
    successfulHarvestSources: mergeSuccessfulHarvests(base.successfulHarvestSources, args),
    failedHarvestSources: mergeFailedHarvests(base.failedHarvestSources, args),
    costEstimates: mergeCostEstimates(base.costEstimates, args),
  };

  await saveOrch(options.cwd, 'learningState', next);
  return next;
}

/**
 * Load the cumulative LearningState. Returns null when no prior run has
 * persisted state. v1 read-back stub: caller may consult this for telemetry,
 * but the orchestrator's allocation logic does NOT yet condition on it. v1.1
 * will wire `successfulHarvestSources` into the harvest queue, and
 * `providerPerformance.excelsAt` into the allocator's tie-breaker.
 */
export async function loadLearningState(cwd: string): Promise<LearningState | null> {
  return loadOrch<LearningState>(cwd, 'learningState');
}

// ── Merge helpers ───────────────────────────────────────────────────────────

function emptyLearningState(updatedAt: string): LearningState {
  return {
    version: 1,
    updatedAt,
    providerPerformance: {} as LearningState['providerPerformance'],
    recurringConflicts: [],
    successfulHarvestSources: [],
    failedHarvestSources: [],
    costEstimates: {},
  };
}

function mergeProviderPerformance(
  prev: LearningState['providerPerformance'],
  args: CapturePostRunArgs,
): LearningState['providerPerformance'] {
  const result: LearningState['providerPerformance'] = { ...prev };
  const notes = args.retrospective?.providerPerformance ?? [];
  for (const note of notes) {
    const prior = result[note.providerId] ?? {
      runs: 0,
      totalAttempts: 0,
      totalSuccesses: 0,
      avgCostUsd: 0,
      avgWallClockMs: 0,
      excelsAt: [] as string[],
    };
    const totalAttempts = prior.totalAttempts + note.attempts;
    const totalSuccesses = prior.totalSuccesses + Math.round(note.attempts * note.successRate);
    const excelsAt = mergeUnique(prior.excelsAt, note.bestAtDimensions);
    result[note.providerId] = {
      runs: prior.runs + 1,
      totalAttempts,
      totalSuccesses,
      avgCostUsd: weightedAvg(prior.avgCostUsd, prior.totalAttempts, note.avgCostUsd, note.attempts),
      avgWallClockMs: weightedAvg(prior.avgWallClockMs, prior.totalAttempts, note.avgWallClockMs, note.attempts),
      excelsAt,
    };
  }
  // Backfill providers we observed in phase results but the retro didn't note.
  const seen = new Set(Object.keys(result));
  for (const phase of args.phaseResults) {
    for (const attempt of phase.attempts) {
      if (seen.has(attempt.providerId)) continue;
      result[attempt.providerId] = {
        runs: 1,
        totalAttempts: 1,
        totalSuccesses: attempt.outcome === 'merged' ? 1 : 0,
        avgCostUsd: attempt.costUsd,
        avgWallClockMs: attempt.wallClockMs,
        excelsAt: [],
      };
      seen.add(attempt.providerId);
    }
  }
  return result;
}

function mergeRecurringConflicts(
  prev: LearningState['recurringConflicts'],
  retro: InterPhaseRetrospective | null,
): LearningState['recurringConflicts'] {
  if (!retro) return prev;
  const map = new Map<string, LearningState['recurringConflicts'][number]>();
  for (const item of prev) map.set(`${item.dimensionA}|${item.dimensionB}`, { ...item });
  for (const pattern of retro.recurringConflictPatterns) {
    const key = pattern;
    const existing = map.get(key);
    if (existing) existing.occurrences++;
    else map.set(key, { dimensionA: pattern, dimensionB: '', occurrences: 1 });
  }
  return [...map.values()];
}

function mergeSuccessfulHarvests(
  prev: LearningState['successfulHarvestSources'],
  args: CapturePostRunArgs,
): LearningState['successfulHarvestSources'] {
  const map = new Map<string, LearningState['successfulHarvestSources'][number]>();
  for (const item of prev) map.set(item.repoUrl, { ...item });
  for (const item of args.harvestedSources ?? []) {
    const existing = map.get(item.repoUrl);
    if (existing) {
      existing.patternsExtracted += item.patternsExtracted;
      const newLift = item.scoreLift ?? 0;
      existing.averageScoreLift = (existing.averageScoreLift + newLift) / 2;
    } else {
      map.set(item.repoUrl, {
        repoUrl: item.repoUrl,
        patternsExtracted: item.patternsExtracted,
        averageScoreLift: item.scoreLift ?? 0,
      });
    }
  }
  return [...map.values()];
}

function mergeFailedHarvests(
  prev: LearningState['failedHarvestSources'],
  args: CapturePostRunArgs,
): LearningState['failedHarvestSources'] {
  const map = new Map<string, LearningState['failedHarvestSources'][number]>();
  for (const item of prev) map.set(item.repoUrl, { ...item });
  for (const item of args.failedHarvestSources ?? []) {
    if (!map.has(item.repoUrl)) map.set(item.repoUrl, item);
  }
  return [...map.values()];
}

function mergeCostEstimates(
  prev: LearningState['costEstimates'],
  args: CapturePostRunArgs,
): LearningState['costEstimates'] {
  const out = { ...prev };
  for (const phase of args.phaseResults) {
    for (const attempt of phase.attempts) {
      if (attempt.outcome !== 'merged') continue;
      // Track avg USD per dimension category (dim id is the bucket here).
      const dims = Object.keys(attempt.scoreDeltaByDimension ?? {});
      for (const dim of dims) {
        const existing = out[dim] ?? { avgCostUsd: 0, sampleSize: 0 };
        const newAvg = ((existing.avgCostUsd * existing.sampleSize) + attempt.costUsd)
                     / (existing.sampleSize + 1);
        out[dim] = { avgCostUsd: newAvg, sampleSize: existing.sampleSize + 1 };
      }
    }
  }
  return out;
}

// ── tiny utils ──────────────────────────────────────────────────────────────

function mergeUnique(a: string[], b: string[]): string[] {
  const set = new Set(a);
  for (const item of b) set.add(item);
  return [...set];
}

function weightedAvg(a: number, wa: number, b: number, wb: number): number {
  if (wa + wb === 0) return 0;
  return ((a * wa) + (b * wb)) / (wa + wb);
}

/** Re-export for callers that need the type without a dual import. */
export type { ProviderId, LearningState };
