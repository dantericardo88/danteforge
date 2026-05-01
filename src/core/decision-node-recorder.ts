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
  let sessionId: string = randomUUID();

  // Best-effort: try to read sessionId from STATE.yaml so nodes can be
  // correlated with the existing project state.
  try {
    const stateFile = path.join(root, '.danteforge', 'STATE.yaml');
    const raw = readFileSync(stateFile, 'utf-8');
    const match = raw.match(/^sessionId:\s*['"]?([a-f0-9-]{36})['"]?/m);
    if (match?.[1]) sessionId = match[1];
  } catch {
    // STATE.yaml absent or unreadable — use generated UUID
  }

  _session = {
    sessionId,
    timelineId: 'main',
    product: 'danteforge',
    storePath: path.join(root, '.danteforge', 'decision-nodes.jsonl'),
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
    if (params.parentNodeId) {
      try {
        const store = createDecisionNodeStore(params.session.storePath);
        parentNode = (await store.getById(params.parentNodeId)) ?? null;
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
      parentId: params.parentNodeId ?? null,
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
