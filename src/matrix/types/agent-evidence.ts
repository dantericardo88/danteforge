// Matrix Kernel — Agent Evidence type (Fix B)
//
// Each worker agent must produce an evidence.json file in its worktree.
// The kernel reads this file AFTER the wave; no agent may write directly to
// the matrix score surface (matrix.json, score-proposals/).

export interface AgentEvidenceFile {
  /** Lease this evidence belongs to. */
  leaseId: string;
  /** Dimension this work targeted. */
  dimensionId: string;
  /** Files the agent touched, with approximate LOC counts. */
  filesTouched: Array<{ path: string; locDelta: number }>;
  /** capability_test commands the agent wrote (if any). */
  capabilityTestsWritten: string[];
  /** Exit codes of capability_test runs the agent performed. */
  capabilityTestExitCodes: number[];
  /** Test files added or modified. */
  testsAdded: string[];
  /** External calls made (URLs, API calls, shell commands outside owned paths). */
  externalCallsMade: string[];
  /** Self-reported status — kernel does NOT trust this for scoring. */
  agentStatus: 'completed' | 'partial' | 'failed';
  /** One-line summary for the merge-court log. */
  summary: string;
  createdAt: string;
}

// ── Validation ───────────────────────────────────────────────────────────────

export function isAgentEvidenceFile(value: unknown): value is AgentEvidenceFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.leaseId === 'string'
    && typeof v.dimensionId === 'string'
    && Array.isArray(v.filesTouched)
    && Array.isArray(v.capabilityTestsWritten)
    && Array.isArray(v.capabilityTestExitCodes)
    && Array.isArray(v.testsAdded)
    && Array.isArray(v.externalCallsMade)
    && typeof v.agentStatus === 'string'
    && typeof v.summary === 'string';
}

export const EVIDENCE_FILE_NAME = 'agent-evidence.json';

/** Paths workers are NEVER allowed to modify (kernel-owned score surface). */
export const MATRIX_SCORE_SURFACE_PATTERNS: readonly string[] = [
  '.danteforge/compete/matrix.json',
  '.danteforge/compete/matrix-*.json',
  '.danteforge/compete/COMPETE_REPORT.md',
  '.danteforge/scores/**',
  '.danteforge/score-proposals/**',
  // Universe files define what 9+ means — builders must not edit them during forge work.
  '.danteforge/compete/universe/**',
];
