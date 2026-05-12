// Matrix Kernel — Simulation Mode (Phase 7 of PRD)
//
// Plans a Matrix run without making any disk writes (except the simulation
// plan output). Composes all upstream engines (project graph, dimensions,
// work packets, dependency graph, conflict radar, safe parallelism) into a
// single dry-run pipeline.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectGraph } from '../types/project-graph.js';
import type { DimensionGraph } from '../types/dimension-graph.js';
import type { WorkGraph } from '../types/work-graph.js';
import type { DependencyGraph } from '../types/dependency-graph.js';
import type { ConflictReport } from '../types/conflict.js';
import type {
  SimulationPlan,
  SimulationWave,
  RiskSummary,
} from '../types/simulation.js';
import { calculateSafeParallelism, selectWaveMembers } from './safe-parallelism.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

export interface SimulateOptions {
  projectGraph: ProjectGraph;
  dimensionGraph: DimensionGraph;
  workGraph: WorkGraph;
  dependencyGraph: DependencyGraph;
  conflictReport: ConflictReport;
  requestedAgents: number;
  /** Average tokens per LOC for cost estimation (default: 30). */
  tokensPerLoc?: number;
  _now?: () => string;
}

export function simulate(options: SimulateOptions): SimulationPlan {
  const {
    projectGraph: _proj,
    dimensionGraph: _dim,
    workGraph,
    dependencyGraph,
    conflictReport,
    requestedAgents,
  } = options;
  void _proj; void _dim;
  const tokensPerLoc = options.tokensPerLoc ?? 30;
  const now = options._now ?? (() => new Date().toISOString());

  // 1. compute safe parallelism
  const safeParallelism = calculateSafeParallelism({
    workGraph,
    dependencyGraph,
    conflictReport,
    requestedAgents,
  });

  // 2. plan waves greedily
  const waves: SimulationWave[] = [];
  const remaining = new Map<string, number>();   // packetId → arbitrary order
  for (let i = 0; i < workGraph.packets.length; i++) remaining.set(workGraph.packets[i]!.id, i);

  let waveNumber = 1;
  let safetyCounter = 100;
  while (remaining.size > 0 && safetyCounter-- > 0) {
    const remainingDepGraph = filterDependencyGraph(dependencyGraph, remaining);
    const wave = selectWaveMembers(remainingDepGraph, conflictReport, safeParallelism.recommendedWaveSize || 1);
    if (wave.length === 0) {
      // No ready nodes — pick the topologically earliest blocked node to break the deadlock in simulation
      // (in real execution, the merge of an upstream packet would unblock).
      const fallback = Array.from(remaining.keys()).slice(0, 1);
      if (fallback.length === 0) break;
      wave.push(fallback[0]!);
    }

    const wavePackets = wave
      .map(id => workGraph.packets.find(p => p.id === id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);

    const estimatedLoc = wavePackets.reduce((sum, p) => sum + (p.estimatedLoc ?? 200), 0);
    const estimatedTokens = estimatedLoc * tokensPerLoc;
    const estimatedDurationMinutes = wavePackets.reduce(
      (sum, p) => Math.max(sum, p.estimatedMinutes ?? 30), 0,
    );

    waves.push({
      waveNumber,
      description: `Wave ${waveNumber}: ${wavePackets.length} parallel-safe work packets`,
      workPacketIds: wave,
      estimatedDurationMinutes,
      estimatedTokens,
      estimatedUsdLow: (estimatedTokens / 1_000_000) * 3,
      estimatedUsdHigh: (estimatedTokens / 1_000_000) * 15,
      rationale: buildWaveRationale(wavePackets),
    });

    for (const id of wave) remaining.delete(id);
    waveNumber++;
  }

  // 3. build risk summary
  const riskSummary = buildRiskSummary(workGraph, conflictReport);

  // 4. totals
  const totalEstimatedTokens = waves.reduce((sum, w) => sum + w.estimatedTokens, 0);

  return {
    generatedAt: now(),
    waves,
    safeParallelism,
    riskSummary,
    expectedReports: Object.values(MATRIX_REPORT_PATHS).filter(p => typeof p === 'string'),
    totalEstimatedTokens,
    totalEstimatedUsdLow: (totalEstimatedTokens / 1_000_000) * 3,
    totalEstimatedUsdHigh: (totalEstimatedTokens / 1_000_000) * 15,
  };
}

export async function writeSimulationPlan(
  plan: SimulationPlan,
  cwd?: string,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.simulationPlan);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(plan, null, 2), 'utf8');
  return outPath;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function filterDependencyGraph(
  graph: DependencyGraph,
  remaining: Map<string, number>,
): DependencyGraph {
  const nodes = graph.nodes
    .filter(n => remaining.has(n.workPacketId))
    .map(n => ({
      ...n,
      status: hasNoBlockers(n.blockedBy, remaining) ? 'READY' as const : n.status,
    }));
  return { generatedAt: graph.generatedAt, nodes, edges: graph.edges };
}

function hasNoBlockers(blockedBy: string[], remaining: Map<string, number>): boolean {
  return !blockedBy.some(id => remaining.has(id));
}

function buildWaveRationale(packets: import('../types/work-graph.js').WorkPacket[]): string[] {
  const reasons: string[] = [];
  if (packets.length === 0) return ['no packets'];
  const dims = new Set(packets.map(p => p.dimensionId));
  reasons.push(`Touches ${dims.size} dimension(s)`);
  const risks = new Set(packets.map(p => p.riskLevel));
  if (risks.has('critical')) reasons.push('Contains critical-risk packet');
  else if (risks.has('high')) reasons.push('Contains high-risk packet');
  const tasteCount = packets.filter(p => p.tasteGateRequired).length;
  if (tasteCount > 0) reasons.push(`${tasteCount} packet(s) require taste gate`);
  return reasons;
}

function buildRiskSummary(workGraph: WorkGraph, conflictReport: ConflictReport): RiskSummary {
  const allRiskyPaths = new Set<string>();
  for (const p of workGraph.packets) {
    if (p.riskLevel === 'high' || p.riskLevel === 'critical') {
      for (const path of p.paths.ownedPaths) allRiskyPaths.add(path);
    }
  }
  const requiredApprovals = workGraph.packets.filter(p => p.tasteGateRequired).length;
  return {
    highestRiskAreas: Array.from(allRiskyPaths).slice(0, 10),
    sequentialBottlenecks: [],
    predictedConflicts: conflictReport.conflicts.length,
    requiredHumanApprovals: requiredApprovals,
  };
}
