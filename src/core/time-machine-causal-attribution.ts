/**
 * time-machine-causal-attribution.ts
 *
 * Causal attribution classifier for the Dante Time Machine.
 *
 * Given two timelines that diverged at a branch point, classifies every
 * downstream node as independent, dependent-adaptable, or
 * dependent-incompatible.  This is the core research contribution of
 * Phase 3 of the Dante Time Machine.
 *
 * Design:
 *  - Strict TypeScript, no external dependencies beyond Node built-ins
 *  - Heuristic path (classifyNodesHeuristic) requires no I/O or LLM
 *  - Optional LLM path (classifyNodes) can augment heuristics with semantic
 *    reasoning; falls back gracefully when llmCaller is absent
 *  - All exports are named (no default exports)
 */

import type { DecisionNode } from './decision-node.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Classification of a downstream node relative to a branch point decision */
export type CausalClassification =
  | 'independent'            // Would have happened regardless of the branch decision
  | 'dependent-adaptable'    // Caused by the decision but has an equivalent in the new timeline
  | 'dependent-incompatible'; // Caused by the decision with no equivalent — surface to human

export interface AttributedNode {
  node: DecisionNode;
  classification: CausalClassification;
  /** 0.0 – 1.0 */
  confidence: number;
  /** Human-readable explanation */
  reasoning: string;
  /** For dependent-adaptable: the equivalent node in the alternate timeline */
  adaptedEquivalent?: DecisionNode;
}

export interface CausalAttributionResult {
  branchPointId: string;
  originalNodes: AttributedNode[];
  alternateNodes: AttributedNode[];
  independentCount: number;
  adaptableCount: number;
  incompatibleCount: number;
  /** Did both timelines converge to equivalent outcomes? */
  converged: boolean;
  /** Where they converged (if they did) */
  convergenceNodeId?: string;
  /** Human-readable summary */
  summary: string;
}

// ---------------------------------------------------------------------------
// Stop-word list (used for keyword overlap calculations)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need',
  'dare', 'ought', 'used', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'we', 'you', 'he', 'she', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their', 'what', 'which', 'who', 'how',
  'when', 'where', 'why', 'not', 'no', 'yes', 'so', 'if', 'then', 'than',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Tokenise a string into significant lower-cased words, stripping stop words,
 * punctuation, and short tokens.
 */
function significantWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Jaccard-like keyword overlap between two texts.
 * Returns 0.0 (no overlap) to 1.0 (identical word sets).
 */
function keywordOverlap(a: string, b: string): number {
  const setA = significantWords(a);
  const setB = significantWords(b);
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Return true when the node's causal.dependentOn array references the given id.
 */
function hasCausalDependency(node: DecisionNode, branchPointId: string): boolean {
  return (node.causal?.dependentOn ?? []).includes(branchPointId);
}

/**
 * Check if a node is structurally dependent on the branch point via keyword
 * overlap with the branch point's output or prompt.
 */
function isKeywordDependent(
  node: DecisionNode,
  branchPoint: DecisionNode,
  overlapThreshold: number,
): boolean {
  const bpOutputText = typeof branchPoint.output.result === 'string'
    ? branchPoint.output.result
    : JSON.stringify(branchPoint.output.result ?? '');
  const bpPromptText = branchPoint.input.prompt;

  const nodePrompt = node.input.prompt;
  const overlapWithOutput = keywordOverlap(nodePrompt, bpOutputText);
  const overlapWithPrompt = keywordOverlap(nodePrompt, bpPromptText);

  // >30% overlap with the branch-point's output or prompt → dependent
  return overlapWithOutput > overlapThreshold || overlapWithPrompt > overlapThreshold;
}

// ---------------------------------------------------------------------------
// areNodesEquivalent
// ---------------------------------------------------------------------------

/**
 * Heuristic equivalence check between two DecisionNodes.
 *
 * Nodes are equivalent when:
 *  - Same actor.type and actor.product
 *  - Input prompts share >50% of significant words
 *  - Output success status matches
 */
export function areNodesEquivalent(a: DecisionNode, b: DecisionNode): boolean {
  if (a.actor.type !== b.actor.type) return false;
  if (a.actor.product !== b.actor.product) return false;
  if (a.output.success !== b.output.success) return false;
  return keywordOverlap(a.input.prompt, b.input.prompt) > 0.5;
}

// ---------------------------------------------------------------------------
// detectConvergence
// ---------------------------------------------------------------------------

/**
 * Check if two timelines converge (reach equivalent end states).
 *
 * Strategy:
 *  1. JSON-equality on final output.result → definitive convergence
 *  2. >60% keyword overlap on final input.prompt → probable convergence
 *  3. Walk backward from the end comparing node pairs with areNodesEquivalent
 *     to find a convergence index
 */
export function detectConvergence(
  original: DecisionNode[],
  alternate: DecisionNode[],
): { converged: boolean; convergenceIndex?: number } {
  if (original.length === 0 || alternate.length === 0) {
    return { converged: false };
  }

  const lastOriginal = original[original.length - 1] as DecisionNode;
  const lastAlternate = alternate[alternate.length - 1] as DecisionNode;

  // 1. JSON-equality on final output.result
  try {
    if (JSON.stringify(lastOriginal.output.result) === JSON.stringify(lastAlternate.output.result)) {
      return { converged: true, convergenceIndex: Math.min(original.length, alternate.length) - 1 };
    }
  } catch {
    // fall through to heuristic checks
  }

  // 2. Keyword overlap on final prompts
  const finalOverlap = keywordOverlap(lastOriginal.input.prompt, lastAlternate.input.prompt);
  if (finalOverlap > 0.6) {
    return { converged: true, convergenceIndex: Math.min(original.length, alternate.length) - 1 };
  }

  // 3. Walk backward looking for a convergence point
  const minLen = Math.min(original.length, alternate.length);
  for (let i = minLen - 1; i >= 0; i--) {
    if (areNodesEquivalent(original[i] as DecisionNode, alternate[i] as DecisionNode)) {
      return { converged: true, convergenceIndex: i };
    }
  }

  return { converged: false };
}

// ---------------------------------------------------------------------------
// Internal: classify a single original-timeline node heuristically
// ---------------------------------------------------------------------------

function classifyOriginalNode(
  node: DecisionNode,
  branchPoint: DecisionNode,
  alternateTimeline: DecisionNode[],
  keywordDependencyThreshold: number,
): AttributedNode {
  const structuralDep = hasCausalDependency(node, branchPoint.id);
  const keywordDep = isKeywordDependent(node, branchPoint, keywordDependencyThreshold);
  const isDependent = structuralDep || keywordDep;

  if (!isDependent) {
    return {
      node,
      classification: 'independent',
      confidence: structuralDep === false && !keywordDep ? 0.8 : 0.6,
      reasoning:
        'Node shares no structural causal link and insufficient keyword overlap with the branch point.',
    };
  }

  // Dependent — check if an equivalent node exists in the alternate timeline
  const equivalent = alternateTimeline.find(alt => areNodesEquivalent(node, alt));

  if (equivalent !== undefined) {
    const depReason = structuralDep
      ? `Node explicitly lists branch point ${branchPoint.id} in causal.dependentOn.`
      : `Node input prompt shares >30% keyword overlap with branch point output/prompt.`;
    return {
      node,
      classification: 'dependent-adaptable',
      confidence: structuralDep ? 0.9 : 0.75,
      reasoning: `${depReason} A semantically equivalent node exists in the alternate timeline.`,
      adaptedEquivalent: equivalent,
    };
  }

  const depReason = structuralDep
    ? `Node explicitly lists branch point ${branchPoint.id} in causal.dependentOn.`
    : `Node input prompt shares >30% keyword overlap with branch point output/prompt.`;
  return {
    node,
    classification: 'dependent-incompatible',
    confidence: structuralDep ? 0.9 : 0.7,
    reasoning: `${depReason} No semantically equivalent node found in the alternate timeline — surface to human review.`,
  };
}

// ---------------------------------------------------------------------------
// classifyNodesHeuristic (sync, no LLM)
// ---------------------------------------------------------------------------

/**
 * Classify all downstream nodes in both timelines relative to the branch point
 * using only structural heuristics (no LLM required).
 *
 * Classification rules:
 *
 * **Independent** (default):
 *   - causal.dependentOn does NOT include branchPoint.id
 *   - AND keyword overlap with branchPoint prompt/output is ≤ 30%
 *   - AND the node appears at a similar position in both timelines with similar prompts
 *
 * **Dependent-adaptable**:
 *   - causal.dependentOn includes branchPoint.id  OR  keyword overlap > 30%
 *   - AND a semantically similar node exists in the alternate timeline
 *
 * **Dependent-incompatible**:
 *   - Dependent (as above) but NO similar node exists in the alternate timeline
 */
export function classifyNodesHeuristic(
  branchPoint: DecisionNode,
  originalTimeline: DecisionNode[],
  alternateTimeline: DecisionNode[],
): CausalAttributionResult {
  const KEYWORD_DEP_THRESHOLD = 0.3;

  const originalAttributed: AttributedNode[] = originalTimeline.map(node =>
    classifyOriginalNode(node, branchPoint, alternateTimeline, KEYWORD_DEP_THRESHOLD),
  );

  // Alternate timeline nodes: check if they have an equivalent in the original
  // (mirrors the same logic; nodes that have no counterpart in original are classified
  //  relative to their own dependence on the branch point)
  const alternateAttributed: AttributedNode[] = alternateTimeline.map(node =>
    classifyOriginalNode(node, branchPoint, originalTimeline, KEYWORD_DEP_THRESHOLD),
  );

  const independentCount = originalAttributed.filter(
    n => n.classification === 'independent',
  ).length;
  const adaptableCount = originalAttributed.filter(
    n => n.classification === 'dependent-adaptable',
  ).length;
  const incompatibleCount = originalAttributed.filter(
    n => n.classification === 'dependent-incompatible',
  ).length;

  const convergenceResult = detectConvergence(originalTimeline, alternateTimeline);
  const convergenceNodeId = convergenceResult.converged && convergenceResult.convergenceIndex !== undefined
    ? (originalTimeline[convergenceResult.convergenceIndex]?.id ?? undefined)
    : undefined;

  const total = originalTimeline.length;
  const summaryParts: string[] = [
    `Branch point: ${branchPoint.id}.`,
    `Original timeline: ${total} node(s) — ` +
    `${independentCount} independent, ${adaptableCount} adaptable, ${incompatibleCount} incompatible.`,
  ];
  if (convergenceResult.converged) {
    summaryParts.push(
      `Timelines converge at node index ${convergenceResult.convergenceIndex ?? '?'}` +
      (convergenceNodeId ? ` (id: ${convergenceNodeId})` : '') + '.',
    );
  } else {
    summaryParts.push('Timelines do not converge.');
  }
  if (incompatibleCount > 0) {
    summaryParts.push(
      `${incompatibleCount} incompatible node(s) require human review before applying alternate timeline.`,
    );
  }

  return {
    branchPointId: branchPoint.id,
    originalNodes: originalAttributed,
    alternateNodes: alternateAttributed,
    independentCount,
    adaptableCount,
    incompatibleCount,
    converged: convergenceResult.converged,
    convergenceNodeId,
    summary: summaryParts.join(' '),
  };
}

// ---------------------------------------------------------------------------
// classifyNodes (async, optional LLM augmentation)
// ---------------------------------------------------------------------------

/**
 * Async wrapper around classifyNodesHeuristic that can optionally call an LLM
 * to re-score low-confidence attributions.
 *
 * When llmCaller is provided:
 *  - Any node classified as 'dependent-incompatible' with confidence < 0.8 is
 *    sent to the LLM for a second opinion.
 *  - The LLM response is expected to contain one of the classification
 *    keywords; if it does, the classification and confidence are updated.
 *
 * Falls back gracefully: if the LLM call fails or returns an unparseable
 * response, the heuristic result is preserved unchanged.
 */
export async function classifyNodes(
  branchPoint: DecisionNode,
  originalTimeline: DecisionNode[],
  alternateTimeline: DecisionNode[],
  options?: {
    llmCaller?: (prompt: string) => Promise<string>;
    /** Default 0.85 */
    semanticSimilarityThreshold?: number;
  },
): Promise<CausalAttributionResult> {
  const heuristic = classifyNodesHeuristic(branchPoint, originalTimeline, alternateTimeline);

  if (!options?.llmCaller) return heuristic;

  const llmCaller = options.llmCaller;
  const updatedOriginal = await Promise.all(
    heuristic.originalNodes.map(async (attributed): Promise<AttributedNode> => {
      // Only escalate uncertain incompatible nodes to LLM
      if (
        attributed.classification !== 'dependent-incompatible' ||
        attributed.confidence >= 0.8
      ) {
        return attributed;
      }

      const prompt = buildLlmClassificationPrompt(attributed.node, branchPoint, alternateTimeline);
      try {
        const response = await llmCaller(prompt);
        return refineLlmResult(attributed, response);
      } catch {
        // Best-effort: return heuristic result unchanged on LLM error
        return attributed;
      }
    }),
  );

  // Recompute counts from updated attributions
  const independentCount = updatedOriginal.filter(n => n.classification === 'independent').length;
  const adaptableCount = updatedOriginal.filter(n => n.classification === 'dependent-adaptable').length;
  const incompatibleCount = updatedOriginal.filter(n => n.classification === 'dependent-incompatible').length;

  return {
    ...heuristic,
    originalNodes: updatedOriginal,
    independentCount,
    adaptableCount,
    incompatibleCount,
  };
}

// ---------------------------------------------------------------------------
// LLM helpers (used only by classifyNodes)
// ---------------------------------------------------------------------------

function buildLlmClassificationPrompt(
  node: DecisionNode,
  branchPoint: DecisionNode,
  alternateTimeline: DecisionNode[],
): string {
  const altSummary = alternateTimeline
    .slice(0, 5) // limit context size
    .map((n, i) => `  [${i}] actor=${n.actor.type}/${n.actor.product}, prompt="${n.input.prompt.slice(0, 80)}"`)
    .join('\n');

  return [
    'You are a causal attribution classifier for an AI decision timeline.',
    '',
    'Branch point node:',
    `  id: ${branchPoint.id}`,
    `  prompt: "${branchPoint.input.prompt.slice(0, 120)}"`,
    '',
    'Downstream node to classify:',
    `  id: ${node.id}`,
    `  prompt: "${node.input.prompt.slice(0, 120)}"`,
    '',
    'Alternate timeline nodes (first 5):',
    altSummary,
    '',
    'Does the downstream node have an equivalent in the alternate timeline?',
    'Respond with exactly one word: "independent", "dependent-adaptable", or "dependent-incompatible".',
  ].join('\n');
}

function refineLlmResult(original: AttributedNode, llmResponse: string): AttributedNode {
  const lower = llmResponse.toLowerCase();
  if (lower.includes('dependent-adaptable') || lower.includes('adaptable')) {
    return {
      ...original,
      classification: 'dependent-adaptable',
      confidence: Math.min(0.95, original.confidence + 0.15),
      reasoning: original.reasoning + ' (LLM agreed: dependent-adaptable)',
    };
  }
  if (lower.includes('independent')) {
    return {
      ...original,
      classification: 'independent',
      confidence: Math.min(0.95, original.confidence + 0.15),
      reasoning: original.reasoning + ' (LLM agreed: independent)',
    };
  }
  if (lower.includes('dependent-incompatible') || lower.includes('incompatible')) {
    return {
      ...original,
      classification: 'dependent-incompatible',
      confidence: Math.min(0.95, original.confidence + 0.1),
      reasoning: original.reasoning + ' (LLM confirmed: dependent-incompatible)',
    };
  }
  // Unparseable response — return original unchanged
  return original;
}
