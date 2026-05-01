/**
 * time-machine-replay.ts
 *
 * Counterfactual replay engine for the Dante Time Machine.
 *
 * Given a DecisionNode ID and an altered input, this module:
 *  1. Restores file state to the branch point (via restoreTimeMachineCommit)
 *  2. Re-runs forward with the new input, recording a new timeline
 *  3. Diffs the original and alternate paths
 *
 * Design principles:
 *  - No external dependencies beyond Node built-ins and internal DanteForge modules
 *  - ESM-only imports
 *  - Strict TypeScript; no unsafe casts
 *  - crypto.randomUUID() for all UUID generation
 */

import { randomUUID } from 'node:crypto';

import { restoreTimeMachineCommit } from './time-machine.js';
import { createDecisionNode } from './decision-node.js';
import type { DecisionNode, DecisionNodeStore } from './decision-node.js';
import type { RestoreTimeMachineResult } from './time-machine.js';

// ---------------------------------------------------------------------------
// Public interface types
// ---------------------------------------------------------------------------

export interface CounterfactualReplayRequest {
  /** Go back to this decision point */
  branchFromNodeId: string;
  /** What you wish had been said instead */
  alteredInput: string;
  /** Session context */
  sessionId: string;
  /** Max steps forward (default: 50) */
  replayDepth?: number;
  /** Keep independent nodes in new timeline (default: true) */
  preserveIndependent?: boolean;
  /** If true, plan only — don't execute LLM calls */
  dryRun?: boolean;
  /** Optional caller-provided timeline id for deterministic child-process replay */
  newTimelineId?: string;
}

export interface TimelineDiff {
  /** Same outcome either way */
  convergent: DecisionNode[];
  /** Different outcome in the alternate timeline */
  divergent: DecisionNode[];
  /** Never happened in the alternate timeline */
  unreachable: DecisionNode[];
}

export interface CounterfactualReplayResult {
  originalTimelineId: string;
  newTimelineId: string;
  branchPoint: DecisionNode;
  originalPath: DecisionNode[];
  alternatePath: DecisionNode[];
  divergence: TimelineDiff;
  /** True when both paths reached the same end state */
  outcomeEquivalent: boolean;
  /** Human-readable: "X led to Y led to Z" */
  causalChain: string[];
  costUsd: number;
  durationMs: number;
  artifacts?: ReplayArtifactSummary;
}

export interface ReplayArtifactSummary {
  replayDir?: string;
  workspacePath?: string;
  restoreCommitId?: string;
  restoreOutDir?: string;
  resultPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  pipelineExitCode?: number;
}

export interface PipelineRunContext {
  sessionId: string;
  timelineId: string;
  parentNodeId: string;
  storePath?: string;
  workspacePath?: string;
}

/**
 * Return type for a full pipeline rerun used by the pipelineCaller injection seam.
 * The caller runs the complete DanteForge convergence loop (magic) and returns
 * all DecisionNodes that were recorded during that run.
 */
export interface PipelineRunResult {
  /** Decision nodes produced by the pipeline run, in timestamp order */
  nodes: DecisionNode[];
  /** Aggregate cost in USD across all pipeline nodes */
  costUsd: number;
  /** True when nodes were already written to the shared DecisionNode store by the pipeline. */
  nodesAlreadyRecorded?: boolean;
  artifacts?: ReplayArtifactSummary;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Execute a counterfactual replay.
 *
 * 1. Load the branch-point node from the store.
 * 2. Load all original timeline nodes that occurred after the branch point.
 * 3. Generate a fresh timelineId for the alternate branch.
 * 4. If the branch-point node has a fileStateRef (a Time Machine commit ID),
 *    restore the file state to that point (working-tree restore, confirmation
 *    required is handled by the caller via workspacePath).
 * 5. In dry-run mode: return the plan without calling the LLM.
 * 6. In live mode: call llmCaller with the altered prompt, record the response
 *    as the first node on the new timeline, then append it to the store.
 * 7. Diff the two timelines and compute outcome equivalence.
 */
export async function counterfactualReplay(
  request: CounterfactualReplayRequest,
  store: DecisionNodeStore,
  options?: {
    llmCaller?: (prompt: string) => Promise<string>;
    /** Full DanteForge pipeline rerun. When provided, used instead of llmCaller. */
    pipelineCaller?: (input: string, context: PipelineRunContext) => Promise<PipelineRunResult>;
    workspacePath?: string;
    /** Restore into this directory instead of the live working tree. */
    restoreOutDir?: string;
    replayDir?: string;
    storePath?: string;
  },
): Promise<CounterfactualReplayResult> {
  const startMs = Date.now();

  const branchPoint = await store.getById(request.branchFromNodeId);
  if (!branchPoint) {
    throw new Error(
      `counterfactualReplay: branch-point node not found: ${request.branchFromNodeId}`,
    );
  }

  // ------------------------------------------------------------------
  // Collect original path: all nodes in the same session and timeline
  // that are strictly after the branch point (by timestamp).
  // ------------------------------------------------------------------
  const sessionNodes = await store.getBySession(request.sessionId);
  const branchTs = new Date(branchPoint.timestamp).getTime();

  const originalPath = sessionNodes
    .filter(
      n =>
        n.timelineId === branchPoint.timelineId &&
        n.id !== branchPoint.id &&
        new Date(n.timestamp).getTime() > branchTs,
    )
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

  const newTimelineId = request.newTimelineId ?? randomUUID();
  const alternatePath: DecisionNode[] = [];
  const artifacts: ReplayArtifactSummary = {};

  // ------------------------------------------------------------------
  // Optionally restore file state to the branch-point snapshot.
  // ------------------------------------------------------------------
  const fileStateRef = branchPoint.output.fileStateRef;
  if (fileStateRef && options?.workspacePath && !request.dryRun) {
    const restoreResult: RestoreTimeMachineResult = await restoreTimeMachineCommit({
      cwd: options.workspacePath,
      commitId: fileStateRef,
      ...(options.restoreOutDir
        ? { outDir: options.restoreOutDir }
        : { toWorkingTree: true, confirm: true }),
    });
    artifacts.restoreCommitId = restoreResult.commitId;
    artifacts.restoreOutDir = restoreResult.outDir;
  }

  // ------------------------------------------------------------------
  // Execute the alternate branch (or just plan in dry-run mode).
  // ------------------------------------------------------------------
  let costUsd = 0;

  if (!request.dryRun) {
    const pipelineCaller = options?.pipelineCaller;
    const llmCaller = options?.llmCaller;

    if (!pipelineCaller && !llmCaller) {
      throw new Error(
        'counterfactualReplay: llmCaller or pipelineCaller is required when dryRun is false',
      );
    }

    if (pipelineCaller) {
      // Full pipeline rerun: run the entire DanteForge convergence loop and
      // collect all resulting DecisionNodes as the alternate timeline.
      const pipelineResult = await pipelineCaller(request.alteredInput, {
        sessionId: request.sessionId,
        timelineId: newTimelineId,
        parentNodeId: branchPoint.id,
        storePath: options?.storePath,
        workspacePath: options?.restoreOutDir ?? options?.workspacePath,
      });
      if (pipelineResult.nodesAlreadyRecorded) {
        alternatePath.push(...pipelineResult.nodes);
      } else {
        let parentForRebrand: DecisionNode = branchPoint;
        for (const node of pipelineResult.nodes) {
          const rebranded = createDecisionNode({
            parentNode: parentForRebrand,
            sessionId: request.sessionId,
            timelineId: newTimelineId,
            actor: node.actor,
            input: node.input,
            output: node.output,
            causal: { dependentOn: [branchPoint.id], counterfactualOf: branchPoint.id },
          });
          await store.append(rebranded);
          alternatePath.push(rebranded);
          parentForRebrand = rebranded;
        }
      }
      costUsd = pipelineResult.costUsd;
      Object.assign(artifacts, pipelineResult.artifacts);
    } else {
      // Single LLM call: one round-trip with the altered input.
      const depth = Math.max(1, request.replayDepth ?? 50);
      let currentParent: DecisionNode = branchPoint;
      let stepsLeft = depth;

      const callStart = Date.now();
      const response = await llmCaller!(request.alteredInput);
      const latencyMs = Date.now() - callStart;

      const firstNode = createDecisionNode({
        parentNode: branchPoint,
        sessionId: request.sessionId,
        timelineId: newTimelineId,
        actor: branchPoint.actor,
        input: { prompt: request.alteredInput },
        output: {
          result: response,
          success: true,
          costUsd: 0,
          latencyMs,
        },
        causal: { dependentOn: [branchPoint.id], counterfactualOf: branchPoint.id },
      });

      await store.append(firstNode);
      alternatePath.push(firstNode);
      currentParent = firstNode;
      stepsLeft -= 1;

      // Replay subsequent steps from the original path (if preserveIndependent).
      const shouldPreserve = request.preserveIndependent !== false;
      if (shouldPreserve && stepsLeft > 0) {
        const independentOriginals = originalPath.filter(
          n => n.causal?.classification === 'independent',
        );
        for (const orig of independentOriginals) {
          if (stepsLeft <= 0) break;
          const copied = createDecisionNode({
            parentNode: currentParent,
            sessionId: request.sessionId,
            timelineId: newTimelineId,
            actor: orig.actor,
            input: orig.input,
            output: orig.output,
            causal: {
              dependentOn: [currentParent.id],
              classification: 'independent',
            },
          });
          await store.append(copied);
          alternatePath.push(copied);
          currentParent = copied;
          stepsLeft -= 1;
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Compute diff, outcome equivalence, and causal chain.
  // ------------------------------------------------------------------
  const divergence = diffTimelines(originalPath, alternatePath);
  const outcomeEquivalent = computeOutcomeEquivalent(originalPath, alternatePath);
  const causalChain = buildCausalChain(branchPoint, divergence.divergent);

  return {
    originalTimelineId: branchPoint.timelineId,
    newTimelineId,
    branchPoint,
    originalPath,
    alternatePath,
    divergence,
    outcomeEquivalent,
    causalChain,
    costUsd,
    durationMs: Date.now() - startMs,
    artifacts: Object.keys(artifacts).length > 0 ? {
      ...artifacts,
      ...(options?.replayDir ? { replayDir: options.replayDir } : {}),
      ...(options?.restoreOutDir ? { workspacePath: options.restoreOutDir } : {}),
    } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Timeline diff
// ---------------------------------------------------------------------------

/**
 * Diff two timelines from a common branch point.
 *
 * Classification rules:
 *  - **convergent**: nodes that appear in BOTH paths with the same
 *    `input.prompt` text. This means the two timelines independently
 *    arrived at the same decision regardless of the altered input.
 *  - **divergent**: nodes that appear only in the alternate path (new
 *    outcomes produced by the altered branch).
 *  - **unreachable**: nodes that appear only in the original path (decisions
 *    that were never reached in the alternate timeline).
 */
export function diffTimelines(
  original: DecisionNode[],
  alternate: DecisionNode[],
): TimelineDiff {
  const originalPrompts = new Set(original.map(n => n.input.prompt));
  const alternatePrompts = new Set(alternate.map(n => n.input.prompt));

  const convergent: DecisionNode[] = [];
  const divergent: DecisionNode[] = [];
  const unreachable: DecisionNode[] = [];

  for (const node of alternate) {
    if (originalPrompts.has(node.input.prompt)) {
      convergent.push(node);
    } else {
      divergent.push(node);
    }
  }

  for (const node of original) {
    if (!alternatePrompts.has(node.input.prompt)) {
      unreachable.push(node);
    }
  }

  return { convergent, divergent, unreachable };
}

// ---------------------------------------------------------------------------
// Causal chain narrative
// ---------------------------------------------------------------------------

/**
 * Build a human-readable causal chain from the branch point through the
 * divergent nodes.
 *
 * Format: "Decision at [timestamp]: [input.prompt] → [output.result summary]"
 */
export function buildCausalChain(
  branchPoint: DecisionNode,
  divergent: DecisionNode[],
): string[] {
  const chain: string[] = [];

  // Always start from the branch point.
  chain.push(formatChainEntry(branchPoint));

  for (const node of divergent) {
    chain.push(formatChainEntry(node));
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatChainEntry(node: DecisionNode): string {
  const ts = node.timestamp;
  const prompt = truncate(node.input.prompt, 120);
  const result = summariseResult(node.output.result);
  return `Decision at ${ts}: ${prompt} → ${result}`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function summariseResult(result: unknown): string {
  if (result === null || result === undefined) return '(no result)';
  if (typeof result === 'string') return truncate(result, 80);
  try {
    const serialised = JSON.stringify(result);
    return truncate(serialised, 80);
  } catch {
    return String(result);
  }
}

/**
 * True when both paths are non-empty and their final nodes have identical
 * `output.result` values (compared via canonical JSON serialisation).
 */
function computeOutcomeEquivalent(
  original: DecisionNode[],
  alternate: DecisionNode[],
): boolean {
  if (original.length === 0 || alternate.length === 0) return false;

  const lastOriginal = original[original.length - 1];
  const lastAlternate = alternate[alternate.length - 1];

  if (!lastOriginal || !lastAlternate) return false;

  return canonicalJsonEqual(lastOriginal.output.result, lastAlternate.output.result);
}

function canonicalJsonEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(obj[k]));
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(value);
}
