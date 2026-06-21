// obstacle-decomposition.ts — the operator doctrine made STRUCTURAL: "there is always a solution; break a
// big problem into many small solvable ones; every obstacle is a sub-problem, never a wall."
//
// obstacle-registry.ts already DIAGNOSEs an obstacle, proposes >=3 solutions, and executes the safe ones.
// What was missing — and why decomposition was a slogan, not DNA (council, 2026-06-21) — is the RULE binding
// the unsolved case: a SolveResult that did not solve may NOT terminate as a bare "ceiling". It must either
//   (1) DECOMPOSE into >= minChildren named child sub-problems (each a smaller, DEFINED problem that becomes
//       the next work), or
//   (2) ESCALATE explicitly (consensus / human).
// A bare "we can't" is a WallError — the structural refusal of a wall. This is the "no walls" invariant made
// mechanical, and `solveProblemTree` is the recursion it enables: keep breaking each unsolved node smaller
// until every leaf is solved, escalated, or bounded — bounded so decomposition can never spam (the council's
// anti-runaway caveat: one failure path, a per-run node cap, real DEFINED children only).

import type { SolveResult, Obstacle, SolveAttempt } from './obstacle-registry.js';

/** A smaller, precisely-defined sub-problem of a parent obstacle — the "break it down" unit. */
export interface ChildObstacle {
  kind: string;
  /** The smaller problem, stated observably (a DEFINED problem is a solvable one). */
  signal: string;
  /** Why this is a genuine sub-problem of the parent (guards against decomposition-as-noise). */
  rationale: string;
  context?: Record<string, unknown>;
}

export type Escalation = { to: 'consensus' | 'human'; reason: string };

export interface DecompositionReceipt {
  parent: Obstacle;
  /** The unsolved signal/ceiling reason being decomposed. */
  signal: string;
  /** The >=3 solutions the registry already attempted — carried as evidence (never discarded). */
  attempted: SolveAttempt[];
  resolution:
    | { kind: 'solved' }
    | { kind: 'decomposed'; children: ChildObstacle[] }
    | { kind: 'escalated'; escalation: Escalation };
}

/** Thrown when a loop tries to terminate an unsolved obstacle as a bare ceiling — neither decomposed nor
 *  escalated. A wall is not an allowed terminal state; catching this is how "no walls" is enforced. */
export class WallError extends Error {
  constructor(message: string) { super(message); this.name = 'WallError'; }
}

export interface DecomposeOptions {
  /** Break an unsolved obstacle into smaller DEFINED sub-problems (the heart of the doctrine). */
  proposeChildren?: (result: SolveResult) => ChildObstacle[] | Promise<ChildObstacle[]>;
  /** Or escalate explicitly when decomposition is genuinely exhausted (consensus/human owns the next step). */
  escalate?: (result: SolveResult) => Escalation | null | Promise<Escalation | null>;
  /** Minimum children for a real decomposition (clamped to >=2 — one child is a rename, not a break-down). */
  minChildren?: number;
}

/**
 * Enforce the no-walls invariant on one SolveResult. solved → a 'solved' receipt. UNSOLVED → it MUST
 * decompose into >= minChildren child sub-problems OR escalate; otherwise WallError. Fail-closed by design:
 * the absence of a decomposition is an ERROR, not a quiet stop. Pure given pure option callbacks.
 */
export async function decomposeOrEscalate(result: SolveResult, opts: DecomposeOptions = {}): Promise<DecompositionReceipt> {
  const base = { parent: result.obstacle, signal: result.ceiling ?? result.obstacle.signal, attempted: result.attempted };
  if (result.solved) return { ...base, resolution: { kind: 'solved' } };

  const minChildren = Math.max(2, opts.minChildren ?? 2);
  const children = opts.proposeChildren ? await opts.proposeChildren(result) : [];
  if (children.length >= minChildren) {
    return { ...base, resolution: { kind: 'decomposed', children } };
  }
  const escalation = opts.escalate ? await opts.escalate(result) : null;
  if (escalation) return { ...base, resolution: { kind: 'escalated', escalation } };

  throw new WallError(
    `no-walls invariant: obstacle "${result.obstacle.kind}" is unsolved but produced neither >=${minChildren} ` +
    `child sub-problems nor an escalation. A wall is not a terminal state — break it smaller or escalate. ` +
    `(${result.ceiling ?? 'no ceiling reason given'})`,
  );
}

export interface ProblemTreeNode {
  obstacle: Obstacle;
  receipt: DecompositionReceipt;
  children: ProblemTreeNode[];
}

export interface SolveTreeOptions extends DecomposeOptions {
  /** Solve one obstacle (inject obstacle-registry's solveObstacle, or a test double). */
  solve: (o: Obstacle) => Promise<SolveResult>;
  /** Per-run cap on total nodes — the anti-spam guard (decomposition must converge, not breed). Default 32. */
  maxNodes?: number;
  /** Max recursion depth before a node escalates instead of decomposing further. Default 4. */
  maxDepth?: number;
}

export interface ProblemTreeSummary {
  root: ProblemTreeNode;
  nodes: number;
  solvedLeaves: number;
  escalatedLeaves: number;
  /** True when every leaf is solved (the whole problem was broken down and resolved). */
  fullyResolved: boolean;
}

/**
 * Break a big problem into many small ones, recursively. Solve the root; if unsolved, decompose into children
 * and recurse each. Bounded by maxNodes (total) and maxDepth (then a node escalates rather than spawning more)
 * so the tree always converges. Returns the tree + a summary. The literal embodiment of the doctrine: no node
 * is ever a wall — it is solved, escalated, or broken into smaller solved/escalated nodes.
 */
export async function solveProblemTree(root: Obstacle, opts: SolveTreeOptions): Promise<ProblemTreeSummary> {
  const maxNodes = Math.max(1, opts.maxNodes ?? 32);
  const maxDepth = Math.max(0, opts.maxDepth ?? 4);
  const counters = { nodes: 0, solved: 0, escalated: 0 };

  async function visit(o: Obstacle, depth: number): Promise<ProblemTreeNode> {
    counters.nodes++;
    const result = await opts.solve(o);
    // At the depth/node bound, an unsolved node ESCALATES instead of decomposing further (forced convergence).
    // Crucially we withhold proposeChildren here, else decomposeOrEscalate would keep breaking it down.
    const atBound = depth >= maxDepth || counters.nodes >= maxNodes;
    const receipt = atBound && !result.solved
      ? await decomposeOrEscalate(result, {
          escalate: async (r) => (await opts.escalate?.(r)) ?? { to: 'human' as const, reason: `bound reached (depth ${depth}/${maxDepth}, nodes ${counters.nodes}/${maxNodes})` },
        })
      : await decomposeOrEscalate(result, opts);

    if (receipt.resolution.kind === 'solved') { counters.solved++; return { obstacle: o, receipt, children: [] }; }
    if (receipt.resolution.kind === 'escalated') { counters.escalated++; return { obstacle: o, receipt, children: [] }; }

    const children: ProblemTreeNode[] = [];
    for (const child of receipt.resolution.children) {
      if (counters.nodes >= maxNodes) break; // hard stop — convergence over completeness
      children.push(await visit({ kind: child.kind, signal: child.signal, context: child.context }, depth + 1));
    }
    return { obstacle: o, receipt, children };
  }

  const rootNode = await visit(root, 0);
  return {
    root: rootNode,
    nodes: counters.nodes,
    solvedLeaves: counters.solved,
    escalatedLeaves: counters.escalated,
    fullyResolved: counters.escalated === 0 && countUnresolved(rootNode) === 0,
  };
}

/** Count leaves that are neither solved nor escalated (should be 0 — fail-closed means none exist). */
function countUnresolved(node: ProblemTreeNode): number {
  if (node.children.length === 0) {
    return node.receipt.resolution.kind === 'solved' || node.receipt.resolution.kind === 'escalated' ? 0 : 1;
  }
  return node.children.reduce((s, c) => s + countUnresolved(c), 0);
}
