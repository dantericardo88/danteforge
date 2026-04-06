// Execution telemetry — captures tool calls, commands, and file mutations during agent execution
// Harvested from Reflection-3.ts (OpenCode plugin) — adapted for DanteForge's wave executor

import fs from 'fs/promises';
import path from 'path';

export interface ToolCallEntry {
  name: string;
  timestamp: number;
  isWrite: boolean;
}

export interface ExecutionTelemetry {
  toolCalls: ToolCallEntry[];
  bashCommands: string[];
  filesModified: string[];
  duration: number;
  tokenEstimate: number;
}

const WRITE_TOOL_PATTERNS = /^(edit|write|apply_patch|create|delete|mv|cp|rename)/i;
const WRITE_BASH_PATTERNS = /\b(git\s+(commit|push|merge|rebase|cherry-pick)|npm\s+(publish|run\s+build)|tsc|tsup|rm\s|mv\s|cp\s)\b/;

export function createTelemetry(): ExecutionTelemetry {
  return {
    toolCalls: [],
    bashCommands: [],
    filesModified: [],
    duration: 0,
    tokenEstimate: 0,
  };
}

export function recordToolCall(t: ExecutionTelemetry, name: string, isWrite?: boolean): void {
  const classified = isWrite ?? WRITE_TOOL_PATTERNS.test(name);
  t.toolCalls.push({ name, timestamp: Date.now(), isWrite: classified });
}

export function recordBashCommand(t: ExecutionTelemetry, cmd: string): void {
  t.bashCommands.push(cmd);
  if (WRITE_BASH_PATTERNS.test(cmd)) {
    t.toolCalls.push({ name: `bash:${cmd.slice(0, 40)}`, timestamp: Date.now(), isWrite: true });
  }
}

export function recordFileModified(t: ExecutionTelemetry, filePath: string): void {
  if (!t.filesModified.includes(filePath)) {
    t.filesModified.push(filePath);
  }
}

export function summarizeTelemetry(t: ExecutionTelemetry): string {
  const reads = t.toolCalls.filter(tc => !tc.isWrite).length;
  const writes = t.toolCalls.filter(tc => tc.isWrite).length;
  const lines: string[] = [
    `Duration: ${(t.duration / 1000).toFixed(1)}s`,
    `Tool calls: ${t.toolCalls.length} (${reads} reads, ${writes} writes)`,
    `Bash commands: ${t.bashCommands.length}`,
    `Files modified: ${t.filesModified.length}`,
  ];
  if (t.tokenEstimate > 0) {
    lines.push(`Token estimate: ~${t.tokenEstimate.toLocaleString()}`);
  }
  return lines.join('\n');
}

// ─── Budget Fences & Token Cost Tracking (v0.9.0 Wave 3) ────────────────────

export interface BudgetFence {
  agentRole: string;
  maxBudgetUsd: number;
  currentSpendUsd: number;
  isExceeded: boolean;
  warningThresholdPercent: number;
}

export interface WaveBudget {
  totalBudgetUsd: number;
  perAgentBudgets: Record<string, number>;
  estimatedTotalCost: number;
  actualTotalCost: number;
}

export interface TokenReport {
  sessionId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byAgent: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; callCount: number }>;
  byTier: Record<string, { callCount: number; totalTokens: number; costUsd: number }>;
  byModel: Record<string, { callCount: number; totalTokens: number; costUsd: number }>;
  savedByLocalTransforms: { callCount: number; estimatedSavedTokens: number; estimatedSavedUsd: number };
  savedByCompression: { originalTokens: number; compressedTokens: number; savedPercent: number };
  savedByGates: { blockedCallCount: number; estimatedSavedTokens: number };
  timestamp: string;
}

export interface ExtendedTelemetry extends ExecutionTelemetry {
  tokenUsageRecords: Array<{
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    agentRole?: string;
    tier?: string;
    model?: string;
  }>;
  localTransformSavings: { callCount: number; estimatedSavedTokens: number; estimatedSavedUsd: number };
  compressionSavings: { originalTokens: number; compressedTokens: number };
  gateBlockSavings: { blockedCallCount: number; estimatedSavedTokens: number };
}

export function createExtendedTelemetry(): ExtendedTelemetry {
  return {
    ...createTelemetry(),
    tokenUsageRecords: [],
    localTransformSavings: { callCount: 0, estimatedSavedTokens: 0, estimatedSavedUsd: 0 },
    compressionSavings: { originalTokens: 0, compressedTokens: 0 },
    gateBlockSavings: { blockedCallCount: 0, estimatedSavedTokens: 0 },
  };
}

export function createBudgetFence(
  agentRole: string,
  maxBudgetUsd: number,
  warningThresholdPercent: number = 80,
): BudgetFence {
  return {
    agentRole,
    maxBudgetUsd,
    currentSpendUsd: 0,
    isExceeded: false,
    warningThresholdPercent,
  };
}

export function checkBudgetFence(fence: BudgetFence): { proceed: boolean; warning?: string } {
  if (fence.isExceeded) {
    return {
      proceed: false,
      warning: `Budget exceeded for agent "${fence.agentRole}": spent ${fence.currentSpendUsd.toFixed(4)} / ${fence.maxBudgetUsd.toFixed(4)} USD`,
    };
  }
  const usedPercent = fence.maxBudgetUsd > 0
    ? (fence.currentSpendUsd / fence.maxBudgetUsd) * 100
    : 0;
  if (usedPercent >= fence.warningThresholdPercent) {
    return {
      proceed: true,
      warning: `Agent "${fence.agentRole}" at ${usedPercent.toFixed(1)}% of budget (${fence.currentSpendUsd.toFixed(4)} / ${fence.maxBudgetUsd.toFixed(4)} USD)`,
    };
  }
  return { proceed: true };
}

export function updateBudgetFence(fence: BudgetFence, spendUsd: number): BudgetFence {
  const newSpend = fence.currentSpendUsd + spendUsd;
  return {
    ...fence,
    currentSpendUsd: newSpend,
    isExceeded: newSpend >= fence.maxBudgetUsd,
  };
}

export function recordTokenUsage(
  t: ExtendedTelemetry,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  agentRole?: string,
  tier?: string,
  model?: string,
): void {
  t.tokenUsageRecords.push({ inputTokens, outputTokens, costUsd, agentRole, tier, model });
  t.tokenEstimate += inputTokens + outputTokens;
}

export function recordLocalTransformSavings(
  t: ExtendedTelemetry,
  estimatedSavedTokens: number,
  estimatedSavedUsd: number,
): void {
  t.localTransformSavings.callCount += 1;
  t.localTransformSavings.estimatedSavedTokens += estimatedSavedTokens;
  t.localTransformSavings.estimatedSavedUsd += estimatedSavedUsd;
}

export function recordCompressionSavings(
  t: ExtendedTelemetry,
  originalTokens: number,
  compressedTokens: number,
): void {
  t.compressionSavings.originalTokens += originalTokens;
  t.compressionSavings.compressedTokens += compressedTokens;
}

export function recordGateBlock(t: ExtendedTelemetry, estimatedSavedTokens: number): void {
  t.gateBlockSavings.blockedCallCount += 1;
  t.gateBlockSavings.estimatedSavedTokens += estimatedSavedTokens;
}

export function generateTokenReport(t: ExtendedTelemetry, sessionId: string): TokenReport {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  const byAgent: TokenReport['byAgent'] = {};
  const byTier: TokenReport['byTier'] = {};
  const byModel: TokenReport['byModel'] = {};

  for (const record of t.tokenUsageRecords) {
    totalInputTokens += record.inputTokens;
    totalOutputTokens += record.outputTokens;
    totalCostUsd += record.costUsd;

    const agentKey = record.agentRole ?? 'unknown';
    if (!byAgent[agentKey]) {
      byAgent[agentKey] = { inputTokens: 0, outputTokens: 0, costUsd: 0, callCount: 0 };
    }
    byAgent[agentKey].inputTokens += record.inputTokens;
    byAgent[agentKey].outputTokens += record.outputTokens;
    byAgent[agentKey].costUsd += record.costUsd;
    byAgent[agentKey].callCount += 1;

    const tierKey = record.tier ?? 'default';
    if (!byTier[tierKey]) {
      byTier[tierKey] = { callCount: 0, totalTokens: 0, costUsd: 0 };
    }
    byTier[tierKey].callCount += 1;
    byTier[tierKey].totalTokens += record.inputTokens + record.outputTokens;
    byTier[tierKey].costUsd += record.costUsd;

    const modelKey = record.model ?? 'unknown';
    if (!byModel[modelKey]) {
      byModel[modelKey] = { callCount: 0, totalTokens: 0, costUsd: 0 };
    }
    byModel[modelKey].callCount += 1;
    byModel[modelKey].totalTokens += record.inputTokens + record.outputTokens;
    byModel[modelKey].costUsd += record.costUsd;
  }

  const compOriginal = t.compressionSavings.originalTokens;
  const compCompressed = t.compressionSavings.compressedTokens;
  const savedPercent = compOriginal > 0
    ? ((compOriginal - compCompressed) / compOriginal) * 100
    : 0;

  return {
    sessionId,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    byAgent,
    byTier,
    byModel,
    savedByLocalTransforms: { ...t.localTransformSavings },
    savedByCompression: {
      originalTokens: compOriginal,
      compressedTokens: compCompressed,
      savedPercent,
    },
    savedByGates: { ...t.gateBlockSavings },
    timestamp: new Date().toISOString(),
  };
}

export async function persistTokenReport(report: TokenReport, cwd?: string): Promise<string> {
  const base = cwd ?? process.cwd();
  const reportsDir = path.join(base, '.danteforge', 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const safeTimestamp = report.timestamp.replace(/[:.]/g, '-');
  const filename = `cost-${safeTimestamp}.json`;
  const filePath = path.join(reportsDir, filename);
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}
