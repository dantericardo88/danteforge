// autonomy-loop-monitor.ts — tracks health of autonomous loops across cycles.
// Records per-cycle metrics, detects stalling/stuck patterns, emits structured reports.
// Pure functions — no IO, fully testable without injection seams.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CycleRecord {
  cycle: number;
  dimensionId: string;
  timestamp: string;
  patternsHarvested: number;
  forgeWaveSuccess: boolean;
  scoreBefore: number;
  scoreAfter: number;
  scoreDelta: number;
  errorMessage?: string;
}

export type LoopHealthStatus = 'HEALTHY' | 'STALLING' | 'STUCK' | 'RECOVERING';

export interface LoopHealthAssessment {
  status: LoopHealthStatus;
  cyclesAnalyzed: number;
  avgPatternsPerCycle: number;
  forgeSuccessRate: number;
  totalScoreDelta: number;
  stalledDimensions: string[];
  recommendation: string;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

const STALL_MIN_CYCLES = 2;
const STUCK_MIN_CYCLES = 3;
const STALL_DELTA_THRESHOLD = 0.05;
const MIN_HEALTHY_FORGE_RATE = 0.5;
const MIN_HEALTHY_PATTERN_AVG = 1;

// ── Pure analysis functions ───────────────────────────────────────────────────

export function assessLoopHealth(records: CycleRecord[]): LoopHealthAssessment {
  if (records.length === 0) {
    return {
      status: 'HEALTHY',
      cyclesAnalyzed: 0,
      avgPatternsPerCycle: 0,
      forgeSuccessRate: 1,
      totalScoreDelta: 0,
      stalledDimensions: [],
      recommendation: 'No cycles recorded yet — loop has not started.',
    };
  }

  const totalPatterns = records.reduce((s, r) => s + r.patternsHarvested, 0);
  const forgeSuccesses = records.filter(r => r.forgeWaveSuccess).length;
  const totalScoreDelta = records.reduce((s, r) => s + r.scoreDelta, 0);
  const avgPatternsPerCycle = totalPatterns / records.length;
  const forgeSuccessRate = forgeSuccesses / records.length;

  // Identify stalled dimensions: N+ consecutive cycles with delta < threshold
  const byDim = new Map<string, CycleRecord[]>();
  for (const r of records) {
    const list = byDim.get(r.dimensionId) ?? [];
    list.push(r);
    byDim.set(r.dimensionId, list);
  }

  const stalledDimensions: string[] = [];
  for (const [dimId, dimRecords] of byDim) {
    const recent = dimRecords.slice(-STUCK_MIN_CYCLES);
    if (recent.length >= STUCK_MIN_CYCLES && recent.every(r => Math.abs(r.scoreDelta) < STALL_DELTA_THRESHOLD)) {
      stalledDimensions.push(dimId);
    }
  }

  let status: LoopHealthStatus;
  if (stalledDimensions.length > 0 && records.length >= STUCK_MIN_CYCLES) {
    status = 'STUCK';
  } else if (
    forgeSuccessRate < MIN_HEALTHY_FORGE_RATE ||
    avgPatternsPerCycle < MIN_HEALTHY_PATTERN_AVG
  ) {
    const recentCount = Math.min(STALL_MIN_CYCLES, records.length);
    const recent = records.slice(-recentCount);
    const recentDelta = recent.reduce((s, r) => s + r.scoreDelta, 0);
    status = recentDelta > STALL_DELTA_THRESHOLD ? 'RECOVERING' : 'STALLING';
  } else {
    status = 'HEALTHY';
  }

  const recommendation = buildRecommendation(status, stalledDimensions, forgeSuccessRate, avgPatternsPerCycle);

  return {
    status,
    cyclesAnalyzed: records.length,
    avgPatternsPerCycle,
    forgeSuccessRate,
    totalScoreDelta,
    stalledDimensions,
    recommendation,
  };
}

function buildRecommendation(
  status: LoopHealthStatus,
  stalled: string[],
  forgeRate: number,
  patternAvg: number,
): string {
  switch (status) {
    case 'HEALTHY':
      return 'Loop is progressing normally. Continue current approach.';
    case 'RECOVERING':
      return 'Recent cycles show score progress despite low pattern counts. Monitor next 2 cycles.';
    case 'STALLING':
      if (patternAvg < MIN_HEALTHY_PATTERN_AVG) {
        return 'OSS harvest returning too few patterns. Check oss command connectivity and domain relevance.';
      }
      if (forgeRate < MIN_HEALTHY_FORGE_RATE) {
        return 'Forge waves failing frequently. Check magic command and LLM connectivity.';
      }
      return 'Loop stalling — consider switching dimension target or running autoresearch.';
    case 'STUCK':
      return `Dimensions stuck (no progress ${STUCK_MIN_CYCLES}+ cycles): ${stalled.join(', ')}. Trigger autoresearch or operator review.`;
  }
}

// ── Report formatter ──────────────────────────────────────────────────────────

export function formatLoopHealthReport(records: CycleRecord[], assessment: LoopHealthAssessment): string {
  const lines: string[] = [
    `Loop Health: ${assessment.status}`,
    `Cycles: ${assessment.cyclesAnalyzed} | Score delta: ${assessment.totalScoreDelta >= 0 ? '+' : ''}${assessment.totalScoreDelta.toFixed(2)}`,
    `Forge success rate: ${(assessment.forgeSuccessRate * 100).toFixed(0)}% | Avg patterns/cycle: ${assessment.avgPatternsPerCycle.toFixed(1)}`,
    `Recommendation: ${assessment.recommendation}`,
  ];

  if (records.length > 0) {
    lines.push('', 'Recent cycles:');
    for (const r of records.slice(-5)) {
      const delta = r.scoreDelta >= 0 ? `+${r.scoreDelta.toFixed(2)}` : r.scoreDelta.toFixed(2);
      const forge = r.forgeWaveSuccess ? '✓' : '✗';
      lines.push(`  [${r.cycle}] ${r.dimensionId} | forge:${forge} | patterns:${r.patternsHarvested} | Δ${delta}`);
    }
  }

  return lines.join('\n');
}

// ── Record builder ────────────────────────────────────────────────────────────

export function buildCycleRecord(opts: {
  cycle: number;
  dimensionId: string;
  patternsHarvested: number;
  forgeWaveSuccess: boolean;
  scoreBefore: number;
  scoreAfter: number;
  errorMessage?: string;
  timestamp?: string;
}): CycleRecord {
  return {
    cycle: opts.cycle,
    dimensionId: opts.dimensionId,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    patternsHarvested: opts.patternsHarvested,
    forgeWaveSuccess: opts.forgeWaveSuccess,
    scoreBefore: opts.scoreBefore,
    scoreAfter: opts.scoreAfter,
    scoreDelta: opts.scoreAfter - opts.scoreBefore,
    errorMessage: opts.errorMessage,
  };
}
