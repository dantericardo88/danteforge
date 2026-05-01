/**
 * decision-node-adapters.ts
 *
 * Adapter interfaces and factory functions that show every Dante product how
 * to create DecisionNodes from their native event types.
 *
 * This is the integration contract for Phase 4 ecosystem rollout.
 *
 * Design notes:
 *  - Each adapter calls createDecisionNode with parentNode: null.
 *    Callers are responsible for wiring the chain (setting parentNode).
 *  - timelineId defaults to 'main' when not provided.
 *  - No external dependencies — Node built-ins only.
 *  - ESM-only imports.
 */

import {
  type DecisionNode,
  type TraceEventLike,
  createDecisionNode,
  fromTraceEvent,
} from './decision-node.js';

// Re-export so callers only need to import from this module.
export type { TraceEventLike };

// ---------------------------------------------------------------------------
// 1. DanteAgents adapter
// ---------------------------------------------------------------------------

/**
 * Convert a DanteAgents TraceEvent (or compatible TraceEventLike object) into
 * a DecisionNode, optionally enriching it with file state / quality metadata.
 *
 * Uses the existing fromTraceEvent from decision-node.ts to preserve the
 * original TraceEvent hash chain, then overlays the optional overrides.
 */
export function fromDanteAgentsEvent(
  event: TraceEventLike,
  opts?: {
    fileStateRef?: string;
    qualityScore?: number;
    costUsd?: number;
  },
): DecisionNode {
  const base = fromTraceEvent(event, opts?.fileStateRef);

  if (opts?.qualityScore !== undefined || opts?.costUsd !== undefined) {
    return {
      ...base,
      output: {
        ...base.output,
        ...(opts.qualityScore !== undefined ? { qualityScore: opts.qualityScore } : {}),
        ...(opts.costUsd !== undefined ? { costUsd: opts.costUsd } : {}),
      },
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// 2. DanteCode adapter
// ---------------------------------------------------------------------------

/**
 * A DanteCode LLM code-generation event.
 * Each call to the code-generation pipeline produces one of these.
 */
export interface DanteCodeEvent {
  requestId: string;
  sessionId: string;
  parentRequestId?: string;
  /** The coding instruction presented to the model */
  prompt: string;
  /** The generated code */
  response: string;
  /** Programming language — e.g. 'typescript' | 'python' */
  language: string;
  /** Files created or modified as a result of this generation */
  filesPaths: string[];
  /** Git commit SHA if the changes were committed */
  gitCommitSha?: string;
  success: boolean;
  costUsd: number;
  latencyMs: number;
  timestamp: string;
}

/**
 * Convert a DanteCode code-generation event into a DecisionNode.
 * Maps gitCommitSha to output.fileStateRef when present.
 */
export function fromDanteCodeEvent(
  event: DanteCodeEvent,
  timelineId?: string,
): DecisionNode {
  return createDecisionNode({
    parentNode: null,
    sessionId: event.sessionId,
    timelineId: timelineId ?? 'main',
    actor: {
      type: 'agent',
      id: event.requestId,
      product: 'dantecode',
    },
    input: {
      prompt: event.prompt,
      context: {
        requestId: event.requestId,
        parentRequestId: event.parentRequestId ?? null,
        language: event.language,
        filesPaths: event.filesPaths,
      },
    },
    output: {
      result: event.response,
      ...(event.gitCommitSha !== undefined ? { fileStateRef: event.gitCommitSha } : {}),
      success: event.success,
      costUsd: event.costUsd,
      latencyMs: event.latencyMs,
    },
  });
}

// ---------------------------------------------------------------------------
// 3. DanteHarvest adapter
// ---------------------------------------------------------------------------

/**
 * A DanteHarvest OSS pattern decision event.
 * Each adopt / reject / defer decision for a harvested pattern = one node.
 */
export interface DanteHarvestEvent {
  harvestId: string;
  sessionId: string;
  repoUrl: string;
  patternName: string;
  decision: 'adopt' | 'reject' | 'defer';
  reasoning: string;
  patternsFound: number;
  patternsAdopted: number;
  costUsd: number;
  timestamp: string;
}

/**
 * Convert a DanteHarvest pattern decision event into a DecisionNode.
 * Maps the human-readable reasoning to input.prompt so it reads as "what
 * was the basis for the decision".
 */
export function fromDanteHarvestEvent(
  event: DanteHarvestEvent,
  timelineId?: string,
): DecisionNode {
  return createDecisionNode({
    parentNode: null,
    sessionId: event.sessionId,
    timelineId: timelineId ?? 'main',
    actor: {
      type: 'agent',
      id: event.harvestId,
      product: 'danteharvest',
    },
    input: {
      prompt: event.reasoning,
      context: {
        harvestId: event.harvestId,
        repoUrl: event.repoUrl,
        patternName: event.patternName,
        patternsFound: event.patternsFound,
        patternsAdopted: event.patternsAdopted,
      },
    },
    output: {
      result: {
        decision: event.decision,
        patternName: event.patternName,
        repoUrl: event.repoUrl,
      },
      success: event.decision === 'adopt',
      costUsd: event.costUsd,
      latencyMs: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// 4. DanteDojo adapter
// ---------------------------------------------------------------------------

/**
 * A DanteDojo model-training checkpoint or hyperparameter decision event.
 * Each training checkpoint or tuning decision = one node.
 */
export interface DanteDojoEvent {
  runId: string;
  sessionId: string;
  parentRunId?: string;
  /** Training step at which the checkpoint was taken */
  checkpointStep: number;
  /** Hyperparameters active at this checkpoint — e.g. lr, batch_size */
  hyperparameters: Record<string, unknown>;
  /** Measured metrics at this checkpoint — e.g. loss, accuracy */
  metrics: Record<string, number>;
  /** Filesystem path to the saved checkpoint — used as fileStateRef */
  checkpointPath: string;
  /** What was decided at this checkpoint — e.g. "continue training" */
  decision: string;
  success: boolean;
  timestamp: string;
}

/**
 * Convert a DanteDojo training checkpoint event into a DecisionNode.
 * Maps checkpointPath to output.fileStateRef so it can be replayed.
 */
export function fromDanteDojoEvent(
  event: DanteDojoEvent,
  timelineId?: string,
): DecisionNode {
  return createDecisionNode({
    parentNode: null,
    sessionId: event.sessionId,
    timelineId: timelineId ?? 'main',
    actor: {
      type: 'model-training',
      id: event.runId,
      product: 'dantedojo',
    },
    input: {
      prompt: event.decision,
      context: {
        runId: event.runId,
        parentRunId: event.parentRunId ?? null,
        checkpointStep: event.checkpointStep,
        hyperparameters: event.hyperparameters,
        metrics: event.metrics,
      },
    },
    output: {
      result: {
        metrics: event.metrics,
        decision: event.decision,
        checkpointStep: event.checkpointStep,
      },
      fileStateRef: event.checkpointPath,
      success: event.success,
      costUsd: 0,
      latencyMs: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// 5. Science domain adapter
// ---------------------------------------------------------------------------

/**
 * A science experiment decision event spanning domains such as biochemistry,
 * materials science, drug discovery, and climate modeling.
 * Each experimental decision = one node.
 */
export interface ScienceExperimentEvent {
  experimentId: string;
  sessionId: string;
  parentExperimentId?: string;
  domain:
    | 'biochemistry'
    | 'materials-science'
    | 'drug-discovery'
    | 'climate-modeling'
    | string;
  /** The scientific question or hypothesis being tested */
  hypothesis: string;
  /** Experimental parameters — e.g. temperature, concentration */
  parameters: Record<string, unknown>;
  /** Measured results from the experiment */
  outcome: Record<string, unknown>;
  /** What was decided based on the results */
  decision: string;
  /** Whether the experiment yielded usable data */
  success: boolean;
  timestamp: string;
}

/**
 * Convert a science experiment event into a DecisionNode.
 * Maps hypothesis to input.prompt — the scientific question is the "prompt"
 * that the experiment answers.
 */
export function fromScienceExperimentEvent(
  event: ScienceExperimentEvent,
  timelineId?: string,
): DecisionNode {
  // createDecisionNode generates a fresh UUID v4 for the id field automatically.
  return createDecisionNode({
    parentNode: null,
    sessionId: event.sessionId,
    timelineId: timelineId ?? 'main',
    actor: {
      type: 'agent',
      id: event.experimentId,
      product: 'unknown',
    },
    input: {
      prompt: event.hypothesis,
      context: {
        experimentId: event.experimentId,
        parentExperimentId: event.parentExperimentId ?? null,
        domain: event.domain,
        parameters: event.parameters,
      },
    },
    output: {
      result: {
        outcome: event.outcome,
        decision: event.decision,
        domain: event.domain,
      },
      success: event.success,
      costUsd: 0,
      latencyMs: 0,
    },
  });
}
