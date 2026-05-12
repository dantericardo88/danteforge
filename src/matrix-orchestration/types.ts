// Matrix Orchestration — shared types for PRD-MATRIX-ORCHESTRATION-V1
//
// This file is the locked contract between the four parallel tracks (Ingest,
// Analysis, Capacity, Runtime). All other modules under
// src/matrix-orchestration/ import from here; no track adds new fields without
// integration approval.
//
// Persistence convention: artifacts live under
//   .danteforge/matrix-orchestration/<artifact>.json
// see state-io.ts for the I/O helpers and ORCH_REPORT_PATHS below.

import type { Competitor, DimensionGraph } from '../matrix/types/dimension-graph.js';
import type { WorkGraph } from '../matrix/types/work-graph.js';

// ── Canonical paths ─────────────────────────────────────────────────────────

export const ORCH_DIR = '.danteforge/matrix-orchestration';

export const ORCH_REPORT_PATHS = {
  projectIntent:        `${ORCH_DIR}/project-intent.json`,
  competitiveUniverse:  `${ORCH_DIR}/competitive-universe.json`,
  socialSignal:         `${ORCH_DIR}/social-signal.json`,
  closedSourceProfiles: `${ORCH_DIR}/closed-source-profiles.json`,
  dimensionMatrix:      `${ORCH_DIR}/dimension-matrix.json`,
  currentStateScore:    `${ORCH_DIR}/current-state-score.json`,
  capacityReport:       `${ORCH_DIR}/capacity-report.json`,
  phaseAResult:         `${ORCH_DIR}/phase-a-result.json`,
  phaseARetrospective:  `${ORCH_DIR}/phase-a-retrospective.json`,
  phaseBPlan:           `${ORCH_DIR}/phase-b-plan.json`,
  phaseBResult:         `${ORCH_DIR}/phase-b-result.json`,
  finalReport:          `${ORCH_DIR}/final-report.md`,
  finalReportJson:      `${ORCH_DIR}/final-report.json`,
  thirdPartyNotices:    'THIRD_PARTY_NOTICES.md',
  learningState:        `${ORCH_DIR}/learning-state.json`,
  runState:             `${ORCH_DIR}/run-state.json`,
  auditLog:             `${ORCH_DIR}/audit-log.jsonl`,
} as const;

export type OrchReportName = keyof typeof ORCH_REPORT_PATHS;

// ── Project Intent (Phase 1.1) ──────────────────────────────────────────────

export type ProjectType =
  | 'cli_tool'
  | 'ide_extension'
  | 'agent_runtime'
  | 'saas'
  | 'internal_tool'
  | 'library'
  | 'web_app'
  | 'mobile_app'
  | 'other';

export type TargetUser =
  | 'developer'
  | 'non_technical'
  | 'both'
  | 'enterprise'
  | 'researcher'
  | 'specific_role';

export type ConstraintEmphasis =
  | 'security_critical'
  | 'performance_critical'
  | 'ux_critical'
  | 'integration_critical'
  | 'cost_critical'
  | 'compliance_critical';

export type FrontierTarget =
  | 'oss_frontier'
  | 'closed_source_frontier'
  | 'category_definer';

export interface ProjectIntent {
  /** Source PRD file path the intent was extracted from. */
  sourcePath: string;
  /** Project name. */
  projectName: string;
  /** Free-text one-sentence goal. */
  goal: string;
  /** Structured project type classification. */
  projectType: ProjectType;
  /** Primary target user. */
  targetUser: TargetUser;
  /** Optional sub-role detail when targetUser === 'specific_role'. */
  targetRoleDetail?: string;
  /** Key features (3-12 short descriptions). */
  keyFeatures: string[];
  /** Constraints emphasized in the PRD. */
  constraintEmphasis: ConstraintEmphasis[];
  /** Explicit non-goals — what the project will NOT compete on. */
  nonGoals: string[];
  /** Category-direct competitors, adjacent, research-adjacent boundaries. */
  competitiveCategoryBoundary: {
    direct: string[];          // category names the project directly competes in
    adjacent: string[];        // adjacent categories worth observing
    research: string[];        // research-adjacent observations
  };
  /** What "full potential" means for this project. */
  frontierFraming: {
    target: FrontierTarget;
    matchLeaderOn: string[];   // dimensions where matching the leader suffices
    exceedLeaderOn: string[];  // dimensions where we aim to exceed
    defineNewCategoryOn: string[]; // dimensions we aim to redefine
  };
  /** Extraction confidence 0..1. <0.6 should refuse to proceed. */
  confidence: number;
  /** ISO timestamp. */
  extractedAt: string;
}

// ── Competitive Universe (Phase 1.2) ────────────────────────────────────────

export type DiscoverySource =
  | 'github_search'
  | 'awesome_list'
  | 'reddit'
  | 'x'
  | 'hackernews'
  | 'existing_compete_matrix'
  | 'manual'
  | 'user_added';

export type RecommendedAction = 'harvest' | 'profile' | 'observe' | 'skip';

export interface UniverseEntry {
  id: string;
  name: string;
  /** OSS vs closed_source vs adjacent vs research vs unknown. */
  category: Competitor['category'];
  repoUrl?: string;
  homeUrl?: string;
  licenseHint?: string;
  /** Where this entry came from. */
  source: DiscoverySource;
  /** Search query / URL / thread that surfaced it. */
  provenanceUrl?: string;
  /** Discovery confidence 0..1. */
  confidence: number;
  /** What we plan to do with this entry. */
  recommendedAction: RecommendedAction;
  /** License classification from oss-researcher.classifyLicense. */
  licenseStatus?: 'allowed' | 'blocked' | 'unknown';
  /** Free-form note. */
  note?: string;
}

export interface CompetitiveUniverse {
  generatedAt: string;
  projectName: string;
  entries: UniverseEntry[];
  approvedByUser: boolean;
  approvedAt?: string;
}

// ── Social Signal (Phase 2.3) ───────────────────────────────────────────────

export type SocialSource = 'reddit' | 'x' | 'hackernews' | 'github_issues';
export type Sentiment = 'praise' | 'complaint' | 'neutral' | 'mixed';

export interface SocialSignalMention {
  competitorName: string;
  source: SocialSource;
  url?: string;
  excerpt: string;
  sentiment: Sentiment;
  /** Specific complaint or praise tag (e.g. "token_limit", "multi_file_context"). */
  topic?: string;
  capturedAt: string;
}

export interface SocialSignalAggregate {
  competitorName: string;
  totalMentions: number;
  praiseCount: number;
  complaintCount: number;
  topComplaints: { topic: string; count: number; examples: string[] }[];
  topPraises: { topic: string; count: number; examples: string[] }[];
  confidence: number;
}

export interface SocialSignalReport {
  generatedAt: string;
  enabled: boolean;
  /** Why social signal was skipped, if !enabled. */
  skippedReason?: string;
  mentions: SocialSignalMention[];
  aggregates: SocialSignalAggregate[];
}

// ── Closed-source profile (Phase 2.2) ───────────────────────────────────────

export interface ClosedSourceClaim {
  text: string;
  evidenceUrl?: string;
  confidence: number;
  /** Constitution rule: closed-source claims are 'inferred', not 'verified'. */
  claimType: 'inferred' | 'documented';
}

export interface ClosedSourceProfile {
  competitorId: string;
  competitorName: string;
  featureInventory: ClosedSourceClaim[];
  architecturalInferences: ClosedSourceClaim[];
  reportedStrengths: ClosedSourceClaim[];
  reportedWeaknesses: ClosedSourceClaim[];
  pricingContext?: string;
  generatedAt: string;
}

export interface ClosedSourceProfileReport {
  generatedAt: string;
  profiles: ClosedSourceProfile[];
}

// ── Dimension Matrix (Phase 2.4 + 2.5) ──────────────────────────────────────

export interface OrchestrationDimension {
  dimensionId: string;
  name: string;
  category: string;
  weight: number;             // 0.5..1.5
  rubric: {
    score5: string;
    score7: string;
    score9: string;
  };
  evidenceRequired: string[];
  currentScore: number;
  ossFrontierScore: number;
  closedFrontierScore: number;
  gapToOssFrontier: number;
  gapToClosedFrontier: number;
  /** Names of competitors that anchor each frontier. */
  ossFrontierLeader?: string;
  closedFrontierLeader?: string;
  /** Pain points from social signal that informed this dimension. */
  sourcedFromComplaints?: string[];
}

export interface OrchestrationDimensionMatrix {
  generatedAt: string;
  projectName: string;
  dimensions: OrchestrationDimension[];
  /** Overall current score (weighted average). */
  overallCurrentScore: number;
  /** Overall OSS-frontier score (weighted average). */
  overallOssFrontierScore: number;
  /** Overall closed-source-frontier score (weighted average). */
  overallClosedFrontierScore: number;
  /** Approved by user. */
  approvedByUser: boolean;
  approvedAt?: string;
  /** Backing Matrix Kernel DimensionGraph, if computed. */
  kernelDimensionGraph?: DimensionGraph;
}

// ── Capacity Report (Phase 3.1) ─────────────────────────────────────────────

export type ProviderId =
  | 'claude'
  | 'codex'
  | 'dantecode'
  | 'aider'
  | 'cursor'
  | 'ollama'
  | 'fake'
  | 'shell';

export type AuthStatus = 'authenticated' | 'unauthenticated' | 'unknown';

export interface ProviderCapacity {
  providerId: ProviderId;
  installed: boolean;
  authStatus: AuthStatus;
  /** Practical concurrent instances on this machine. */
  concurrentInstances: number;
  /** Average latency in ms during the benchmark. */
  benchmarkLatencyMs?: number;
  /** Why concurrency was constrained (RAM, CPU, network, manual override). */
  constraintReason?: string;
  /** Per-1k-token cost estimate (USD). 0 for local. */
  costPerKTokenUsd?: number;
}

export interface CapacityReport {
  generatedAt: string;
  hostMachineSignature: string; // hash of node version + platform + arch + cpu count
  providers: ProviderCapacity[];
  totalPracticalConcurrency: number;
  benchmarkDurationMs: number;
  /** User override applied. */
  userOverride?: Partial<Record<ProviderId, number>>;
}

// ── Phase Execution (Phase 3.2 + 3.4) ───────────────────────────────────────

export type PhaseType = 'phase_a_oss_frontier' | 'phase_b_closed_source_frontier';

export interface PhaseExecutionConfig {
  phase: PhaseType;
  /** Work packets queued for this phase, by id. */
  workPacketIds: string[];
  /** Maximum LLM spend across the phase. */
  maxCostUsd: number;
  /** Wall-clock budget in minutes. */
  maxWallClockMinutes: number;
  /** Concurrent agent cap (cannot exceed capacity report's totalPracticalConcurrency). */
  maxConcurrentAgents: number;
  /** Allowed providers; subset of capacity report. */
  allowedProviders: ProviderId[];
  /** Red Team gate on every merge (forced true for phase B). */
  redTeamEveryMerge: boolean;
  /** Taste Gate threshold (0-10) — only invoked when packet's tasteGateRequired. */
  tasteGateMinScore: number;
}

export interface PhaseAttempt {
  workPacketId: string;
  providerId: ProviderId;
  outcome: 'merged' | 'rejected_by_verification' | 'rejected_by_red_team'
         | 'rejected_by_taste_gate' | 'rejected_by_merge_court' | 'errored' | 'skipped';
  scoreDeltaByDimension?: Record<string, number>;
  tokensConsumed: number;
  costUsd: number;
  wallClockMs: number;
  startedAt: string;
  completedAt: string;
  rejectionReason?: string;
}

export interface PhaseExecutionResult {
  phase: PhaseType;
  config: PhaseExecutionConfig;
  attempts: PhaseAttempt[];
  /** Dimensions that reached their phase's frontier. */
  dimensionsClosed: string[];
  /** Dimensions that still have gap remaining. */
  dimensionsOpen: string[];
  totalCostUsd: number;
  totalWallClockMs: number;
  startedAt: string;
  completedAt: string;
  /** Backing Matrix Kernel WorkGraph that was executed. */
  kernelWorkGraph?: WorkGraph;
  /** Reason for early termination, if any. */
  terminationReason?: 'completed' | 'budget_exhausted' | 'time_exhausted'
                    | 'user_cancelled' | 'red_team_meltdown';
}

// ── Inter-phase retrospective (Phase 3.3) ───────────────────────────────────

export interface ProviderPerformanceNote {
  providerId: ProviderId;
  attempts: number;
  successRate: number;        // 0..1
  avgCostUsd: number;
  avgWallClockMs: number;
  bestAtDimensions: string[];
  worstAtDimensions: string[];
}

export interface InterPhaseRetrospective {
  generatedAt: string;
  phaseAResult: PhaseExecutionResult;
  providerPerformance: ProviderPerformanceNote[];
  recurringConflictPatterns: string[];
  remainingGapToClosedSourceFrontier: number;
  recommendation: 'proceed_to_phase_b' | 'pause_for_user_input' | 'stop';
  recommendationReason: string;
}

// ── Final Report (Phase 4.1) ────────────────────────────────────────────────

export interface FinalReportSummary {
  generatedAt: string;
  projectName: string;
  prdSource: string;
  startingOverallScore: number;
  endingOverallScore: number;
  ossFrontierAchievement: number;        // 0..1
  closedSourceFrontierAchievement: number; // 0..1; 0 if Phase B not run
  totalAgentsDeployed: number;
  totalCostUsd: number;
  totalWallClockMs: number;
  conflictsEncountered: number;
  conflictsResolved: number;
  branchesApproved: number;
  branchesRejected: number;
  patternsHarvestedCount: number;
  licenseViolations: number;
  recommendedNextIterations: string[];
}

// ── Learning Loop (Phase 4.2) ───────────────────────────────────────────────

export interface LearningState {
  version: 1;
  updatedAt: string;
  /** Cumulative provider performance across runs. */
  providerPerformance: Record<ProviderId, {
    runs: number;
    totalAttempts: number;
    totalSuccesses: number;
    avgCostUsd: number;
    avgWallClockMs: number;
    excelsAt: string[];        // dimension category names
  }>;
  /** Dimension pairs that keep colliding. */
  recurringConflicts: { dimensionA: string; dimensionB: string; occurrences: number }[];
  /** OSS sources that produced high-value patterns. */
  successfulHarvestSources: { repoUrl: string; patternsExtracted: number; averageScoreLift: number }[];
  /** OSS sources that produced low-value patterns; avoid in future runs. */
  failedHarvestSources: { repoUrl: string; reason: string }[];
  /** Time-cost estimates per dimension category, in USD per dim closed. */
  costEstimates: Record<string, { avgCostUsd: number; sampleSize: number }>;
}

// ── Top-level run state (orchestrator state machine) ────────────────────────

export type OrchestrationStage =
  | 'not_started'
  | 'reading_prd'
  | 'discovering_universe'
  | 'analyzing_competitors'
  | 'synthesizing_dimensions'
  | 'scoring_current_state'
  | 'detecting_capacity'
  | 'executing_phase_a'
  | 'inter_phase_retro'
  | 'executing_phase_b'
  | 'generating_final_report'
  | 'completed'
  | 'paused'
  | 'errored';

export interface RunState {
  runId: string;
  startedAt: string;
  updatedAt: string;
  prdPath: string;
  target: FrontierTarget;
  stage: OrchestrationStage;
  /** Stages already complete (idempotent resume). */
  completedStages: OrchestrationStage[];
  /** Live counters. */
  costSpentUsd: number;
  /** Last error encountered when stage === 'errored'. */
  lastError?: string;
  /** User overrides supplied via CLI flags. */
  overrides: {
    maxAgents?: number;
    maxCostUsd?: number;
    providers?: ProviderId[];
    skipApproval?: boolean;
    socialSignalEnabled?: boolean;
  };
}

// ── Audit log entry (append-only) ───────────────────────────────────────────

export type AuditEventKind =
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
  | 'user_approval'
  | 'user_rejection'
  | 'cost_warning'
  | 'license_violation_blocked'
  | 'capacity_constraint'
  | 'phase_attempt_outcome';

export interface AuditEvent {
  ts: string;
  runId: string;
  kind: AuditEventKind;
  stage?: OrchestrationStage;
  payload?: Record<string, unknown>;
}

// ── Orchestrator options (used by orchestrator.ts) ──────────────────────────

export interface OrchestratorOptions {
  cwd: string;
  prdPath: string;
  target?: FrontierTarget;        // default 'closed_source_frontier'
  maxAgents?: number;
  maxCostUsd?: number;            // default 200
  providers?: ProviderId[];
  skipApproval?: boolean;         // default false; --skip-approval flag
  socialSignalEnabled?: boolean;  // default false in v1
  /** Output mode: --prompt copy-paste vs LLM API vs local fallback. */
  mode?: 'llm' | 'prompt' | 'local';
  /** Injection seams for testing. */
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _now?: () => string;            // for deterministic timestamps in tests
  _confirm?: (msg: string) => Promise<boolean>;
}
