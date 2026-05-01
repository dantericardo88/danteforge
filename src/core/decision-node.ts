/**
 * decision-node.ts
 *
 * Canonical unified schema that links DanteAgents TraceEvent hash chains to
 * DanteForge git commit SHAs. This is the load-bearing schema for the entire
 * Dante ecosystem.
 *
 * Design principles:
 *  - SHA-256(prevHash + canonicalJSON(node without hash fields)) for integrity
 *  - JSONL file-backed store; one JSON object per line
 *  - No external dependencies beyond Node built-ins
 *  - ESM-only imports
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import readline from 'node:readline';

// ---------------------------------------------------------------------------
// Core schema
// ---------------------------------------------------------------------------

/**
 * The canonical unit across the entire Dante ecosystem.
 * A DecisionNode captures one atomic decision made by a human, agent, or
 * model-training pipeline, together with its hash-chain proof of integrity.
 */
export interface DecisionNode {
  /** UUID v4 — unique identifier for this node */
  id: string;
  /** Parent node id. null indicates a root (genesis) node. */
  parentId: string | null;
  /** Work session that produced this node */
  sessionId: string;
  /** 'main' or a branch UUID when this node lives on a counterfactual branch */
  timelineId: string;
  /** ISO-8601 UTC timestamp */
  timestamp: string;

  /** Who or what produced this decision */
  actor: {
    type: 'human' | 'agent' | 'model-training';
    id: string;
    product:
      | 'danteforge'
      | 'danteagents'
      | 'dantecode'
      | 'danteharvest'
      | 'dantedojo'
      | 'unknown';
  };

  /** What was presented to the actor */
  input: {
    prompt: string;
    context?: Record<string, unknown>;
    /** Other options that were considered but not chosen */
    alternatives?: string[];
  };

  /** What the actor produced */
  output: {
    result: unknown;
    /** git commit SHA recorded when files changed as a result of this node */
    fileStateRef?: string;
    success: boolean;
    costUsd: number;
    latencyMs: number;
    qualityScore?: number;
  };

  /**
   * SHA-256(prevHash + canonicalJSON(node without hash fields))
   * Provides tamper-evidence for this node.
   */
  hash: string;
  /** Hash of the previous node in the chain. null for genesis nodes. */
  prevHash: string | null;
  /** SoulSeal receipt hash for cross-ecosystem evidence anchoring */
  evidenceRef?: string;

  /** Optional causal provenance metadata */
  causal?: {
    /** nodeIds this node directly depends on */
    dependentOn: string[];
    classification?:
      | 'independent'
      | 'dependent-adaptable'
      | 'dependent-incompatible';
    /** nodeId this node branches from (counterfactual analysis) */
    counterfactualOf?: string;
  };
}

// ---------------------------------------------------------------------------
// Adapter: DanteAgents TraceEvent → DecisionNode
// ---------------------------------------------------------------------------

/**
 * Structural adapter interface that matches DanteAgents' TraceEvent shape
 * without importing from that package.  Keep field names identical to the
 * authoritative definition in
 * C:\Projects\DanteAgents\packages\time-machine\src\types.ts.
 */
export interface TraceEventLike {
  id: string;
  type: string;
  timestamp: string;
  agentId: string;
  data: Record<string, unknown>;
  parentId: string | null;
  hash: string;
  prevHash: string | null;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Hashing utilities
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic canonical JSON string with keys sorted
 * alphabetically at every nesting level.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k]));
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Compute the SHA-256 hash for a DecisionNode that has not yet been assigned
 * its `hash` field.  The digest covers `prevHash` (or the empty string when
 * null) concatenated with the canonical JSON of every field except `hash`.
 */
export function hashDecisionNode(node: Omit<DecisionNode, 'hash'>): string {
  const prevPart = node.prevHash ?? '';
  const bodyPart = canonicalJson(node);
  return createHash('sha256').update(prevPart + bodyPart).digest('hex');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new DecisionNode, automatically computing its hash and wiring the
 * parentId / prevHash from `parentNode`.
 */
export function createDecisionNode(params: {
  parentNode: DecisionNode | null;
  sessionId: string;
  timelineId: string;
  actor: DecisionNode['actor'];
  input: DecisionNode['input'];
  output: DecisionNode['output'];
  evidenceRef?: string;
  causal?: DecisionNode['causal'];
}): DecisionNode {
  const id = randomUUID();
  const parentId = params.parentNode?.id ?? null;
  const prevHash = params.parentNode?.hash ?? null;
  const timestamp = new Date().toISOString();

  const partial: Omit<DecisionNode, 'hash'> = {
    id,
    parentId,
    sessionId: params.sessionId,
    timelineId: params.timelineId,
    timestamp,
    actor: params.actor,
    input: params.input,
    output: params.output,
    prevHash,
    ...(params.evidenceRef !== undefined ? { evidenceRef: params.evidenceRef } : {}),
    ...(params.causal !== undefined ? { causal: params.causal } : {}),
  };

  const hash = hashDecisionNode(partial);
  return { ...partial, hash };
}

// ---------------------------------------------------------------------------
// Adapter function
// ---------------------------------------------------------------------------

/**
 * Convert a DanteAgents-style TraceEvent into a DecisionNode.
 *
 * Because TraceEvent represents a lower-level event rather than a high-level
 * decision, we populate the DecisionNode fields as follows:
 *  - actor.type  → 'agent' (TraceEvent always comes from an agent)
 *  - actor.id    → event.agentId
 *  - actor.product → 'danteagents'
 *  - input.prompt  → stringified event.type (event type is the "prompt" the agent responded to)
 *  - input.context → event.data
 *  - output.result → event.data
 *  - output.success → true (TraceEvents that reached storage succeeded)
 *  - The original TraceEvent hash / prevHash are PRESERVED as-is so chain
 *    integrity can be re-verified against the original DanteAgents chain.
 */
export function fromTraceEvent(
  event: TraceEventLike,
  fileStateRef?: string,
): DecisionNode {
  return {
    id: event.id,
    parentId: event.parentId,
    sessionId: event.sessionId,
    timelineId: 'main',
    timestamp: event.timestamp,
    actor: {
      type: 'agent',
      id: event.agentId,
      product: 'danteagents',
    },
    input: {
      prompt: event.type,
      context: event.data,
    },
    output: {
      result: event.data,
      ...(fileStateRef !== undefined ? { fileStateRef } : {}),
      success: true,
      costUsd: 0,
      latencyMs: 0,
    },
    hash: event.hash,
    prevHash: event.prevHash,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Persistent JSONL store for DecisionNodes.
 *
 * Persistence:
 *  - Each call to `append()` writes one JSON line to the JSONL file.
 *  - Query methods (`getById`, `getBySession`, `getByTimeline`, `getAncestors`)
 *    scan the file on demand (suitable for moderate sizes; callers can cache
 *    the store object itself for repeated queries).
 *  - The in-memory index is populated lazily on first query so the store is
 *    cheap to construct.
 */
export interface DecisionNodeStore {
  append(node: DecisionNode): Promise<void>;
  getById(id: string): Promise<DecisionNode | undefined>;
  getBySession(sessionId: string): Promise<DecisionNode[]>;
  getByTimeline(timelineId: string): Promise<DecisionNode[]>;
  /** Walk the parentId chain from the given nodeId back to the root. */
  getAncestors(nodeId: string): Promise<DecisionNode[]>;
  close(): Promise<void>;
}

interface StoreState {
  byId: Map<string, DecisionNode>;
  loaded: boolean;
}

/**
 * Read all lines from a JSONL file and parse them into DecisionNodes.
 * Lines that fail JSON.parse are silently skipped (defensive read).
 */
async function loadAllNodes(filePath: string): Promise<Map<string, DecisionNode>> {
  const map = new Map<string, DecisionNode>();
  if (!existsSync(filePath)) return map;

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const node = JSON.parse(trimmed) as DecisionNode;
      if (node.id) map.set(node.id, node);
    } catch {
      // skip malformed lines
    }
  }

  return map;
}

/**
 * Create a file-backed JSONL DecisionNodeStore.
 *
 * The store uses lazy loading: the JSONL file is not read until the first
 * query method is called.  `append()` always writes directly to the file
 * without loading the full index first, making it cheap for write-only paths.
 */
export function createDecisionNodeStore(filePath: string): DecisionNodeStore {
  const state: StoreState = { byId: new Map(), loaded: false };

  async function ensureLoaded(): Promise<void> {
    if (state.loaded) return;
    state.byId = await loadAllNodes(filePath);
    state.loaded = true;
  }

  return {
    async append(node: DecisionNode): Promise<void> {
      const line = JSON.stringify(node) + '\n';
      await fs.appendFile(filePath, line, 'utf-8');
      // Keep the in-memory index in sync if it has already been loaded
      if (state.loaded) {
        state.byId.set(node.id, node);
      }
    },

    async getById(id: string): Promise<DecisionNode | undefined> {
      await ensureLoaded();
      return state.byId.get(id);
    },

    async getBySession(sessionId: string): Promise<DecisionNode[]> {
      await ensureLoaded();
      return Array.from(state.byId.values()).filter(
        n => n.sessionId === sessionId,
      );
    },

    async getByTimeline(timelineId: string): Promise<DecisionNode[]> {
      await ensureLoaded();
      return Array.from(state.byId.values()).filter(
        n => n.timelineId === timelineId,
      );
    },

    async getAncestors(nodeId: string): Promise<DecisionNode[]> {
      await ensureLoaded();
      const ancestors: DecisionNode[] = [];
      let currentId: string | null = nodeId;

      // Walk the parentId chain, guarding against cycles
      const visited = new Set<string>();
      while (currentId !== null) {
        if (visited.has(currentId)) break; // cycle guard
        visited.add(currentId);

        const node = state.byId.get(currentId);
        if (!node) break;

        // The first node is the start node itself; skip it in the ancestors list
        if (currentId !== nodeId) {
          ancestors.push(node);
        }
        currentId = node.parentId;
      }
      return ancestors;
    },

    async close(): Promise<void> {
      // No persistent handles to close for the JSONL store.
      // Reset in-memory index so the store can be garbage-collected cleanly.
      state.byId.clear();
      state.loaded = false;
    },
  };
}
