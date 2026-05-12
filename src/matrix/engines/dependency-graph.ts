// Matrix Kernel — Dependency Graph builder (Phase 4 of PRD)
//
// Analyzes a WorkGraph to determine: which packets can run NOW, which are
// blocked by dependencies, which conflict on owned paths, which require
// human decisions. Uses Kahn's topological-sort (same algorithm as
// agent-dag.ts:computeExecutionLevels but on WorkPacket IDs).
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkGraph, WorkPacket } from '../types/work-graph.js';
import type {
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
  DependencyStatus,
} from '../types/dependency-graph.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface BuildDependencyGraphOptions {
  workGraph: WorkGraph;
  /** When true, include 'soft' edges for read overlap. Default true. */
  includeSoftEdges?: boolean;
  _now?: () => string;
}

export function buildDependencyGraph(options: BuildDependencyGraphOptions): DependencyGraph {
  const { workGraph } = options;
  const includeSoft = options.includeSoftEdges ?? true;
  const now = options._now ?? (() => new Date().toISOString());

  const edges: DependencyEdge[] = [];
  const nodes: DependencyNode[] = [];

  // 1. explicit dependsOn edges (hard)
  for (const packet of workGraph.packets) {
    for (const depId of packet.dependsOn) {
      edges.push({
        fromPacketId: depId,
        toPacketId: packet.id,
        strength: 'hard',
        reason: 'explicit-depends-on',
      });
    }
  }

  // 2. inferred edges from shared owned paths
  for (const a of workGraph.packets) {
    for (const b of workGraph.packets) {
      if (a.id >= b.id) continue;
      const writeOverlap = pathOverlap(a.paths.ownedPaths, b.paths.ownedPaths);
      if (writeOverlap.length > 0) {
        edges.push({
          fromPacketId: a.id,
          toPacketId: b.id,
          strength: 'hard',
          reason: `shared write paths: ${writeOverlap.slice(0, 3).join(', ')}`,
        });
      } else if (includeSoft) {
        const readOverlap = pathOverlap(a.paths.ownedPaths, b.paths.readOnlyPaths);
        if (readOverlap.length > 0) {
          edges.push({
            fromPacketId: a.id,
            toPacketId: b.id,
            strength: 'soft',
            reason: `${a.id} writes paths that ${b.id} reads`,
          });
        }
      }
    }
  }

  // 3. compute status via Kahn's topological sort
  const order = topologicalLevels(workGraph.packets, edges);
  for (const packet of workGraph.packets) {
    nodes.push(classifyNode(packet, edges, order, workGraph));
  }

  return { generatedAt: now(), nodes, edges };
}

export async function writeDependencyGraph(graph: DependencyGraph, cwd?: string): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.dependencyGraph);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(graph, null, 2), 'utf8');
  return outPath;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pathOverlap(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter(p => setB.has(p));
}

/**
 * Kahn's algorithm — returns level number for each packet ID.
 * Level 0 = ready now, level N = blocked until all level-N-1 packets merge.
 * Soft edges do not block (so they're not counted for level computation).
 */
function topologicalLevels(packets: WorkPacket[], edges: DependencyEdge[]): Map<string, number> {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const p of packets) {
    inDegree.set(p.id, 0);
    adj.set(p.id, []);
  }
  for (const e of edges) {
    if (e.strength !== 'hard') continue;
    if (!inDegree.has(e.toPacketId) || !inDegree.has(e.fromPacketId)) continue;
    inDegree.set(e.toPacketId, (inDegree.get(e.toPacketId) ?? 0) + 1);
    adj.get(e.fromPacketId)!.push(e.toPacketId);
  }

  const level = new Map<string, number>();
  let frontier: string[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) frontier.push(id);
  let lvl = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      level.set(id, lvl);
      for (const child of adj.get(id) ?? []) {
        inDegree.set(child, (inDegree.get(child) ?? 0) - 1);
        if ((inDegree.get(child) ?? 0) === 0) next.push(child);
      }
    }
    frontier = next;
    lvl++;
  }

  // Any unset = cycle. Mark as level Infinity so they're flagged.
  for (const p of packets) if (!level.has(p.id)) level.set(p.id, Number.POSITIVE_INFINITY);
  return level;
}

function classifyNode(
  packet: WorkPacket,
  edges: DependencyEdge[],
  levels: Map<string, number>,
  workGraph: WorkGraph,
): DependencyNode {
  const myLevel = levels.get(packet.id) ?? 0;

  const incomingHard = edges
    .filter(e => e.toPacketId === packet.id && e.strength === 'hard')
    .map(e => e.fromPacketId);

  // Conflict detection: same write paths = cannot run together
  const cannotRunWith: string[] = [];
  for (const other of workGraph.packets) {
    if (other.id === packet.id) continue;
    if (pathOverlap(packet.paths.ownedPaths, other.paths.ownedPaths).length > 0) {
      cannotRunWith.push(other.id);
    }
  }

  // Parallel-safe = same level + no cannotRunWith
  const canRunInParallelWith: string[] = [];
  for (const other of workGraph.packets) {
    if (other.id === packet.id) continue;
    const sameLevel = levels.get(other.id) === myLevel;
    if (sameLevel && !cannotRunWith.includes(other.id)) {
      canRunInParallelWith.push(other.id);
    }
  }

  let status: DependencyStatus;
  if (myLevel === Number.POSITIVE_INFINITY) {
    status = 'NEEDS_HUMAN_DECISION';
  } else if (myLevel === 0 && cannotRunWith.length === 0) {
    status = 'READY';
  } else if (incomingHard.length > 0) {
    status = 'BLOCKED_BY_DEPENDENCY';
  } else if (cannotRunWith.length > 0) {
    status = 'CONFLICTING';
  } else {
    status = 'READY';
  }

  return {
    workPacketId: packet.id,
    status,
    blockedBy: incomingHard,
    canRunInParallelWith,
    cannotRunWith,
    mergeAfter: incomingHard,
    humanDecisionRequired: status === 'NEEDS_HUMAN_DECISION' ? 'cycle detected in dependency graph' : undefined,
  };
}
