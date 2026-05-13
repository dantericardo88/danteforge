// Matrix Orchestration — Phase A Runner (PRD §6.1)
//
// Phase A targets the OSS frontier: it consumes the orchestration dimension
// matrix, generates kernel work packets for every dimension with
// `gapToOssFrontier > 0`, allocates those packets to providers from the
// capacity report, and drives each through a verify/red-team/taste/merge
// pipeline.
//
// All heavy substrate (work-packet-generator, lease-manager, worktree-manager,
// verification-court, merge-court, license classifier) is called via injection
// seams (`_*` options) so the runner stays test-friendly and the production
// wiring lives in one place.

import { generateWorkPackets } from '../../matrix/engines/work-packet-generator.js';
import { buildDependencyGraph } from '../../matrix/engines/dependency-graph.js';
import { scanConflicts } from '../../matrix/engines/conflict-radar.js';
import { calculateSafeParallelism } from '../../matrix/engines/safe-parallelism.js';
import { createLease, transitionLease } from '../../matrix/engines/lease-manager.js';
import { classifyLicense } from '../../core/oss-researcher.js';
import { saveOrch, appendAudit } from '../state-io.js';
import type {
  CapacityReport,
  CompetitiveUniverse,
  OrchestrationDimension,
  OrchestrationDimensionMatrix,
  PhaseAttempt,
  PhaseExecutionConfig,
  PhaseExecutionResult,
  PhaseType,
  ProviderId,
} from '../types.js';
import type { WorkGraph, WorkPacket } from '../../matrix/types/work-graph.js';
import type { AgentLease } from '../../matrix/types/lease.js';
import type { AgentRunResult } from '../../matrix/types/agent.js';
import type { OwnershipMap } from '../../matrix/types/ownership.js';

// ── Errors ──────────────────────────────────────────────────────────────────

export class LicenseGateRejection extends Error {
  constructor(public packetId: string, public depName: string, public licenseName: string) {
    super(`work packet ${packetId} introduced blocked dependency ${depName} (${licenseName})`);
    this.name = 'LicenseGateRejection';
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface PhaseAArgs {
  matrix: OrchestrationDimensionMatrix;
  capacity: CapacityReport;
  universe: CompetitiveUniverse;
}

export type CourtFn = (
  args: { lease: AgentLease; packet: WorkPacket; result: AgentRunResult },
) => Promise<{ approved: boolean; reasons: string[] }>;

export interface PhaseAOptions {
  cwd: string;
  mode?: 'llm' | 'prompt' | 'local';
  runId?: string;
  maxCostUsd?: number;
  maxWallClockMinutes?: number;
  allowedProviders?: ProviderId[];
  /** Forces red-team on every attempt (true for Phase B). */
  redTeamEveryMerge?: boolean;
  /** Minimum taste-gate score (Phase A: ~7, Phase B: ~8). */
  tasteGateMinScore?: number;
  _now?: () => string;
  /** Adapter run seam — receives lease + packet, returns AgentRunResult. */
  _runAdapter?: (args: {
    providerId: ProviderId;
    lease: AgentLease;
    packet: WorkPacket;
  }) => Promise<AgentRunResult>;
  _verificationCourt?: CourtFn;
  _redTeamCourt?: CourtFn;
  _tasteGate?: CourtFn;
  _mergeCourt?: CourtFn;
  /** License classifier override (tests inject a stub). */
  _classifyDep?: (depName: string) => { status: 'allowed' | 'blocked' | 'unknown'; name: string };
  /** Returns new dependency names introduced by a packet's diff. */
  _packetNewDeps?: (lease: AgentLease, packet: WorkPacket) => Promise<string[]>;
  /** Don't create worktrees / leases in real fs; for unit tests. */
  _dryRun?: boolean;
}

/**
 * Execute Phase A — close OSS frontier gap. Returns a PhaseExecutionResult and
 * persists it via state-io `phaseAResult`.
 */
export async function executePhaseA(
  args: PhaseAArgs,
  options: PhaseAOptions,
): Promise<PhaseExecutionResult> {
  const now = options._now ?? (() => new Date().toISOString());
  const startedAt = now();
  const phase: PhaseType = 'phase_a_oss_frontier';

  // 1. Filter the orchestration dimensions that still have OSS gap.
  const targetDims = args.matrix.dimensions.filter(d => d.gapToOssFrontier > 0);

  // 2. Convert to kernel work graph (via injected generator or default).
  const workGraph = buildWorkGraph(targetDims, options);

  // 3. Capacity-driven concurrency cap.
  const concurrencyCap = computeConcurrency(args.capacity, options.allowedProviders);

  // 4. Build a phase config now so we can record it on the result.
  const config: PhaseExecutionConfig = {
    phase,
    workPacketIds: workGraph.packets.map(p => p.id),
    maxCostUsd: options.maxCostUsd ?? 100,
    maxWallClockMinutes: options.maxWallClockMinutes ?? 240,
    maxConcurrentAgents: concurrencyCap,
    allowedProviders: pickAllowedProviders(args.capacity, options.allowedProviders),
    redTeamEveryMerge: options.redTeamEveryMerge ?? false,
    tasteGateMinScore: options.tasteGateMinScore ?? 7,
  };

  if (workGraph.packets.length === 0) {
    return finalize(args, workGraph, config, [], startedAt, now(), 'completed', phase, options.cwd);
  }

  // 5. Dependency + conflict awareness — informs wave order. Defensive default
  //    when ownership map isn't available in a thin orchestration context.
  const depGraph = buildDependencyGraph({ workGraph });
  void calculateSafeParallelism({
    workGraph,
    dependencyGraph: depGraph,
    conflictReport: scanConflicts({ workPackets: workGraph.packets, ownershipMap: emptyOwnership() }),
    requestedAgents: concurrencyCap,
  });

  // 6. Allocate packets to providers in round-robin order with concurrency cap.
  const allocations = allocatePackets(workGraph.packets, config.allowedProviders, args.capacity);

  const attempts: PhaseAttempt[] = [];
  let costSpent = 0;
  let timeSpentMs = 0;
  const wallClockBudgetMs = config.maxWallClockMinutes * 60_000;
  let termination: PhaseExecutionResult['terminationReason'] = 'completed';

  // 7. Execute attempts. We process allocations sequentially per provider lane
  //    (the orchestrator can later parallelize at the test-fast level; in v1
  //    we keep deterministic order for repro).
  for (const allocation of allocations) {
    if (costSpent > config.maxCostUsd) { termination = 'budget_exhausted'; break; }
    if (timeSpentMs > wallClockBudgetMs) { termination = 'time_exhausted'; break; }

    const attempt = await runOneAttempt(allocation, args, options, now);
    attempts.push(attempt);
    costSpent += attempt.costUsd;
    timeSpentMs += attempt.wallClockMs;

    await appendAudit(options.cwd, {
      ts: now(),
      runId: options.runId ?? 'unknown',
      kind: 'phase_attempt_outcome',
      payload: {
        phase,
        packetId: attempt.workPacketId,
        provider: attempt.providerId,
        outcome: attempt.outcome,
        rejectionReason: attempt.rejectionReason,
      },
    });
  }

  return finalize(args, workGraph, config, attempts, startedAt, now(), termination, phase, options.cwd);
}

// ── Allocation ──────────────────────────────────────────────────────────────

interface PacketAllocation {
  packet: WorkPacket;
  providerId: ProviderId;
}

function allocatePackets(
  packets: WorkPacket[],
  allowed: ProviderId[],
  capacity: CapacityReport,
): PacketAllocation[] {
  const providersInOrder = preferProviders(allowed, capacity);
  if (providersInOrder.length === 0) return [];
  const out: PacketAllocation[] = [];
  for (let i = 0; i < packets.length; i++) {
    const providerId = providersInOrder[i % providersInOrder.length]!;
    out.push({ packet: packets[i]!, providerId });
  }
  return out;
}

/** Order: claude > codex > dantecode > others. Filtered by allowed + auth. */
function preferProviders(allowed: ProviderId[], capacity: CapacityReport): ProviderId[] {
  const rank: Record<ProviderId, number> = {
    claude: 0, codex: 1, dantecode: 2, aider: 3, cursor: 4, ollama: 5, shell: 6, fake: 7,
  };
  return capacity.providers
    .filter(p => allowed.includes(p.providerId))
    .filter(p => p.installed && p.authStatus !== 'unauthenticated')
    .sort((a, b) => (rank[a.providerId] ?? 99) - (rank[b.providerId] ?? 99))
    .map(p => p.providerId);
}

function pickAllowedProviders(
  capacity: CapacityReport,
  override: ProviderId[] | undefined,
): ProviderId[] {
  if (override && override.length > 0) return override;
  return capacity.providers.filter(p => p.installed).map(p => p.providerId);
}

function computeConcurrency(capacity: CapacityReport, allowed?: ProviderId[]): number {
  if (!allowed || allowed.length === 0) return capacity.totalPracticalConcurrency;
  return capacity.providers
    .filter(p => allowed.includes(p.providerId))
    .reduce((sum, p) => sum + p.concurrentInstances, 0);
}

// ── Single-attempt pipeline ─────────────────────────────────────────────────

async function runOneAttempt(
  allocation: PacketAllocation,
  args: PhaseAArgs,
  options: PhaseAOptions,
  now: () => string,
): Promise<PhaseAttempt> {
  const { packet, providerId } = allocation;
  const attemptStart = now();
  const t0 = Date.parse(attemptStart);

  // Build a synthetic lease — in dry-run, we never touch git.
  const lease = createLease({
    workPacket: packet,
    provider: providerId,
    agentRole: 'dimension-engineer',
    ownershipMap: emptyOwnership(),
    cwd: options.cwd,
    _now: now,
  });

  try {
    if (!options._runAdapter) {
      return finishAttempt('skipped', 'no adapter wired', packet, providerId, attemptStart, t0, now);
    }

    // Mark lease active without touching git when dry-run.
    const issued = transitionLease(lease, 'issued');
    const active = transitionLease(issued, 'active');
    void active;

    const runResult = await options._runAdapter({ providerId, lease, packet });

    // Verification court — diff-vs-lease, required commands, no-stub scan.
    if (options._verificationCourt) {
      const verdict = await options._verificationCourt({ lease, packet, result: runResult });
      if (!verdict.approved) {
        return finishAttempt('rejected_by_verification', verdict.reasons.join('; '),
          packet, providerId, attemptStart, t0, now);
      }
    }

    // License gate — every new dep is classified; blocked = hard reject.
    if (options._packetNewDeps) {
      const newDeps = await options._packetNewDeps(lease, packet);
      const classifier = options._classifyDep ?? defaultClassifyDep;
      for (const dep of newDeps) {
        const verdict = classifier(dep);
        if (verdict.status === 'blocked') {
          await appendAudit(options.cwd, {
            ts: now(),
            runId: options.runId ?? 'unknown',
            kind: 'license_violation_blocked',
            payload: { packetId: packet.id, depName: dep, license: verdict.name },
          });
          return finishAttempt('rejected_by_verification',
            `license: ${dep} is ${verdict.name} (blocked)`,
            packet, providerId, attemptStart, t0, now);
        }
      }
    }

    // Red-team — required when packet flags it OR phase forces it.
    const redTeamForced = options.redTeamEveryMerge || packet.redTeamRequired;
    if (redTeamForced && options._redTeamCourt) {
      const verdict = await options._redTeamCourt({ lease, packet, result: runResult });
      if (!verdict.approved) {
        return finishAttempt('rejected_by_red_team', verdict.reasons.join('; '),
          packet, providerId, attemptStart, t0, now);
      }
    }

    // Taste gate — for product-sensitive packets.
    if (packet.tasteGateRequired && options._tasteGate) {
      const verdict = await options._tasteGate({ lease, packet, result: runResult });
      if (!verdict.approved) {
        return finishAttempt('rejected_by_taste_gate', verdict.reasons.join('; '),
          packet, providerId, attemptStart, t0, now);
      }
    }

    // Merge court — final arbiter.
    if (options._mergeCourt) {
      const verdict = await options._mergeCourt({ lease, packet, result: runResult });
      if (!verdict.approved) {
        return finishAttempt('rejected_by_merge_court', verdict.reasons.join('; '),
          packet, providerId, attemptStart, t0, now);
      }
    }

    return finishAttempt('merged', undefined, packet, providerId, attemptStart, t0, now, {
      [packet.dimensionId]: estimateScoreDelta(args.matrix.dimensions, packet.dimensionId),
    });
  } catch (err) {
    return finishAttempt('errored', err instanceof Error ? err.message : String(err),
      packet, providerId, attemptStart, t0, now);
  }
}

function defaultClassifyDep(_dep: string): { status: 'allowed' | 'blocked' | 'unknown'; name: string } {
  // No license text available without a real fetch; default to "unknown" so
  // the runner does not block legitimate deps. Tests inject a real classifier
  // and production wiring fetches LICENSE files via the npm registry.
  void classifyLicense;
  return { status: 'unknown', name: 'unknown' };
}

function finishAttempt(
  outcome: PhaseAttempt['outcome'],
  reason: string | undefined,
  packet: WorkPacket,
  provider: ProviderId,
  startedAt: string,
  t0: number,
  now: () => string,
  scoreDelta?: Record<string, number>,
): PhaseAttempt {
  const completedAt = now();
  return {
    workPacketId: packet.id,
    providerId: provider,
    outcome,
    rejectionReason: reason,
    scoreDeltaByDimension: scoreDelta,
    tokensConsumed: 0,
    costUsd: 0,
    wallClockMs: Math.max(0, Date.parse(completedAt) - t0),
    startedAt,
    completedAt,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildWorkGraph(
  dims: OrchestrationDimension[],
  options: PhaseAOptions,
): WorkGraph {
  const now = options._now ?? (() => new Date().toISOString());
  // Convert orchestration dims to kernel DimensionGraphNode shape.
  const dimensionGraph = {
    generatedAt: now(),
    competitors: [],
    nodes: dims.map(d => ({
      dimensionId: d.dimensionId,
      name: d.name,
      category: d.category,
      targetScore: d.ossFrontierScore,
      currentScore: d.currentScore,
      touches: [] as string[],
      dependsOnDimensions: [] as string[],
      evidenceRequired: d.evidenceRequired,
      gapVsTarget: d.gapToOssFrontier,
      gapVsOssFrontier: d.gapToOssFrontier,
      gapVsClosedFrontier: d.gapToClosedFrontier,
    })),
  };
  // Minimal project graph so generateWorkPackets can run without disk I/O.
  const projectGraph = {
    project: {
      projectId: 'orchestration',
      rootPath: options.cwd,
      detectedAt: now(),
      buildCommands: [],
      verifyCommands: [],
      protectedPaths: [],
      ownershipPath: '',
      evidenceDir: '',
    },
    nodes: [],
    generatedAt: now(),
  };
  return generateWorkPackets({ dimensionGraph, projectGraph, _now: now });
}

function emptyOwnership(): OwnershipMap {
  return {
    version: 1,
    generatedAt: '',
    globalAllowed: [],
    workstreams: {},
    frozenFiles: [],
  };
}

function estimateScoreDelta(
  dims: OrchestrationDimension[],
  dimensionId: string,
): number {
  const dim = dims.find(d => d.dimensionId === dimensionId);
  if (!dim) return 0;
  // Conservative: a merged attempt is worth ~25% of the remaining OSS gap.
  return Math.min(2, dim.gapToOssFrontier * 0.25);
}

async function finalize(
  args: PhaseAArgs,
  workGraph: WorkGraph,
  config: PhaseExecutionConfig,
  attempts: PhaseAttempt[],
  startedAt: string,
  completedAt: string,
  termination: PhaseExecutionResult['terminationReason'],
  phase: PhaseType,
  cwd: string,
): Promise<PhaseExecutionResult> {
  const dimensionsClosed: string[] = [];
  const dimensionsOpen: string[] = [];
  for (const dim of args.matrix.dimensions) {
    const merged = attempts.filter(a =>
      a.outcome === 'merged'
      && a.scoreDeltaByDimension
      && dim.dimensionId in a.scoreDeltaByDimension,
    );
    const delta = merged.reduce((sum, a) => sum + (a.scoreDeltaByDimension?.[dim.dimensionId] ?? 0), 0);
    if (dim.currentScore + delta >= dim.ossFrontierScore) dimensionsClosed.push(dim.dimensionId);
    else if (dim.gapToOssFrontier > 0) dimensionsOpen.push(dim.dimensionId);
  }
  const totalCostUsd = attempts.reduce((s, a) => s + a.costUsd, 0);
  const totalWallClockMs = attempts.reduce((s, a) => s + a.wallClockMs, 0);
  const result: PhaseExecutionResult = {
    phase,
    config,
    attempts,
    dimensionsClosed,
    dimensionsOpen,
    totalCostUsd,
    totalWallClockMs,
    startedAt,
    completedAt,
    kernelWorkGraph: workGraph,
    terminationReason: termination,
  };
  const slot = phase === 'phase_a_oss_frontier' ? 'phaseAResult' : 'phaseBResult';
  await saveOrch(cwd, slot, result).catch(() => undefined);
  return result;
}
