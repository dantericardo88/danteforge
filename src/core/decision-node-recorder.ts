/**
 * decision-node-recorder.ts
 *
 * Lightweight recorder that drops into any CLI command with minimal friction.
 * All public functions are best-effort: they catch all errors internally and
 * never let recording break the calling command.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createDecisionNode,
  createDecisionNodeStore,
  type DecisionNode,
} from './decision-node.js';

// ---------------------------------------------------------------------------
// Session singleton
// ---------------------------------------------------------------------------

export interface RecorderSession {
  sessionId: string;
  /** Always 'main' for live runs; a branch UUID for counterfactual replays */
  timelineId: string;
  product: DecisionNode['actor']['product'];
  storePath: string;
}

let _session: RecorderSession | null = null;

/**
 * Get or create the current session.
 * Lazy-init: safe to call multiple times in one CLI invocation.
 * The same session object is reused for the lifetime of the process.
 */
export function getSession(cwd?: string): RecorderSession {
  if (_session) return _session;

  const root = cwd ?? process.cwd();
  let sessionId: string = process.env.DANTEFORGE_DECISION_SESSION_ID ?? randomUUID();

  // Best-effort: try to read sessionId from STATE.yaml so nodes can be
  // correlated with the existing project state.
  try {
    const stateFile = path.join(root, '.danteforge', 'STATE.yaml');
    const raw = readFileSync(stateFile, 'utf-8');
    const match = raw.match(/^sessionId:\s*['"]?([a-f0-9-]{36})['"]?/m);
    if (!process.env.DANTEFORGE_DECISION_SESSION_ID && match?.[1]) sessionId = match[1];
  } catch {
    // STATE.yaml absent or unreadable — use generated UUID
  }

  _session = {
    sessionId,
    timelineId: process.env.DANTEFORGE_DECISION_TIMELINE_ID ?? 'main',
    product: 'danteforge',
    storePath: process.env.DANTEFORGE_DECISION_STORE ?? path.join(root, '.danteforge', 'decision-nodes.jsonl'),
  };

  return _session;
}

/** Reset the singleton (used in tests). */
export function _resetSession(): void {
  _session = null;
}

// ---------------------------------------------------------------------------
// Record a decision
// ---------------------------------------------------------------------------

/**
 * Record a decision node.
 *
 * Returns the created node so callers can use it as a parent for subsequent
 * nodes (e.g. a start-node whose id becomes the parentNodeId of an end-node).
 *
 * Always resolves — never rejects.  On internal error it returns a safe
 * fallback node so that callers can still access `.id` without crashing.
 */
export async function recordDecision(params: {
  session: RecorderSession;
  parentNodeId?: string;
  actorType: 'human' | 'agent';
  prompt: string;
  context?: Record<string, unknown>;
  result: unknown;
  success: boolean;
  costUsd?: number;
  latencyMs?: number;
  qualityScore?: number;
  /** git commit SHA recorded when files changed as a result of this node */
  fileStateRef?: string;
}): Promise<DecisionNode> {
  try {
    // Ensure the store directory exists
    const storeDir = path.dirname(params.session.storePath);
    await mkdir(storeDir, { recursive: true });

    // Build a minimal synthetic "parent" so we can wire prevHash without
    // loading the entire chain.
    let parentNode: DecisionNode | null = null;
    const parentNodeId = params.parentNodeId ?? process.env.DANTEFORGE_DECISION_PARENT_ID;
    if (parentNodeId) {
      try {
        const store = createDecisionNodeStore(params.session.storePath);
        parentNode = (await store.getById(parentNodeId)) ?? null;
        await store.close();
      } catch {
        // Parent lookup is best-effort; missing parent just means prevHash = null
      }
    }

    const node = createDecisionNode({
      parentNode,
      sessionId: params.session.sessionId,
      timelineId: params.session.timelineId,
      actor: {
        type: params.actorType,
        id: 'danteforge-cli',
        product: params.session.product,
      },
      input: {
        prompt: params.prompt,
        ...(params.context !== undefined ? { context: params.context } : {}),
      },
      output: {
        result: params.result,
        success: params.success,
        costUsd: params.costUsd ?? 0,
        latencyMs: params.latencyMs ?? 0,
        ...(params.qualityScore !== undefined ? { qualityScore: params.qualityScore } : {}),
        ...(params.fileStateRef !== undefined ? { fileStateRef: params.fileStateRef } : {}),
      },
    });

    const store = createDecisionNodeStore(params.session.storePath);
    await store.append(node);
    await store.close();

    return node;
  } catch {
    // Fallback node — callers can safely read .id without crashing
    return {
      id: randomUUID(),
      parentId: params.parentNodeId ?? process.env.DANTEFORGE_DECISION_PARENT_ID ?? null,
      sessionId: params.session.sessionId,
      timelineId: params.session.timelineId,
      timestamp: new Date().toISOString(),
      actor: { type: params.actorType, id: 'danteforge-cli', product: params.session.product },
      input: { prompt: params.prompt },
      output: {
        result: params.result,
        success: params.success,
        costUsd: params.costUsd ?? 0,
        latencyMs: params.latencyMs ?? 0,
      },
      hash: '',
      prevHash: null,
    };
  }
}

// ---------------------------------------------------------------------------
// withCommandNode — HOF for command-level timeline nodes
// ---------------------------------------------------------------------------

/**
 * Wraps an async command with start→completion DecisionNode recording.
 * Records a start node (result='in-progress', success=false) before fn().
 * Records a completion (or failure) node after fn() with parentNodeId linking
 * back to the start. All recording is best-effort — never throws, never blocks.
 */
export async function withCommandNode<T>(opts: {
  cwd?: string;
  command: string;
  goal?: string;
  context?: Record<string, unknown>;
  fn: () => Promise<T>;
  toResult?: (t: T) => { result: unknown; success: boolean; qualityScore?: number };
}): Promise<T> {
  const session = getSession(opts.cwd);
  const t0 = Date.now();
  const prompt = opts.goal ?? `${opts.command}: invoked`;
  const ctx: Record<string, unknown> = { command: opts.command, ...(opts.context ?? {}) };

  const startNode = await recordDecision({
    session,
    actorType: 'agent',
    prompt,
    context: ctx,
    result: 'in-progress',
    success: false,
  });

  let value: T;
  try {
    value = await opts.fn();
  } catch (err) {
    await recordDecision({
      session,
      parentNodeId: startNode.id,
      actorType: 'agent',
      prompt,
      context: ctx,
      result: `error: ${err instanceof Error ? err.message : String(err)}`,
      success: false,
      latencyMs: Date.now() - t0,
    }).catch(() => { /* best-effort */ });
    throw err;
  }

  let result: unknown = 'completed';
  let success = true;
  let qualityScore: number | undefined;

  if (opts.toResult) {
    try {
      const extracted = opts.toResult(value);
      result = extracted.result;
      success = extracted.success;
      qualityScore = extracted.qualityScore;
    } catch { /* best-effort extraction */ }
  }

  await recordDecision({
    session,
    parentNodeId: startNode.id,
    actorType: 'agent',
    prompt,
    context: ctx,
    result,
    success,
    latencyMs: Date.now() - t0,
    ...(qualityScore !== undefined ? { qualityScore } : {}),
  }).catch(() => { /* best-effort */ });

  return value;
}

// ---------------------------------------------------------------------------
// recordCheckpoint — explicit provenance anchor for time-machine commits
// ---------------------------------------------------------------------------

/**
 * Record a "checkpoint" decision node that anchors a time-machine commit to
 * the current agent activity chain.
 *
 * re_gent pattern: every meaningful agent activity that mutated files should
 * emit a checkpoint receipt so the chain-of-custody verifier can prove the
 * file state at that moment. The checkpoint links three artifacts:
 *
 *  - the agent's activity (actor + prompt)
 *  - the file state at that moment (fileStateRef = time-machine commit id)
 *  - the evidence anchor (evidenceRef = cross-ecosystem hash, optional)
 *
 * Returns the recorded node. Best-effort: never throws.
 */
export async function recordCheckpoint(params: {
  cwd?: string;
  actorType: 'human' | 'agent';
  command: string;
  goal: string;
  fileStateRef: string;
  evidenceRef?: string;
  parentNodeId?: string;
  qualityScore?: number;
  context?: Record<string, unknown>;
}): Promise<DecisionNode> {
  const session = getSession(params.cwd);
  return recordDecision({
    session,
    ...(params.parentNodeId ? { parentNodeId: params.parentNodeId } : {}),
    actorType: params.actorType,
    prompt: `${params.command}: ${params.goal}`,
    context: {
      command: params.command,
      checkpoint: true,
      ...(params.context ?? {}),
    },
    result: { checkpoint: 'recorded', fileStateRef: params.fileStateRef },
    success: true,
    fileStateRef: params.fileStateRef,
    ...(params.qualityScore !== undefined ? { qualityScore: params.qualityScore } : {}),
  });
}

/**
 * Resolve a previously-recorded checkpoint by walking back through the
 * agent activity chain. Useful for "what was the file state at the last
 * verified point?" queries before counterfactual replay or rollback.
 *
 * Returns the most recent (by timestamp) checkpoint decision node, or
 * undefined when none exists in the requested session.
 */
export async function findLatestCheckpoint(params: {
  cwd?: string;
  sessionId?: string;
}): Promise<DecisionNode | undefined> {
  try {
    const session = getSession(params.cwd);
    const targetSessionId = params.sessionId ?? session.sessionId;
    const { createDecisionNodeStore } = await import('./decision-node.js');
    const store = createDecisionNodeStore(session.storePath);
    try {
      const sessionNodes = await store.getBySession(targetSessionId);
      // Filter to nodes with fileStateRef (i.e. checkpoints) and pick the latest.
      const checkpoints = sessionNodes.filter(
        n => typeof n.output.fileStateRef === 'string' && n.output.fileStateRef.length > 0,
      );
      if (checkpoints.length === 0) return undefined;
      checkpoints.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return checkpoints[0]!;
    } finally {
      await store.close();
    }
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// withAgentRunNode — HOF for agent role execution within party/multi-agent runs
// ---------------------------------------------------------------------------

/**
 * Wraps an agent role execution with start→completion DecisionNode recording.
 *
 * Unlike `withCommandNode` (which is designed for CLI-level commands and uses
 * the actor.id `'danteforge-cli'`), `withAgentRunNode` sets the actor.id to
 * the agent role name so provenance queries can filter per-agent activity
 * using `store.getByActor(role)`. This is the re_gent pattern for multi-agent
 * orchestration: every agent in a party/swarm gets its own provenance lane.
 *
 * All recording is best-effort — never throws, never blocks the agent run.
 */
export async function withAgentRunNode<T>(opts: {
  cwd?: string;
  /** The agent role id (e.g. 'pm', 'architect', 'dev', 'ux') */
  role: string;
  goal?: string;
  context?: Record<string, unknown>;
  fn: () => Promise<T>;
  toResult?: (t: T) => { result: unknown; success: boolean; qualityScore?: number; fileStateRef?: string };
}): Promise<T> {
  const session = getSession(opts.cwd);
  const t0 = Date.now();
  const prompt = opts.goal ?? `${opts.role}: agent run`;
  const ctx: Record<string, unknown> = { role: opts.role, ...(opts.context ?? {}) };

  // Record start node with actor.id = role for per-agent provenance filtering
  let startNodeId: string | undefined;
  try {
    const { createDecisionNodeStore, createDecisionNode } = await import('./decision-node.js');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(session.storePath), { recursive: true });
    const startNode = createDecisionNode({
      parentNode: null,
      sessionId: session.sessionId,
      timelineId: session.timelineId,
      actor: { type: 'agent', id: opts.role, product: session.product },
      input: { prompt, context: ctx },
      output: { result: 'in-progress', success: false, costUsd: 0, latencyMs: 0 },
    });
    const store = createDecisionNodeStore(session.storePath);
    await store.append(startNode);
    await store.close();
    startNodeId = startNode.id;
  } catch { /* best-effort */ }

  let value: T;
  try {
    value = await opts.fn();
  } catch (err) {
    // Record failure node
    try {
      const { createDecisionNodeStore, createDecisionNode } = await import('./decision-node.js');
      let parentNode: DecisionNode | null = null;
      if (startNodeId) {
        const store = createDecisionNodeStore(session.storePath);
        parentNode = (await store.getById(startNodeId)) ?? null;
        await store.close();
      }
      const failNode = createDecisionNode({
        parentNode,
        sessionId: session.sessionId,
        timelineId: session.timelineId,
        actor: { type: 'agent', id: opts.role, product: session.product },
        input: { prompt, context: ctx },
        output: {
          result: `error: ${err instanceof Error ? err.message : String(err)}`,
          success: false,
          costUsd: 0,
          latencyMs: Date.now() - t0,
        },
      });
      const store = createDecisionNodeStore(session.storePath);
      await store.append(failNode);
      await store.close();
    } catch { /* best-effort */ }
    throw err;
  }

  // Record completion node
  try {
    const { createDecisionNodeStore, createDecisionNode } = await import('./decision-node.js');
    let parentNode: DecisionNode | null = null;
    if (startNodeId) {
      const store = createDecisionNodeStore(session.storePath);
      parentNode = (await store.getById(startNodeId)) ?? null;
      await store.close();
    }

    let result: unknown = 'completed';
    let success = true;
    let qualityScore: number | undefined;
    let fileStateRef: string | undefined;

    if (opts.toResult) {
      try {
        const extracted = opts.toResult(value);
        result = extracted.result;
        success = extracted.success;
        qualityScore = extracted.qualityScore;
        fileStateRef = extracted.fileStateRef;
      } catch { /* best-effort extraction */ }
    }

    const endNode = createDecisionNode({
      parentNode,
      sessionId: session.sessionId,
      timelineId: session.timelineId,
      actor: { type: 'agent', id: opts.role, product: session.product },
      input: { prompt, context: ctx },
      output: {
        result,
        success,
        costUsd: 0,
        latencyMs: Date.now() - t0,
        ...(qualityScore !== undefined ? { qualityScore } : {}),
        ...(fileStateRef !== undefined ? { fileStateRef } : {}),
      },
    });
    const store = createDecisionNodeStore(session.storePath);
    await store.append(endNode);
    await store.close();
  } catch { /* best-effort */ }

  return value;
}

// ---------------------------------------------------------------------------
// exportProvenanceGraph — serialize the full provenance graph to a portable format
// ---------------------------------------------------------------------------

export interface ProvenanceGraphExport {
  schemaVersion: 'danteforge.provenance-graph.v1';
  exportedAt: string;
  sessionId?: string;
  /** All nodes in the export, in chronological order. */
  nodes: DecisionNode[];
  /** Adjacency edges: parentId → child id (forward-traversal index). */
  edges: Array<{ from: string; to: string }>;
  /** Summary metadata. */
  summary: {
    totalNodes: number;
    uniqueActors: string[];
    timelines: string[];
    sessions: string[];
    dateRange: { earliest: string; latest: string } | null;
  };
}

/**
 * Export the full provenance graph from a DecisionNodeStore as a portable,
 * structured object suitable for JSON serialization, war-room display, or
 * external audit tools.
 *
 * Filter options (compose with AND):
 *  - `sessionId` — only export nodes in that session
 *  - `actorId`   — only export nodes by that actor
 *
 * All I/O is read-only on the store. Best-effort: returns an empty export
 * when the store is unavailable.
 */
export async function exportProvenanceGraph(
  cwd?: string,
  filter?: { sessionId?: string; actorId?: string },
): Promise<ProvenanceGraphExport> {
  const session = getSession(cwd);
  const emptyExport = (): ProvenanceGraphExport => ({
    schemaVersion: 'danteforge.provenance-graph.v1',
    exportedAt: new Date().toISOString(),
    ...(filter?.sessionId ? { sessionId: filter.sessionId } : {}),
    nodes: [],
    edges: [],
    summary: { totalNodes: 0, uniqueActors: [], timelines: [], sessions: [], dateRange: null },
  });

  try {
    const { createDecisionNodeStore } = await import('./decision-node.js');
    const store = createDecisionNodeStore(session.storePath);
    try {
      let nodes: DecisionNode[];
      if (filter?.sessionId) {
        nodes = await store.getBySession(filter.sessionId);
      } else if (filter?.actorId) {
        nodes = await store.getByActor(filter.actorId);
      } else {
        // Collect all nodes via timeline scan
        const mainTimeline = await store.getByTimeline('main');
        const seenSessions = new Set(mainTimeline.map(n => n.sessionId));
        const allById = new Map<string, DecisionNode>(mainTimeline.map(n => [n.id, n]));
        for (const sessionId of seenSessions) {
          const sessionNodes = await store.getBySession(sessionId);
          for (const node of sessionNodes) allById.set(node.id, node);
        }
        nodes = [...allById.values()];
      }
      if (filter?.actorId) nodes = nodes.filter(n => n.actor.id === filter.actorId);

      // Sort chronologically
      nodes.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      // Build forward-edge adjacency list
      const edges: Array<{ from: string; to: string }> = [];
      for (const node of nodes) {
        if (node.parentId) edges.push({ from: node.parentId, to: node.id });
      }

      // Summary
      const actors = new Set(nodes.map(n => `${n.actor.type}:${n.actor.id}`));
      const timelines = new Set(nodes.map(n => n.timelineId));
      const sessions = new Set(nodes.map(n => n.sessionId));
      const timestamps = nodes.map(n => n.timestamp).filter(Boolean).sort();
      const dateRange = timestamps.length > 0
        ? { earliest: timestamps[0]!, latest: timestamps[timestamps.length - 1]! }
        : null;

      return {
        schemaVersion: 'danteforge.provenance-graph.v1',
        exportedAt: new Date().toISOString(),
        ...(filter?.sessionId ? { sessionId: filter.sessionId } : {}),
        nodes,
        edges,
        summary: {
          totalNodes: nodes.length,
          uniqueActors: [...actors].sort(),
          timelines: [...timelines].sort(),
          sessions: [...sessions].sort(),
          dateRange,
        },
      };
    } finally {
      await store.close();
    }
  } catch {
    return emptyExport();
  }
}

// ---------------------------------------------------------------------------
// exportDecisionChain — serialize the ancestor chain for a given node
// ---------------------------------------------------------------------------

export interface DecisionChainExport {
  schemaVersion: 'danteforge.decision-chain.v1';
  exportedAt: string;
  headNodeId: string;
  /** Ancestor chain from genesis → head (inclusive, chronological order). */
  chain: DecisionNode[];
  /** True when the chain is contiguous (no missing parent links). */
  complete: boolean;
  chainLength: number;
}

/**
 * Export the ancestor chain for a given node id (genesis → head, inclusive).
 *
 * This is a portable snapshot of the "decision lineage" leading to a specific
 * decision — suitable for audit, replay, and causal attribution tooling.
 *
 * Returns `complete: false` when any parent link is missing (e.g. store was
 * pruned or the chain crosses session boundaries that aren't in the store).
 *
 * Best-effort: returns a minimal export when the store is unavailable or the
 * head node is not found.
 */
export async function exportDecisionChain(
  headNodeId: string,
  cwd?: string,
): Promise<DecisionChainExport> {
  const session = getSession(cwd);
  const emptyExport = (): DecisionChainExport => ({
    schemaVersion: 'danteforge.decision-chain.v1',
    exportedAt: new Date().toISOString(),
    headNodeId,
    chain: [],
    complete: false,
    chainLength: 0,
  });

  try {
    const { createDecisionNodeStore } = await import('./decision-node.js');
    const store = createDecisionNodeStore(session.storePath);
    try {
      const head = await store.getById(headNodeId);
      if (!head) return emptyExport();

      const ancestors = await store.getAncestors(headNodeId);
      // getAncestors returns oldest-first (walking back), then we need genesis→head
      const chain = [...ancestors.reverse(), head];

      // Check completeness: every non-root node must find its parent in the chain
      const chainIds = new Set(chain.map(n => n.id));
      let complete = true;
      for (const node of chain) {
        if (node.parentId !== null && !chainIds.has(node.parentId)) {
          complete = false;
          break;
        }
      }

      return {
        schemaVersion: 'danteforge.decision-chain.v1',
        exportedAt: new Date().toISOString(),
        headNodeId,
        chain,
        complete,
        chainLength: chain.length,
      };
    } finally {
      await store.close();
    }
  } catch {
    return emptyExport();
  }
}
