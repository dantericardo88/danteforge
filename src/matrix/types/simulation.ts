// Matrix Kernel — Simulation Plan + Safe Parallelism (PRD §12, §13)

export interface SimulationWave {
  waveNumber: number;
  description: string;
  workPacketIds: string[];
  estimatedDurationMinutes: number;
  estimatedTokens: number;
  estimatedUsdLow: number;
  estimatedUsdHigh: number;
  /** Why this wave was grouped together. */
  rationale: string[];
}

export interface SafeParallelismResult {
  requestedAgents: number;
  safeAgentsNow: number;
  recommendedWaveSize: number;
  blockedWorkPackets: number;
  highConflictPackets: number;
  sequentialOnlyPackets: number;
  /** Human-readable reasoning per decision point. */
  reasoning: string[];
}

export interface RiskSummary {
  highestRiskAreas: string[];     // file paths or module IDs
  sequentialBottlenecks: string[];
  predictedConflicts: number;
  requiredHumanApprovals: number;
}

export interface SimulationPlan {
  generatedAt: string;
  waves: SimulationWave[];
  safeParallelism: SafeParallelismResult;
  riskSummary: RiskSummary;
  /** Reports expected to be generated when the plan executes. */
  expectedReports: string[];
  /** Total cost ceiling if everything runs to completion. */
  totalEstimatedTokens: number;
  totalEstimatedUsdLow: number;
  totalEstimatedUsdHigh: number;
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isSimulationWave(value: unknown): value is SimulationWave {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.waveNumber === 'number'
    && typeof v.description === 'string'
    && Array.isArray(v.workPacketIds)
    && Array.isArray(v.rationale);
}

export function isSafeParallelismResult(value: unknown): value is SafeParallelismResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.requestedAgents === 'number'
    && typeof v.safeAgentsNow === 'number'
    && typeof v.recommendedWaveSize === 'number'
    && Array.isArray(v.reasoning);
}

export function isSimulationPlan(value: unknown): value is SimulationPlan {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.waves) && v.waves.every(isSimulationWave)
    && isSafeParallelismResult(v.safeParallelism);
}
