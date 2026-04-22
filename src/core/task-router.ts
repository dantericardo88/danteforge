// 3-Tier Task Router — routes tasks to local, light, or heavy LLM tiers
// based on complexity heuristics derived from task signatures.
import { estimateTokens, estimateCost } from './token-estimator.js';
import type { LLMProvider } from './config.js';
import type { DanteState } from './state.js';
import type { MagicLevel } from './magic-presets.js';

export type TaskTier = 'local' | 'light' | 'heavy';

export interface RoutingDecision {
  tier: TaskTier;
  model: string | null;
  reason: string;
  estimatedCostUsd: number;
  estimatedTokens: { input: number; output: number };
}

export interface TaskSignature {
  taskType: 'transform' | 'generate' | 'review' | 'architect' | 'verify';
  fileCount: number;
  totalLinesChanged: number;
  hasTestRequirement: boolean;
  hasArchitecturalDecision: boolean;
  hasSecurityImplication: boolean;
  complexityScore: number;
}

export interface TaskRouterConfig {
  localThreshold: number;
  lightThreshold: number;
  lightModel: string;
  heavyModel: string;
}

const LOW_COMPLEXITY_KEYWORDS = ['rename', 'import', 'format', 'type', 'const', 'fix-import'];
const HIGH_COMPLEXITY_KEYWORDS = ['architect', 'design', 'security', 'refactor', 'authentication', 'api', 'module'];

const TASK_TYPE_BASE_SCORES: Record<TaskSignature['taskType'], number> = {
  transform: 10,
  generate: 30,
  review: 20,
  architect: 50,
  verify: 15,
};

function inferTaskType(name: string): TaskSignature['taskType'] {
  const lower = name.toLowerCase();
  if (lower.includes('architect') || lower.includes('design')) return 'architect';
  if (lower.includes('review') || lower.includes('audit')) return 'review';
  if (lower.includes('verify') || lower.includes('test') || lower.includes('check')) return 'verify';
  if (lower.includes('generate') || lower.includes('create') || lower.includes('implement')) return 'generate';
  return 'transform';
}

function computeComplexityScore(
  name: string,
  fileCount: number,
  hasTestRequirement: boolean,
  hasArchitecturalDecision: boolean,
  hasSecurityImplication: boolean,
): number {
  const lower = name.toLowerCase();
  const taskType = inferTaskType(lower);
  let score = TASK_TYPE_BASE_SCORES[taskType];

  const matchesLow = LOW_COMPLEXITY_KEYWORDS.some(kw => lower.includes(kw));
  const matchesHigh = HIGH_COMPLEXITY_KEYWORDS.some(kw => lower.includes(kw));

  if (matchesLow && !matchesHigh) {
    score = Math.max(score - 15, 0);
  }
  if (matchesHigh) {
    score += 20;
  }

  // File count contribution: each file adds 3 points, capped at 30
  score += Math.min(fileCount * 3, 30);

  if (hasTestRequirement) score += 5;
  if (hasArchitecturalDecision) score += 10;
  if (hasSecurityImplication) score += 10;

  return Math.min(Math.max(score, 0), 100);
}

/**
 * Classify a task from DanteState into a TaskSignature using keyword heuristics.
 */
export function classifyTaskSignature(
  task: { name: string; files?: string[]; verify?: string },
  state: DanteState,
): TaskSignature {
  const name = task.name;
  const lower = name.toLowerCase();
  const fileCount = task.files?.length ?? 0;

  const hasTestRequirement = typeof task.verify === 'string' && task.verify.length > 0;
  const hasArchitecturalDecision = HIGH_COMPLEXITY_KEYWORDS.some(
    kw => kw === 'architect' || kw === 'design' || kw === 'module'
      ? lower.includes(kw)
      : false,
  );
  const hasSecurityImplication = lower.includes('security') || lower.includes('authentication')
    || lower.includes('auth') || lower.includes('credential');

  // Estimate lines changed: ~50 lines per file as a reasonable heuristic
  const totalLinesChanged = fileCount * 50;

  const complexityScore = computeComplexityScore(
    name,
    fileCount,
    hasTestRequirement,
    hasArchitecturalDecision,
    hasSecurityImplication,
  );

  const taskType = inferTaskType(lower);

  return {
    taskType,
    fileCount,
    totalLinesChanged,
    hasTestRequirement,
    hasArchitecturalDecision,
    hasSecurityImplication,
    complexityScore,
  };
}

/**
 * Pure routing function: maps a TaskSignature to a RoutingDecision based on config thresholds.
 */
export function routeTask(
  signature: TaskSignature,
  config?: Partial<TaskRouterConfig>,
  provider?: LLMProvider,
): RoutingDecision {
  const resolved = { ...getDefaultRouterConfig(), ...config };
  const score = signature.complexityScore;

  // Estimate tokens: ~4 tokens per line changed for input
  const inputTokens = Math.max(signature.totalLinesChanged * 4, 100);
  const outputTokens = Math.ceil(inputTokens * 0.25);
  const costProvider: LLMProvider = provider ?? 'claude';

  if (score < resolved.localThreshold) {
    return {
      tier: 'local',
      model: null,
      reason: `Complexity score ${score} below local threshold ${resolved.localThreshold} — handled locally without LLM`,
      estimatedCostUsd: 0,
      estimatedTokens: { input: 0, output: 0 },
    };
  }

  if (score < resolved.lightThreshold) {
    const cost = estimateCost(inputTokens, costProvider);
    return {
      tier: 'light',
      model: resolved.lightModel,
      reason: `Complexity score ${score} between local (${resolved.localThreshold}) and light (${resolved.lightThreshold}) thresholds — using ${resolved.lightModel}`,
      estimatedCostUsd: cost.totalEstimate,
      estimatedTokens: { input: inputTokens, output: outputTokens },
    };
  }

  const cost = estimateCost(inputTokens, costProvider);
  return {
    tier: 'heavy',
    model: resolved.heavyModel,
    reason: `Complexity score ${score} at or above light threshold ${resolved.lightThreshold} — using ${resolved.heavyModel}`,
    estimatedCostUsd: cost.totalEstimate,
    estimatedTokens: { input: inputTokens, output: outputTokens },
  };
}

/**
 * Map a MagicLevel preset to a TaskRouterConfig with calibrated thresholds.
 * Higher-intensity presets lower the thresholds so more tasks route to LLMs.
 */
export function getRouterConfigForPreset(level: MagicLevel): TaskRouterConfig {
  const presets: Record<MagicLevel, Pick<TaskRouterConfig, 'localThreshold' | 'lightThreshold'>> = {
    spark:   { localThreshold: 30, lightThreshold: 60 },
    ember:   { localThreshold: 25, lightThreshold: 55 },
    canvas:  { localThreshold: 12, lightThreshold: 35 },
    magic:   { localThreshold: 15, lightThreshold: 45 },
    blaze:   { localThreshold: 10, lightThreshold: 35 },
    nova:    { localThreshold: 8,  lightThreshold: 25 },
    inferno: { localThreshold: 5,  lightThreshold: 15 },
  };

  const thresholds = presets[level];
  return {
    localThreshold: thresholds.localThreshold,
    lightThreshold: thresholds.lightThreshold,
    lightModel: 'haiku',
    heavyModel: 'sonnet',
  };
}

/**
 * Returns the default router configuration (matches the 'magic' preset).
 */
export function getDefaultRouterConfig(): TaskRouterConfig {
  return {
    localThreshold: 15,
    lightThreshold: 45,
    lightModel: 'haiku',
    heavyModel: 'sonnet',
  };
}
