/**
 * DAG scheduler for DanteForge parallel agent execution.
 *
 * Implements dependency-ordered parallel agent scheduling using a Directed
 * Acyclic Graph. Determines which agents can run in parallel and which must
 * wait for upstream dependencies to complete.
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { logger } from './logger.js';
import type { AgentRole } from './subagent-isolator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentNode {
  role: AgentRole;
  dependsOn: AgentRole[];
  priority: number;
}

export interface ExecutionLevel {
  level: number;
  agents: AgentRole[];
}

export interface DAGPlan {
  levels: ExecutionLevel[];
  estimatedParallelism: number;
  estimatedDurationMs: number;
  criticalPath: AgentRole[];
}

export interface DAGExecutionResult<T> {
  plan: DAGPlan;
  results: Map<AgentRole, T>;
  blockedAgents: AgentRole[];
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_LEVEL = 60_000;
const DAG_FILENAME = 'party-dag.yaml';

// ---------------------------------------------------------------------------
// buildDefaultDAG
// ---------------------------------------------------------------------------

/**
 * Returns the default 4-level DAG for the standard agent party.
 *
 * Level 0: pm (no deps)
 * Level 1: architect (depends on pm)
 * Level 2: dev, ux, design (depend on architect — run in parallel)
 * Level 3: scrum-master (depends on dev, ux, design)
 */
export function buildDefaultDAG(): AgentNode[] {
  return [
    { role: 'pm', dependsOn: [], priority: 0 },
    { role: 'architect', dependsOn: ['pm'], priority: 1 },
    { role: 'dev', dependsOn: ['architect'], priority: 2 },
    { role: 'ux', dependsOn: ['architect'], priority: 3 },
    { role: 'design', dependsOn: ['architect'], priority: 4 },
    { role: 'scrum-master', dependsOn: ['dev', 'ux', 'design'], priority: 5 },
  ];
}

// ---------------------------------------------------------------------------
// computeExecutionLevels — Kahn's algorithm
// ---------------------------------------------------------------------------

/**
 * Pure function. Topological sort via Kahn's algorithm.
 *
 * Groups nodes into execution levels where every dependency of each node in a
 * level has already been satisfied in a prior level. Throws if a cycle is
 * detected.
 */
export function computeExecutionLevels(nodes: AgentNode[]): DAGPlan {
  if (nodes.length === 0) {
    return {
      levels: [],
      estimatedParallelism: 0,
      estimatedDurationMs: 0,
      criticalPath: [],
    };
  }

  // Build adjacency and in-degree maps keyed by role.
  const nodeMap = new Map<AgentRole, AgentNode>();
  const inDegree = new Map<AgentRole, number>();
  const dependents = new Map<AgentRole, AgentRole[]>();

  for (const node of nodes) {
    nodeMap.set(node.role, node);
    inDegree.set(node.role, 0);
    dependents.set(node.role, []);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeMap.has(dep)) {
        // Dependency references a role not in the graph — skip silently
        // (it may have been filtered out).
        continue;
      }
      inDegree.set(node.role, (inDegree.get(node.role) ?? 0) + 1);
      dependents.get(dep)!.push(node.role);
    }
  }

  // Kahn's: peel off zero-in-degree nodes level by level.
  const levels: ExecutionLevel[] = [];
  let queue: AgentRole[] = [];

  for (const [role, deg] of inDegree) {
    if (deg === 0) queue.push(role);
  }

  let processed = 0;

  while (queue.length > 0) {
    // Sort current level by priority (lower = higher priority).
    queue.sort((a, b) => {
      const pa = nodeMap.get(a)!.priority;
      const pb = nodeMap.get(b)!.priority;
      return pa - pb;
    });

    levels.push({ level: levels.length, agents: [...queue] });
    processed += queue.length;

    const nextQueue: AgentRole[] = [];

    for (const role of queue) {
      for (const dep of dependents.get(role) ?? []) {
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) {
          nextQueue.push(dep);
        }
      }
    }

    queue = nextQueue;
  }

  if (processed !== nodes.length) {
    throw new Error(
      'Cycle detected in agent DAG — unable to compute execution levels',
    );
  }

  // Compute critical path (longest dependency chain).
  const criticalPath = computeCriticalPath(nodes, nodeMap, levels);

  const estimatedParallelism = Math.max(
    ...levels.map((l) => l.agents.length),
  );

  return {
    levels,
    estimatedParallelism,
    estimatedDurationMs: levels.length * MS_PER_LEVEL,
    criticalPath,
  };
}

// ---------------------------------------------------------------------------
// Critical path helper
// ---------------------------------------------------------------------------

/**
 * Finds the longest dependency chain through the DAG (critical path).
 *
 * Uses dynamic programming on the topologically sorted levels: for each node
 * the length of the longest path ending at that node is 1 + the max of its
 * dependencies' longest paths.
 */
function computeCriticalPath(
  _nodes: AgentNode[],
  nodeMap: Map<AgentRole, AgentNode>,
  levels: ExecutionLevel[],
): AgentRole[] {
  const dist = new Map<AgentRole, number>();
  const prev = new Map<AgentRole, AgentRole | null>();

  // Process nodes in topological order (level by level).
  for (const level of levels) {
    for (const role of level.agents) {
      const node = nodeMap.get(role)!;
      let bestDist = 0;
      let bestPrev: AgentRole | null = null;

      for (const dep of node.dependsOn) {
        if (!dist.has(dep)) continue; // filtered-out dependency
        const d = dist.get(dep)!;
        if (d > bestDist) {
          bestDist = d;
          bestPrev = dep;
        }
      }

      dist.set(role, bestDist + 1);
      prev.set(role, bestPrev);
    }
  }

  // Find the node with the longest path.
  let endRole: AgentRole | null = null;
  let maxDist = 0;

  for (const [role, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endRole = role;
    }
  }

  // Trace back to build the path.
  const chain: AgentRole[] = [];
  let cursor: AgentRole | null = endRole;
  while (cursor !== null) {
    chain.unshift(cursor);
    cursor = prev.get(cursor) ?? null;
  }

  return chain;
}

// ---------------------------------------------------------------------------
// loadCustomDAG
// ---------------------------------------------------------------------------

/**
 * Reads `.danteforge/party-dag.yaml` if it exists. Returns `null` when the
 * file is missing or cannot be parsed.
 */
export async function loadCustomDAG(cwd?: string): Promise<AgentNode[] | null> {
  const base = cwd ?? process.cwd();
  const dagPath = path.join(base, '.danteforge', DAG_FILENAME);

  try {
    const raw = await fs.readFile(dagPath, 'utf-8');
    const parsed = yaml.parse(raw);

    if (!Array.isArray(parsed)) {
      logger.warn(`Custom DAG at ${dagPath} is not an array — ignoring`);
      return null;
    }

    const nodes: AgentNode[] = [];
    for (const entry of parsed) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof entry.role !== 'string'
      ) {
        logger.warn('Skipping invalid node in custom DAG');
        continue;
      }

      nodes.push({
        role: entry.role as AgentRole,
        dependsOn: Array.isArray(entry.dependsOn)
          ? (entry.dependsOn as AgentRole[])
          : [],
        priority: typeof entry.priority === 'number' ? entry.priority : 99,
      });
    }

    logger.verbose(`Loaded custom DAG with ${nodes.length} nodes from ${dagPath}`);
    return nodes.length > 0 ? nodes : null;
  } catch {
    // File does not exist or cannot be read — that is fine.
    return null;
  }
}

// ---------------------------------------------------------------------------
// executeDAG
// ---------------------------------------------------------------------------

/**
 * Executes the DAG level by level.
 *
 * For each level the `executor` callback is called with the list of agents to
 * run in parallel. If any agent returns `null` or `undefined` in the result
 * map, all downstream agents (transitively) are marked as blocked.
 */
export async function executeDAG<T>(
  plan: DAGPlan,
  executor: (agents: AgentRole[]) => Promise<Map<AgentRole, T>>,
): Promise<DAGExecutionResult<T>> {
  const allResults = new Map<AgentRole, T>();
  const blockedSet = new Set<AgentRole>();
  const start = Date.now();

  // Pre-compute downstream sets so we can propagate blocks.
  const downstreamOf = buildDownstreamMap(plan);

  for (const level of plan.levels) {
    // Filter out agents that are already blocked.
    const eligible = level.agents.filter((r) => !blockedSet.has(r));

    if (eligible.length === 0) continue;

    const levelResults = await executor(eligible);

    for (const role of eligible) {
      const result = levelResults.get(role);
      if (result === null || result === undefined) {
        // Agent failed — block all downstream dependents.
        logger.warn(`Agent "${role}" failed — blocking downstream agents`);
        for (const downstream of downstreamOf.get(role) ?? []) {
          blockedSet.add(downstream);
        }
      } else {
        allResults.set(role, result);
      }
    }
  }

  return {
    plan,
    results: allResults,
    blockedAgents: [...blockedSet],
    totalDurationMs: Date.now() - start,
  };
}

/**
 * Builds a map from each agent role to the full set of transitively
 * downstream roles in the given plan.
 */
function buildDownstreamMap(plan: DAGPlan): Map<AgentRole, Set<AgentRole>> {
  // Collect all roles across levels and build a forward-edge adjacency list.
  const allRoles: AgentRole[] = [];
  const roleLevel = new Map<AgentRole, number>();

  for (const level of plan.levels) {
    for (const role of level.agents) {
      allRoles.push(role);
      roleLevel.set(role, level.level);
    }
  }

  // An agent B is a direct downstream of A if B appears in a later level and
  // B could only have gotten there because of a dependency chain that goes
  // through A. Since we don't have the original node edges here, we rebuild
  // from the plan ordering: every agent in level N+1 is downstream of every
  // agent in level N.  This is an over-approximation, but safe for blocking.
  //
  // For precise blocking we'd need the original AgentNode edges, but the
  // conservative approach (block everything downstream) is the correct
  // behaviour for a failing agent.
  const downstream = new Map<AgentRole, Set<AgentRole>>();

  for (const role of allRoles) {
    downstream.set(role, new Set());
  }

  // Walk levels in reverse to accumulate transitive downstream.
  for (let i = plan.levels.length - 2; i >= 0; i--) {
    const currentLevel = plan.levels[i];
    const nextLevel = plan.levels[i + 1];

    for (const role of currentLevel.agents) {
      for (const next of nextLevel.agents) {
        downstream.get(role)!.add(next);
        // Also add everything that is downstream of `next`.
        for (const transitive of downstream.get(next) ?? []) {
          downstream.get(role)!.add(transitive);
        }
      }
    }
  }

  return downstream;
}

// ---------------------------------------------------------------------------
// filterDAGToRoles
// ---------------------------------------------------------------------------

/**
 * Filters the DAG to only include the specified roles. Dependency references
 * to excluded roles are removed so the resulting sub-DAG remains valid.
 */
export function filterDAGToRoles(
  nodes: AgentNode[],
  activeRoles: AgentRole[],
): AgentNode[] {
  const activeSet = new Set(activeRoles);

  return nodes
    .filter((n) => activeSet.has(n.role))
    .map((n) => ({
      role: n.role,
      dependsOn: n.dependsOn.filter((d) => activeSet.has(d)),
      priority: n.priority,
    }));
}
