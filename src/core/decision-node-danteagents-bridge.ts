/**
 * decision-node-danteagents-bridge.ts
 *
 * Connects DanteAgents ForgeOrchestrator results to the DanteForge DecisionNode store.
 * This module creates the unified decision graph described in the Time Machine masterplan:
 * each ForgeOrchestrator step becomes a DecisionNode, linked by parentId chain, stored
 * in the same JSONL store as DanteForge's own magic/verify decisions.
 *
 * Zero cross-package dependencies: uses structural interfaces (no imports from DanteAgents).
 * The actual DanteAgents ForgeOrchestrator passes its result to `recordForgeResult()` and
 * the bridge handles schema translation + store append.
 */

import {
  createDecisionNode,
  createDecisionNodeStore,
  type DecisionNode,
  type TraceEventLike,
  fromTraceEvent,
} from './decision-node.js';

// ---------------------------------------------------------------------------
// Structural interfaces — match DanteAgents types without importing them
// ---------------------------------------------------------------------------

/** Minimal subset of a DanteAgents StepResult used for conversion. */
export interface StepResultLike {
  stepId: string;
  output: unknown;
  success: boolean;
  error?: string;
  attempts: number;
  qualityScore: number;
  durationMs: number;
  /** Optional SoulSeal evidence hash from DanteAgents */
  evidenceHash?: string;
}

/** Minimal subset of ForgeResult used for conversion. */
export interface ForgeResultLike {
  success: boolean;
  response: string;
  steps: StepResultLike[];
  metadata: {
    totalDurationMs: number;
    totalSteps: number;
    averageQualityScore: number;
    state: string;
  };
  evidenceHash?: string;
}

// ---------------------------------------------------------------------------
// Bridge factory
// ---------------------------------------------------------------------------

export interface DanteAgentsBridge {
  /**
   * Convert a ForgeOrchestrator result into a chain of DecisionNodes.
   * Each step becomes one node; the root node represents the overall task.
   * Returns all nodes appended to the store.
   */
  recordForgeResult(params: {
    task: string;
    result: ForgeResultLike;
    sessionId: string;
    timelineId?: string;
    agentId?: string;
    fileStateRef?: string;
  }): Promise<DecisionNode[]>;

  /**
   * Convert a single DanteAgents TraceEvent to a DecisionNode and append it.
   * Use when you want event-by-event recording rather than batch on completion.
   */
  recordTraceEvent(
    event: TraceEventLike,
    fileStateRef?: string,
  ): Promise<DecisionNode>;
}

/**
 * Create a bridge bound to a specific decision-node store file.
 *
 * @param storePath  Absolute path to `.danteforge/decision-nodes.jsonl`
 */
export function createDanteAgentsBridge(storePath: string): DanteAgentsBridge {
  async function recordForgeResult(params: {
    task: string;
    result: ForgeResultLike;
    sessionId: string;
    timelineId?: string;
    agentId?: string;
    fileStateRef?: string;
  }): Promise<DecisionNode[]> {
    const {
      task,
      result,
      sessionId,
      timelineId = 'main',
      agentId = 'danteagents-orchestrator',
      fileStateRef,
    } = params;

    const store = createDecisionNodeStore(storePath);
    const appended: DecisionNode[] = [];

    try {
      // Root node: represents the overall orchestrated task
      const rootNode = createDecisionNode({
        parentNode: null,
        sessionId,
        timelineId,
        actor: {
          type: 'agent',
          id: agentId,
          product: 'danteagents',
        },
        input: { prompt: task },
        output: {
          result: result.response,
          success: result.success,
          costUsd: 0,
          latencyMs: result.metadata.totalDurationMs,
          qualityScore: result.metadata.averageQualityScore,
          ...(fileStateRef !== undefined ? { fileStateRef } : {}),
        },
        evidenceRef: result.evidenceHash,
      });

      await store.append(rootNode);
      appended.push(rootNode);

      // Step nodes: each ForgeOrchestrator step becomes a child node
      let prevNode: DecisionNode = rootNode;
      for (const step of result.steps) {
        const stepNode = createDecisionNode({
          parentNode: prevNode,
          sessionId,
          timelineId,
          actor: {
            type: 'agent',
            id: agentId,
            product: 'danteagents',
          },
          input: { prompt: `[step:${step.stepId}] ${task}` },
          output: {
            result: step.output,
            success: step.success,
            costUsd: 0,
            latencyMs: step.durationMs,
            qualityScore: step.qualityScore,
          },
          evidenceRef: step.evidenceHash,
        });

        await store.append(stepNode);
        appended.push(stepNode);
        prevNode = stepNode;
      }
    } finally {
      await store.close();
    }

    return appended;
  }

  async function recordTraceEvent(
    event: TraceEventLike,
    fileStateRef?: string,
  ): Promise<DecisionNode> {
    const store = createDecisionNodeStore(storePath);
    try {
      const node = fromTraceEvent(event, fileStateRef);
      await store.append(node);
      return node;
    } finally {
      await store.close();
    }
  }

  return { recordForgeResult, recordTraceEvent };
}
