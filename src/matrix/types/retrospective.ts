// Matrix Kernel — Retrospective + Final Run Report types (PRD §23, §26)

export interface ProviderPerformance {
  provider: string;
  runsAttempted: number;
  runsSucceeded: number;
  runsFailed: number;
  avgTokensPerRun: number;
  avgRuntimeMinutes: number;
  conflictsCaused: number;
  redTeamFailures: number;
}

export interface ConflictPattern {
  pattern: string;               // e.g. "lease overlap on src/matrix/leases/**"
  occurrences: number;
  affectedAreas: string[];
  recommendedMitigation: string;
}

export interface GateEffectiveness {
  gateName: string;
  triggered: number;
  caughtIssues: number;
  falsePositives: number;
  missedIssues?: number;         // discovered post-merge
}

export interface MatrixRetrospective {
  runId: string;
  generatedAt: string;
  startedAt: string;
  completedAt: string;

  bestPerformingProvider: string;
  highestConflictArea: string;
  mostReliableGate: string;
  weakestGate: string;
  mergeBottleneck: string;

  providerPerformance: ProviderPerformance[];
  conflictPatterns: ConflictPattern[];
  gateEffectiveness: GateEffectiveness[];
  highRiskFiles: string[];

  recommendedNextRunChanges: string[];
}

// ── Final Run Report (PRD §26) ──────────────────────────────────────────────

export interface MatrixRunReport {
  runId: string;
  startedAt: string;
  completedAt: string;

  startingScore: number;
  endingScore: number;
  dimensionsImproved: string[];

  workPacketsCreated: number;
  agentsRan: number;
  conflictsPredicted: number;
  conflictsHappened: number;
  branchesRejected: number;
  branchesMerged: number;
  branchesRolledBack: number;

  reportPaths: {
    projectGraph?: string;
    dimensionGraph?: string;
    workGraph?: string;
    dependencyGraph?: string;
    leaseGraph?: string;
    evidenceGraph?: string;
    simulationPlan?: string;
    conflicts?: string;
    gateReports?: string;
    redTeamReports?: string;
    tasteGates?: string;
    mergeDecisions?: string;
    retrospective?: string;
    finalReport?: string;
  };

  proofExists: boolean;
  nextSteps: string[];
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isMatrixRetrospective(value: unknown): value is MatrixRetrospective {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.runId === 'string'
    && Array.isArray(v.providerPerformance)
    && Array.isArray(v.conflictPatterns)
    && Array.isArray(v.gateEffectiveness)
    && Array.isArray(v.recommendedNextRunChanges);
}

export function isMatrixRunReport(value: unknown): value is MatrixRunReport {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.runId === 'string'
    && typeof v.startingScore === 'number'
    && typeof v.endingScore === 'number'
    && Array.isArray(v.dimensionsImproved);
}
