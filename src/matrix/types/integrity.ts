// integrity.ts — Types for the completion-integrity audit system.
// Scores must be traceable to specific artifacts. Code without a receipt is a hypothesis.

export type CapabilityStatus =
  | 'verified'           // E2E proven with realistic inputs, no material placeholders
  | 'partially-verified' // some real evidence, but coverage is incomplete
  | 'structural'         // code exists and compiles, but not proven to execute the claimed path
  | 'claimed'            // described in docs or comments, no verification found
  | 'missing';           // no meaningful implementation exists

export type EvidenceLevel =
  | 'missing'            // → cap 1
  | 'docs-only'          // → cap 3
  | 'code-exists'        // → cap 4
  | 'unit-tests'         // → cap 5 (mocks OK at this tier)
  | 'mocks-only'         // → cap 6 (integration wired but fake adapters)
  | 'e2e-with-caveats'   // → cap 7
  | 'e2e-realistic'      // → cap 8
  | 'production-real';   // → cap 9+

export interface StubFinding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
  inCriticalPath: boolean;
}

export interface CapabilityTestResult {
  command: string;
  exitCode: number;
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface ScoreCapResult {
  cap: number;
  reason: string;
  evidenceLevel: EvidenceLevel;
}

export interface IntegrityAuditRecord {
  dimension: string;
  label: string;
  claimedCapability: string;
  actualCompetitorLeader: string;
  ourScorePre: number;
  ourScore: number;
  leaderScore: number;
  gapToLeader: number;
  capApplied: number | null;
  capReason: string | null;
  evidenceInspected: string[];
  commandsRun: string[];
  testsRun: string[];
  endToEndVerified: boolean;
  stubFindings: StubFinding[];
  whatWorks: string[];
  whatDoesNotWork: string[];
  whatIsUnverified: string[];
  reasonForScore: string;
  highestImpactNextAction: string;
  status: CapabilityStatus;
  auditedAt: string;
}

export interface ScoringScriptAudit {
  scriptPath: string;
  hardcodedScoreLines: Array<{ line: number; content: string }>;
  readsEvidenceFiles: boolean;
  valid: boolean;
  issues: string[];
}

export interface IntegrityAuditSummary {
  auditedAt: string;
  gitSha: string;
  totalDimensions: number;
  verified: number;
  partiallyVerified: number;
  structural: number;
  claimed: number;
  missing: number;
  scoresCapped: number;
  avgScoreBefore: number;
  avgScoreAfter: number;
  scoringScriptAudit: ScoringScriptAudit | null;
  records: IntegrityAuditRecord[];
}
