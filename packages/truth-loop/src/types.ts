import type { EvidenceBundle } from '@danteforge/evidence-chain';

export type ProofObject = EvidenceBundle<unknown>;

export type RunMode = 'sequential' | 'parallel';
export type Initiator = 'founder' | 'agent' | 'ci';
export type RunStatus = 'running' | 'complete' | 'stopped' | 'failed';

export interface Run {
  runId: string;
  projectId: string;
  repo: string;
  commit: string;
  startedAt: string;
  mode: RunMode;
  initiator: Initiator;
  objective: string;
  budgetEnvelopeId: string;
  endedAt?: string;
  status?: RunStatus;
}

export type ArtifactType =
  | 'repo_snapshot'
  | 'commit_diff'
  | 'test_result'
  | 'external_critique'
  | 'static_analysis'
  | 'forge_score'
  | 'human_note'
  | 'prompt_packet'
  | 'next_action';

export type ArtifactSource =
  | 'codex'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'repo'
  | 'tests'
  | 'human';

export type ClaimType =
  | 'mechanical'
  | 'repo'
  | 'architecture'
  | 'prediction'
  | 'preference'
  | 'strategic';

export interface Claim {
  claimId: string;
  type: ClaimType;
  text: string;
}

export interface Artifact {
  artifactId: string;
  runId: string;
  type: ArtifactType;
  source: ArtifactSource;
  createdAt: string;
  uri: string;
  hash: string;
  proof?: ProofObject;
  label?: string;
  claims?: Claim[];
}

export type EvidenceKind =
  | 'test_result'
  | 'file_inspection'
  | 'static_analysis'
  | 'benchmark'
  | 'hash_verification'
  | 'human_confirmation';

export type EvidenceStatus =
  | 'passed'
  | 'failed'
  | 'partial'
  | 'missing'
  | 'inconclusive'
  | 'unsupported';

export interface Evidence {
  evidenceId: string;
  runId: string;
  artifactId: string;
  kind: EvidenceKind;
  claimSupported: string;
  verificationMethod: string;
  status: EvidenceStatus;
  location?: string;
  hash?: string;
  proof?: ProofObject;
  claimId?: string;
}

export type Confidence = 'low' | 'medium-low' | 'medium' | 'medium-high' | 'high';

export type FinalStatus =
  | 'complete'
  | 'progress_real_but_not_done'
  | 'blocked'
  | 'escalated_to_human'
  | 'budget_stopped'
  | 'evidence_insufficient';

export interface Verdict {
  verdictId: string;
  runId: string;
  summary: string;
  score: number;
  confidence: Confidence;
  blockingGaps?: string[];
  unsupportedClaims?: string[];
  supportedClaims?: string[];
  contradictedClaims?: string[];
  opinionClaims?: string[];
  proof?: ProofObject;
  finalStatus: FinalStatus;
}

export type Priority = 'P0' | 'P1' | 'P2';

export type ActionType =
  | 'implementation_prompt'
  | 'targeted_test_request'
  | 'human_decision_request'
  | 'evidence_collection'
  | 'budget_extension_request';

export type Executor = 'codex' | 'claude_code' | 'kilo_code' | 'human';

export interface NextAction {
  nextActionId: string;
  runId: string;
  priority: Priority;
  actionType: ActionType;
  targetRepo: string;
  title: string;
  rationale: string;
  acceptanceCriteria: string[];
  recommendedExecutor: Executor;
  promptUri: string;
}

export type HardwareProfile =
  | 'rtx_4060_laptop'
  | 'rtx_3090_workstation'
  | 'cloud_runner'
  | 'ci_only';

export type StopPolicy =
  | 'stop_on_budget'
  | 'stop_on_unresolved_blocker'
  | 'stop_on_budget_or_unresolved_blocker';

export interface BudgetEnvelope {
  budgetEnvelopeId: string;
  runId: string;
  maxUsd: number;
  maxMinutes: number;
  maxCritics: number;
  executionMode: RunMode;
  parallelismAllowed: boolean;
  hardwareProfile: HardwareProfile;
  stopPolicy: StopPolicy;
}

export type Strictness = 'strict' | 'standard' | 'dev';

export interface ReconciledClaim {
  claim: Claim;
  status: EvidenceStatus | 'opinion' | 'contradicted' | 'supported';
  evidenceId?: string;
  reasoning: string;
}
