// Matrix Kernel — Safe Parallelism Calculator (Phase 7 of PRD)
//
// Translates "I want N agents" into "we can safely run M agents now."
// Inputs the WorkGraph, DependencyGraph, ConflictReport. Outputs the
// recommended wave size with human-readable reasoning.
import type { WorkGraph, WorkPacket } from '../types/work-graph.js';
import type { DependencyGraph, DependencyNode } from '../types/dependency-graph.js';
import type { ConflictReport, ConflictRecord } from '../types/conflict.js';
import type { SafeParallelismResult } from '../types/simulation.js';
import { isBlockingConflict } from './conflict-radar.js';

export interface CalculateSafeParallelismOptions {
  workGraph: WorkGraph;
  dependencyGraph: DependencyGraph;
  conflictReport: ConflictReport;
  requestedAgents: number;
}

export function calculateSafeParallelism(
  options: CalculateSafeParallelismOptions,
): SafeParallelismResult {
  const { workGraph, dependencyGraph, conflictReport, requestedAgents } = options;
  const reasoning: string[] = [];

  // 1. Identify ready packets (status: READY).
  const ready = dependencyGraph.nodes.filter(n => n.status === 'READY');
  const blocked = dependencyGraph.nodes.filter(n => n.status === 'BLOCKED_BY_DEPENDENCY');
  const conflicting = dependencyGraph.nodes.filter(n => n.status === 'CONFLICTING');
  const sequential = dependencyGraph.nodes.filter(n =>
    n.cannotRunWith.length > 0 && n.canRunInParallelWith.length === 0,
  );

  // 2. Subtract packets that genuinely cannot run.
  //    A conflict only blocks a packet entirely when it's a SINGLE-packet
  //    violation (protected_path_violation, ownership_violation, or any HIGH/
  //    CRITICAL conflict whose recommendedAction is 'block_immediately').
  //    MULTI-packet conflicts (file_overlap, path_overlap, etc.) are
  //    co-scheduling constraints — they require packets to run in different
  //    waves but do not block them from running at all. The wave planner
  //    already handles wave assignment; safety must not double-count.
  const blockedByConflict = new Set<string>();
  let coSchedulingConstraints = 0;
  for (const conflict of conflictReport.conflicts) {
    if (!isBlockingConflict(conflict)) continue;
    const ids = conflict.workPacketIds ?? [];
    const isHardBlock =
      ids.length === 1 ||
      conflict.recommendedAction === 'block_immediately' ||
      conflict.type === 'protected_path_violation' ||
      conflict.type === 'ownership_violation';
    if (isHardBlock) {
      for (const id of ids) blockedByConflict.add(id);
    } else {
      coSchedulingConstraints += 1;
    }
  }
  const highConflictCount = blockedByConflict.size;

  const runnable = ready.filter(n => !blockedByConflict.has(n.workPacketId));

  // 3. Cap recommended wave size at min(runnable, requestedAgents).
  const recommendedWaveSize = Math.min(runnable.length, requestedAgents);
  const safeAgentsNow = recommendedWaveSize;

  // 4. Build reasoning string.
  if (blocked.length > 0) {
    reasoning.push(`${blocked.length} work packet(s) blocked by dependencies — wait for upstream merges`);
  }
  if (highConflictCount > 0) {
    reasoning.push(`${highConflictCount} work packet(s) blocked by protected-path/ownership violations`);
  }
  if (coSchedulingConstraints > 0) {
    reasoning.push(`${coSchedulingConstraints} pair(s) of packets cannot run together — sequenced across waves`);
  }
  if (conflicting.length > 0) {
    reasoning.push(`${conflicting.length} work packet(s) flagged as CONFLICTING — must sequence`);
  }
  if (sequential.length > 0) {
    reasoning.push(`${sequential.length} work packet(s) are SEQUENTIAL_ONLY (cannot run in parallel)`);
  }
  if (requestedAgents > recommendedWaveSize) {
    reasoning.push(`Requested ${requestedAgents} agents but only ${recommendedWaveSize} are safe — capped`);
  }
  if (workGraph.packets.length === 0) {
    reasoning.push('No work packets to run');
  }
  if (reasoning.length === 0) {
    reasoning.push('All packets ready; no blockers detected');
  }

  return {
    requestedAgents,
    safeAgentsNow,
    recommendedWaveSize,
    blockedWorkPackets: blocked.length,
    highConflictPackets: highConflictCount,
    sequentialOnlyPackets: sequential.length,
    reasoning,
  };
}

/**
 * Convenience: get the actual list of packet IDs that should run in the
 * recommended wave (not just the count).
 */
export function selectWaveMembers(
  dependencyGraph: DependencyGraph,
  conflictReport: ConflictReport,
  capacity: number,
): string[] {
  // Same hard-block discrimination as calculateSafeParallelism: only single-
  // packet violations (or block_immediately recommendations) prevent a packet
  // from being selected at all. Multi-packet conflicts are sequencing
  // constraints handled by the wave planner.
  const blockedByConflict = new Set<string>();
  for (const c of conflictReport.conflicts) {
    if (!isBlockingConflict(c)) continue;
    const ids = c.workPacketIds ?? [];
    const isHardBlock =
      ids.length === 1 ||
      c.recommendedAction === 'block_immediately' ||
      c.type === 'protected_path_violation' ||
      c.type === 'ownership_violation';
    if (isHardBlock) {
      for (const id of ids) blockedByConflict.add(id);
    }
  }
  const ready = dependencyGraph.nodes
    .filter(n => n.status === 'READY' && !blockedByConflict.has(n.workPacketId))
    .sort((a, b) => packetSortKey(a) - packetSortKey(b));
  return ready.slice(0, capacity).map(n => n.workPacketId);
}

function packetSortKey(node: DependencyNode): number {
  // Prefer packets with FEWER cannotRunWith entries (less contentious go first)
  return node.cannotRunWith.length;
}

/** Helper for tests + simulation: filter conflicts that touch a packet ID. */
export function conflictsTouchingPacket(
  conflictReport: ConflictReport,
  packetId: string,
): ConflictRecord[] {
  return conflictReport.conflicts.filter(c => c.workPacketIds?.includes(packetId));
}

void packetSortKey;
void conflictsTouchingPacket;
// Reserved exports for downstream wave-planner extension
export {};
function _internal_unused_packet_ref(_p: WorkPacket): void { void _p; }
void _internal_unused_packet_ref;
