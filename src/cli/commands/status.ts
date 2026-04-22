// Status — convergence dashboard showing goal, dimensions, cost, OSS stats, next cycle plan.
// Reads: convergence.json, harvest-queue.json, GOAL.json, ADOPTION_QUEUE.md

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadConvergence,
  type ConvergenceState,
} from '../../core/convergence.js';
import {
  loadHarvestQueue,
  type HarvestQueue,
} from '../../core/harvest-queue.js';
import { type GoalConfig } from './set-goal.js';
import { type AdoptionCandidate } from './oss-intel.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DimensionStatus {
  name: string;
  score: number;
  targetScore: number;
  status: 'converged' | 'in-progress' | 'not-started';
  symbol: '✓' | '▷' | '✗';
}

export interface OssStats {
  reposExtracted: number;
  patternsExtracted: number;
  patternsAdopted: number;
  topSources: string[];
}

export interface CostAttribution {
  costPerPatternAdopted: number;
  costPerScorePoint: number;
  projectedCostToConvergence: number;
  projectedCyclesRemaining: number;
  /** Intelligence Compound Rate: score improvement per cycle × patterns per cycle. > 0.5 = compounding. */
  intelligenceCompoundRate: number;
}

export interface StatusReport {
  goal: GoalConfig | null;
  cyclesRun: number;
  totalCostUsd: number;
  budgetRemainingUsd: number;
  dimensions: DimensionStatus[];
  convergedCount: number;
  totalDimensions: number;
  ossStats: OssStats;
  nextCyclePlan: string[];
  stopReason?: string;
  costAttribution: CostAttribution;
}

export interface StatusOptions {
  cwd?: string;
  _loadConvergence?: (cwd?: string) => Promise<ConvergenceState>;
  _loadQueue?: (cwd?: string) => Promise<HarvestQueue>;
  _readGoal?: (cwd?: string) => Promise<GoalConfig | null>;
  _readAdoptionQueue?: (cwd?: string) => Promise<AdoptionCandidate[]>;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

// ── Default readers ───────────────────────────────────────────────────────────

async function defaultReadGoal(cwd?: string): Promise<GoalConfig | null> {
  try {
    const { loadGoal } = await import('./set-goal.js');
    return loadGoal(cwd);
  } catch {
    return null;
  }
}

async function defaultReadAdoptionQueue(cwd?: string): Promise<AdoptionCandidate[]> {
  try {
    const queuePath = path.join(getDanteforgeDir(cwd), 'ADOPTION_QUEUE.md');
    const content = await fs.readFile(queuePath, 'utf8');
    // Extract adoption names from markdown sections "## N. PatternName"
    const names: string[] = [];
    for (const match of content.matchAll(/^## \d+\.\s+(.+?)(?:\s+\(|$)/gm)) {
      const name = match[1]?.trim();
      if (name) names.push(name);
    }
    return names.slice(0, 3).map(name => ({
      patternName: name,
      category: '',
      sourceRepo: '',
      referenceImplementation: '',
      whatToBuild: '',
      filesToModify: [],
      estimatedEffort: '4h' as const,
      unlocksGapClosure: [],
      adoptionScore: 0,
    }));
  } catch {
    return [];
  }
}

// ── Dimension classification ──────────────────────────────────────────────────

function classifyDimension(
  d: ConvergenceState['dimensions'][number],
  targetScore: number,
): DimensionStatus {
  if (d.converged) {
    return { name: d.dimension, score: d.score, targetScore, status: 'converged', symbol: '✓' };
  }
  if (d.scoreHistory.length === 0) {
    return { name: d.dimension, score: d.score, targetScore, status: 'not-started', symbol: '✗' };
  }
  return { name: d.dimension, score: d.score, targetScore, status: 'in-progress', symbol: '▷' };
}

// ── Main entry ─────────────────────────────────────────────────────────────────

export async function status(opts: StatusOptions = {}): Promise<StatusReport> {
  const cwd = opts.cwd;
  const loadConv = opts._loadConvergence ?? loadConvergence;
  const loadQueue = opts._loadQueue ?? loadHarvestQueue;
  const readGoal = opts._readGoal ?? defaultReadGoal;
  const readAdoptionQueue = opts._readAdoptionQueue ?? defaultReadAdoptionQueue;

  // Load all data sources concurrently
  const [convergence, queue, goal, adoptionCandidates] = await Promise.all([
    loadConv(cwd),
    loadQueue(cwd).catch((): HarvestQueue => ({
      version: '1.0.0',
      repos: [],
      gaps: [],
      harvestCycles: 0,
      totalPatternsExtracted: 0,
      totalPatternsAdopted: 0,
      updatedAt: new Date().toISOString(),
    })),
    readGoal(cwd),
    readAdoptionQueue(cwd),
  ]);

  const dimensions = convergence.dimensions.map(d =>
    classifyDimension(d, convergence.targetScore),
  );

  const convergedCount = dimensions.filter(d => d.status === 'converged').length;
  const totalCostUsd = convergence.totalCostUsd;
  const dailyBudgetUsd = goal?.dailyBudgetUsd ?? 0;
  const budgetRemainingUsd = dailyBudgetUsd > 0
    ? Math.max(0, dailyBudgetUsd - totalCostUsd)
    : 0;

  // OSS stats from harvest queue
  const deepRepos = queue.repos.filter(r => r.status === 'deep' || r.status === 'exhausted');
  const topSources = deepRepos
    .sort((a, b) => b.patternsExtracted - a.patternsExtracted)
    .slice(0, 3)
    .map(r => r.slug);

  const ossStats: OssStats = {
    reposExtracted: deepRepos.length,
    patternsExtracted: queue.totalPatternsExtracted,
    patternsAdopted: queue.totalPatternsAdopted,
    topSources,
  };

  const nextCyclePlan = adoptionCandidates.slice(0, 3).map(c => c.patternName);

  const lastCycleRecord = convergence.cycleHistory[convergence.cycleHistory.length - 1];

  // ── Cost Attribution ───────────────────────────────────────────────────────
  const cyclesRun = convergence.lastCycle;
  const patternsAdopted = queue.totalPatternsAdopted;
  const ESTIMATED_COST_PER_CYCLE = 0.05; // USD default when no real cost data

  // Total score improvement across all cycles
  let totalScoreImprovement = 0;
  for (const record of convergence.cycleHistory) {
    const before = Object.values(record.scoresBefore);
    const after = Object.values(record.scoresAfter);
    if (before.length > 0 && after.length === before.length) {
      const avgBefore = before.reduce((a, b) => a + b, 0) / before.length;
      const avgAfter = after.reduce((a, b) => a + b, 0) / after.length;
      totalScoreImprovement += Math.max(0, avgAfter - avgBefore);
    }
  }

  const costPerPatternAdopted = patternsAdopted > 0
    ? totalCostUsd / patternsAdopted
    : (cyclesRun > 0 ? ESTIMATED_COST_PER_CYCLE : 0);

  const costPerScorePoint = totalScoreImprovement > 0
    ? totalCostUsd / totalScoreImprovement
    : (cyclesRun > 0 ? ESTIMATED_COST_PER_CYCLE / 0.5 : 0);

  // Estimate remaining cycles based on current avg score vs target
  const currentAvgScore = dimensions.length > 0
    ? dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length
    : 0;
  const targetScore = convergence.targetScore;
  const scoreGapRemaining = Math.max(0, targetScore - currentAvgScore);
  const scoreGainPerCycle = cyclesRun > 0 && totalScoreImprovement > 0
    ? totalScoreImprovement / cyclesRun
    : 0.3; // fallback estimate
  const projectedCyclesRemaining = scoreGainPerCycle > 0
    ? Math.ceil(scoreGapRemaining / scoreGainPerCycle)
    : 0;
  const costPerCycle = cyclesRun > 0
    ? totalCostUsd / cyclesRun
    : ESTIMATED_COST_PER_CYCLE;
  const projectedCostToConvergence = projectedCyclesRemaining * costPerCycle;

  // Intelligence Compound Rate: lazy import from chart to avoid circular dep
  let intelligenceCompoundRate = 0;
  try {
    const { computeCompoundRate } = await import('./chart.js');
    intelligenceCompoundRate = computeCompoundRate(convergence);
  } catch { /* best-effort */ }

  const costAttribution: CostAttribution = {
    costPerPatternAdopted,
    costPerScorePoint,
    projectedCostToConvergence,
    projectedCyclesRemaining,
    intelligenceCompoundRate,
  };

  return {
    goal,
    cyclesRun,
    totalCostUsd,
    budgetRemainingUsd,
    dimensions,
    convergedCount,
    totalDimensions: dimensions.length,
    ossStats,
    nextCyclePlan,
    stopReason: lastCycleRecord ? undefined : undefined,
    costAttribution,
  };
}

// ── ASCII dashboard renderer ──────────────────────────────────────────────────

export function renderStatus(report: StatusReport): string {
  const W = 60;
  const border = '═'.repeat(W);
  const line = (text: string) => `║  ${text.padEnd(W - 3)}║`;
  const divider = `╠${border}╣`;
  const lines: string[] = [];

  lines.push(`╔${border}╗`);
  lines.push(line('DANTEFORGE CONVERGENCE STATUS'));
  lines.push(divider);

  // Goal + budget row
  const goalLabel = report.goal?.category
    ? `Goal: ${report.goal.category.slice(0, 20)}`
    : 'Goal: (not set)';
  const budgetLabel = report.goal?.dailyBudgetUsd
    ? `Budget: $${report.totalCostUsd.toFixed(2)} / $${report.goal.dailyBudgetUsd.toFixed(2)}/day`
    : 'Budget: (not set)';
  lines.push(line(`${goalLabel.padEnd(28)} ${budgetLabel}`));

  const cyclesLabel = `Cycles: ${report.cyclesRun} run`;
  const costLabel = `Cost: $${report.totalCostUsd.toFixed(2)} total`;
  lines.push(line(`${cyclesLabel.padEnd(28)} ${costLabel}`));

  lines.push(divider);
  lines.push(line(`DIMENSIONS (${report.convergedCount}/${report.totalDimensions} converged)`));

  // Dimension rows
  if (report.dimensions.length === 0) {
    lines.push(line('  (no dimensions tracked — run harvest-forge to start)'));
  } else {
    for (const dim of report.dimensions) {
      const barWidth = 10;
      const filled = Math.round((dim.score / 10) * barWidth);
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      const statusLabel = dim.status === 'converged'
        ? 'CONVERGED'
        : `→ ${dim.targetScore.toFixed(1)}`;
      const nameShort = dim.name.slice(0, 18).padEnd(18);
      const row = `${dim.symbol} ${nameShort} ${bar} ${dim.score.toFixed(1)}  ${statusLabel}`;
      lines.push(line(row));
    }
  }

  lines.push(divider);
  lines.push(line('OSS HARVEST STATS'));
  lines.push(line(
    `Repos: ${report.ossStats.reposExtracted}   Patterns: ${report.ossStats.patternsExtracted}   Adopted: ${report.ossStats.patternsAdopted}`,
  ));
  if (report.ossStats.topSources.length > 0) {
    lines.push(line(`Top: ${report.ossStats.topSources.join(', ')}`));
  }

  lines.push(divider);
  lines.push(line('NEXT CYCLE PLAN'));
  if (report.nextCyclePlan.length === 0) {
    lines.push(line('  (run oss-intel to generate adoption queue)'));
  } else {
    report.nextCyclePlan.slice(0, 3).forEach((name, i) => {
      lines.push(line(`  ${i + 1}. ${name}`));
    });
  }

  lines.push(divider);
  lines.push(line('COST ATTRIBUTION'));
  const ca = report.costAttribution;
  lines.push(line(`  Cost per pattern adopted   : $${ca.costPerPatternAdopted.toFixed(2)}`));
  lines.push(line(`  Cost per score point gained: $${ca.costPerScorePoint.toFixed(2)}`));
  const projTarget = report.dimensions[0]?.targetScore ?? 9.0;
  lines.push(line(
    `  Projected cost to ${projTarget.toFixed(1)}      : $${ca.projectedCostToConvergence.toFixed(2)} (est. ${ca.projectedCyclesRemaining} more cycles)`,
  ));
  const icrDisplay = ca.intelligenceCompoundRate > 0
    ? `${ca.intelligenceCompoundRate.toFixed(2)}${ca.intelligenceCompoundRate >= 0.5 ? ' ↑ compounding' : ' → improving'}`
    : 'N/A';
  lines.push(line(`  Intelligence Compound Rate : ${icrDisplay}`));

  lines.push(`╚${border}╝`);

  return lines.join('\n');
}
